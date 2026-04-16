"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWalletClient, usePublicClient, useConfig } from "wagmi";
import { getWalletClient as getWalletClientAction } from "wagmi/actions";
import { RelayClient, RelayerTxType } from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { deriveProxyAddress } from "@/lib/relay";
import { buildApprovalTransactions, checkApprovals } from "@/lib/polymarket-approvals";
import { useAuthStore } from "@/stores/use-auth-store";
import { getMagic } from "@/lib/magic";
import { createWalletClient, custom } from "viem";
import { polygon } from "viem/chains";

const RELAYER_URL = "https://relayer-v2.polymarket.com/";
const POLYGON_CHAIN_ID = 137;

function getBuilderConfig(): BuilderConfig | undefined {
  if (typeof window === "undefined") return undefined;
  return new BuilderConfig({
    remoteBuilderConfig: {
      url: `${window.location.origin}/api/polymarket/builder-headers`,
    },
  });
}

export type SetupStatus = "checking" | "not_ready" | "ready" | "approving" | "error";

/**
 * Hook that checks whether the user's Polymarket proxy wallet is set up
 * for trading (proxy deployed + approvals in place) and provides a
 * one-click function to enable trading if not.
 *
 * The "Enable Trading" flow sends all 7 approval transactions as a
 * single batch via Polymarket's relayer (gas-free). The proxy wallet
 * auto-deploys on this first relayed transaction. The user signs ONE
 * message in their wallet — no gas, no on-chain tx from the EOA.
 */
