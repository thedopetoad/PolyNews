"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWalletClient, usePublicClient, useConfig } from "wagmi";
import { getWalletClient as getWalletClientAction } from "wagmi/actions";
import { RelayClient, RelayerTxType } from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { deriveProxyAddress } from "@/lib/relay";
import { buildApprovalTransactions, checkApprovals } from "@/lib/polymarket-approvals";
import { useAuthStore } from "@/stores/use-auth-store";

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
  }, [proxyAddress, publicClient]);

  // Enable trading: send all 7 approvals via the relayer in one batch
  const enableTrading = useCallback(async () => {
    if (!address) {
      setError("Wallet not connected");
      return false;
    }

    setStatus("approving");
    setError(null);

    try {
      // Get a fresh signer (handles stale walletClient after chain switch)
      let signer = walletClient;
      if (!signer) {
        try {
          signer = await getWalletClientAction(wagmiConfig, { chainId: POLYGON_CHAIN_ID });
        } catch {
          setError("Could not reach wallet. Make sure it's on Polygon.");
          setStatus("not_ready");
          return false;
        }
      }
      if (!signer) {
        setError("Wallet signer unavailable");
        setStatus("not_ready");
        return false;
      }

      const proxyAddr = deriveProxyAddress(address);
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

      // Execute all 7 approvals as one relayed batch (1 wallet popup)
      const response = await relayClient.execute(txns);

      // Poll until the relayer confirms the tx is mined
      if (response?.wait) {
        await response.wait();
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
  }, [address, walletClient, wagmiConfig]);

  return {
    status,
    error,
    proxyAddress,
    enableTrading,
    isReady: status === "ready",
    isApproving: status === "approving",
    proxyDeployed,
    usdcApproved,
    tokensApproved,
  };
}