export function usePolymarketSetup() {
  const { address: wagmiAddress } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  // Prefer Google address for Magic users (wagmi connector may take a moment
  // to attach on session restore). Falls back to wagmi for MetaMask/Phantom.
  const address = (googleAddress || wagmiAddress) as `0x${string}` | undefined;
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: POLYGON_CHAIN_ID });
  const wagmiConfig = useConfig();

  const [status, setStatus] = useState<SetupStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  // Granular step status for the Enable Trading modal
  const [proxyDeployed, setProxyDeployed] = useState(false);
  const [usdcApproved, setUsdcApproved] = useState(false);
  const [tokensApproved, setTokensApproved] = useState(false);
  // Bumped to force a re-check after enableTrading (both this hook's own
  // instance and any sibling instances that call refresh()).
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const proxyAddress = address ? deriveProxyAddress(address) : undefined;

  // Check approval + deployment status on mount and when address changes
  useEffect(() => {
    if (!proxyAddress || !publicClient) {
      setStatus("not_ready");
      return;
    }

    let cancelled = false;
    setStatus("checking");

    (async () => {
      // Check if proxy is deployed (has contract code)
      let deployed = false;
      try {
        const code = await publicClient.getCode({ address: proxyAddress });
        deployed = !!code && code !== "0x";
      } catch {}
      if (cancelled) return;
      setProxyDeployed(deployed);

      // Check approvals
      const result = await checkApprovals(publicClient, proxyAddress);
      if (cancelled) return;
      setUsdcApproved(result.usdcApproved);
      setTokensApproved(result.tokensApproved);
      setStatus(result.allApproved && deployed ? "ready" : "not_ready");
    })().catch(() => {
      if (!cancelled) setStatus("not_ready");
    });

    return () => { cancelled = true; };
  }, [proxyAddress, publicClient, refreshKey]);

  // Enable trading: send all 7 approvals via the relayer in one batch
  const enableTrading = useCallback(async () => {
    if (!address) {
      setError("Wallet not connected");
      return false;
    }

    setStatus("approving");
    setError(null);

    try {
      // Get a signer. For wallet users, wagmi's walletClient works.
      // For Google/Magic users, wagmi may not have the connector attached
      // yet — fall back to wrapping Magic's RPC provider directly.
      let signer = walletClient;
      if (!signer) {
        try {
          signer = await getWalletClientAction(wagmiConfig, { chainId: POLYGON_CHAIN_ID });
        } catch {
          // ignore — try Magic fallback below
        }
      }
      if (!signer && googleAddress) {
        const magic = getMagic();
        if (magic?.rpcProvider) {
          signer = createWalletClient({
            account: googleAddress as `0x${string}`,
            chain: polygon,
            transport: custom(magic.rpcProvider),
          }) as never;
        }
      }
      if (!signer) {
        setError("Could not reach wallet. If using Google login, refresh the page and try again.");
        setStatus("not_ready");
        return false;
      }

      const txns = buildApprovalTransactions();

      // Create relay client — signs via browser wallet, builder auth via remote signer.
      // Type casts needed: viem WalletClient vs SDK's signer type, and dual
      // BuilderConfig versions from nested node_modules.
      const relayClient = new RelayClient(
        RELAYER_URL,
        POLYGON_CHAIN_ID,
        signer as never,
        getBuilderConfig() as never,
        RelayerTxType.PROXY,
      );

      // CRITICAL GAS FIX: The relay hub checks `require(gasleft() > signedGasLimit)`
      // which reserves `signedGasLimit` of gas for the callee. That means the
      // signed value must sit BELOW whatever tx.gasLimit the relayer chooses, but
      // ABOVE the callee's actual usage. Empirical evidence from tx
      // 0xb057932f... — we signed 5M, the relayer sent the tx with only 2.15M,
      // hub reverted immediately with "Not enough gasleft()".
      //
      // For Magic login users there's a second reason to patch: Magic's internal
      // RPC provider proxies eth_estimateGas through drpc.org, which their own
      // iframe CSP blocks. The SDK swallows that error and falls back to the 10M
      // default, which then hits the same hub revert.
      //
      // 1M comfortably covers the 7-approval batched multisend (each ~50-80K +
      // multisend overhead ≈ 500-700K) and sits well below the relayer's ~2M
      // tx.gasLimit cap we observed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internalSigner = (relayClient as any).signer;
      if (internalSigner) {
        internalSigner.estimateGas = async () => BigInt(1_000_000);
        if (internalSigner.publicClient) {
          internalSigner.publicClient.estimateGas = async () => BigInt(1_000_000);
        }
      }

      // Execute all 7 approvals as one relayed batch (1 wallet popup)
      const response = await relayClient.execute(txns);

      // Poll until the relayer confirms the tx is mined.
      // pollUntilState returns undefined when it hits STATE_FAILED — we MUST
      // check this, otherwise we treat a failed onchain txn as success.
      if (response?.wait) {
        const result = await response.wait();
        if (!result) {
          const txHash = (response as unknown as { transactionHash?: string }).transactionHash;
          setError(
            txHash
              ? `Transaction reverted onchain (${txHash.slice(0, 10)}…). Try again — if it keeps failing, check Polygonscan for the revert reason.`
              : "Transaction reverted onchain. Please try again.",
          );
          setStatus("not_ready");
          return false;
        }
      }

      // Re-verify approvals onchain — the relayer may report success while some
      // approvals silently didn't go through. Only mark ready if real state confirms.
      //
      // Poll with retries: the relayer confirms as soon as ITS node sees the tx
      // mined, but our public RPC may be a block or two behind. Without retries,
      // we hit a race and report false failure even though the approvals landed.
      if (publicClient) {
        const verifyProxy = deriveProxyAddress(address);
        const maxAttempts = 6;
        const delayMs = 2000; // Polygon block time ~2s
        let verify = await checkApprovals(publicClient, verifyProxy);
        let deployed = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const code = await publicClient.getCode({ address: verifyProxy });
          deployed = !!code && code !== "0x";
          if (verify.allApproved && deployed) break;
          if (attempt === maxAttempts - 1) break;
          await new Promise((r) => setTimeout(r, delayMs));
          verify = await checkApprovals(publicClient, verifyProxy);
        }
        setUsdcApproved(verify.usdcApproved);
        setTokensApproved(verify.tokensApproved);
        setProxyDeployed(deployed);
        if (!verify.allApproved || !deployed) {
          setError("Approvals did not complete. Please try again.");
          setStatus("not_ready");
          return false;
        }
      }

      setStatus("ready");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to enable trading";
      console.error("Enable trading failed:", e);
      setError(msg);
      setStatus("not_ready");
      return false;
    }
  }, [address, walletClient, wagmiConfig, googleAddress, publicClient]);

  return {
    status,
    error,
    proxyAddress,
    enableTrading,
    refresh,
    isReady: status === "ready",
    isApproving: status === "approving",
    proxyDeployed,
    usdcApproved,
    tokensApproved,
  };
}
