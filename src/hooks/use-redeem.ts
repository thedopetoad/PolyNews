"use client";

import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { polygon } from "viem/chains";
import { RelayClient, RelayerTxType } from "@polymarket/builder-relayer-client";
import { useAuthStore } from "@/stores/use-auth-store";
import { getMagic } from "@/lib/magic";
import { RELAYER_URL } from "@/lib/relay";
import {
  CTF,
  NEG_RISK_ADAPTER,
  encodeBinaryRedeem,
  encodeNegRiskRedeem,
  getNegRiskFlag,
} from "@/lib/redeem";

// Public Polygon RPC used for the post-submission receipt check — we
// query the chain directly to confirm the redeem tx didn't revert,
// rather than trust the relay's response.wait() which has been seen
// to throw on valid txs and vice versa.
const POLYGON_RPC = "https://polygon.drpc.org";
const receiptClient = createPublicClient({ chain: polygon, transport: http(POLYGON_RPC) });

/**
 * Submit a redeem-winnings transaction through Polymarket's gasless
 * builder relay — same infra the withdraw modal uses, different
 * encoded call (CTF.redeemPositions instead of USDC.e.transfer).
 *
 * The signer plumbing mirrors WithdrawModal exactly: prefer wagmi's
 * walletClient, fall back to Magic's rpcProvider wrapped in a viem
 * WalletClient, fall back to any injected ethereum provider on the
 * window. Each fallback exists because of a specific real-world edge
 * case (Phantom on Solana, Magic session during chain switch, etc.).
 *
 * Returns { success, txHash, error } the same shape usePolymarketTrade
 * does so callers can treat redeem and sell uniformly.
 */
export function useRedeem() {
  const { data: walletClient } = useWalletClient({ chainId: polygon.id });
  const { isConnected: wagmiConnected } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeem = useCallback(
    async (params: {
      conditionId: string;
      userAddress: string;
      /**
       * Outcome this position is on — "Yes" or "No". Only matters for
       * NegRisk markets where we pass the amount to burn as a 2-slot
       * array [yesAmount, noAmount]; one side is the position's
       * shares, the other is zero.
       */
      outcome: string;
      /** Share count held on that outcome. Ignored for non-NegRisk. */
      shares: number;
      /** Human-readable label for the relay, shown in receipts. */
      label?: string;
    }) => {
      setError(null);
      setPlacing(true);
      try {
        // Build the signer. Matches the withdraw modal's fallback chain:
        // walletClient first (fastest happy path), then a Magic-wrapped
        // client for Google users, then an injected-provider wrap for
        // wagmi-connected users whose walletClient is briefly undefined
        // during a chain switch.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let signer: any = walletClient;
        if (!signer && googleAddress) {
          const magic = getMagic();
          if (!magic) throw new Error("Magic not initialized");
          signer = createWalletClient({
            account: params.userAddress as `0x${string}`,
            chain: polygon,
            transport: custom(magic.rpcProvider),
          });
        }
        if (!signer && wagmiConnected) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const injected = (window as any).ethereum;
          if (!injected) throw new Error("No injected wallet provider found");
          signer = createWalletClient({
            account: params.userAddress as `0x${string}`,
            chain: polygon,
            transport: custom(injected),
          });
        }
        if (!signer) throw new Error("No wallet signer available");

        // Build the relay client with remote builder config (HMAC secret
        // stays server-side at /api/polymarket/builder-headers).
        const { BuilderConfig } = await import("@polymarket/builder-signing-sdk");
        const builderConfig = new BuilderConfig({
          remoteBuilderConfig: {
            url: `${window.location.origin}/api/polymarket/builder-headers`,
          },
        });

        const relayClient = new RelayClient(
          RELAYER_URL,
          137,
          signer,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          builderConfig as any,
          RelayerTxType.PROXY,
        );

        // Same gas-estimate patch the withdraw modal applies: the relay
        // hub checks gasleft() > signedGasLimit, and the SDK's default
        // 10M is too high (hub itself burns some gas before the check).
        // ~3M is Polymarket's own recommendation for single transfers.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internalSigner = (relayClient as any).signer;
        if (internalSigner) {
          internalSigner.estimateGas = async () => BigInt(3_000_000);
          if (internalSigner.publicClient) {
            internalSigner.publicClient.estimateGas = async () => BigInt(3_000_000);
          }
        }

        // Route to the right contract based on market type. NegRisk
        // markets (multi-outcome, only one winner — e.g. elections) use
        // the NegRiskAdapter with a share-amount array instead of the
        // standard CTF index-set bitmask. Binary YES/NO (every sports
        // market) goes to the standard CTF contract.
        const isNegRisk = await getNegRiskFlag(params.conditionId);
        console.log(
          `[redeem] conditionId=${params.conditionId} negRisk=${isNegRisk} outcome=${params.outcome} shares=${params.shares} contract=${isNegRisk ? "NegRiskAdapter" : "CTF"}`,
        );
        const { to, data } = isNegRisk
          ? {
              to: NEG_RISK_ADAPTER,
              data: encodeNegRiskRedeem(
                params.conditionId,
                params.outcome === "Yes" ? params.shares : 0,
                params.outcome === "No" ? params.shares : 0,
              ),
            }
          : { to: CTF, data: encodeBinaryRedeem(params.conditionId) };

        const response = await relayClient.execute(
          [{ to, data, value: "0" }],
          params.label ?? "Redeem Polymarket winnings",
        );

        const submittedHash = response.transactionHash as `0x${string}` | undefined;
        if (!submittedHash) {
          throw new Error("Relay returned no transaction hash — redeem not submitted.");
        }
        console.log(`[redeem] submitted hash=${submittedHash}`);

        // Verify the tx actually succeeded on-chain. response.wait() in
        // the relay SDK has been flaky — sometimes throws on valid txs,
        // sometimes returns without checking status. We hit the chain
        // directly to get the authoritative receipt, then check
        // receipt.status === "success". If "reverted", treat it as a
        // failure (don't optimistically hide the position — the user's
        // tokens are still there and they need to know).
        //
        // Previous behavior: reported success on any submittedHash,
        // which meant reverted redeems looked successful until the 2min
        // closedLocally TTL expired and the position reappeared — the
        // "it pops out again on refresh" bug.
        try {
          const receipt = await receiptClient.waitForTransactionReceipt({
            hash: submittedHash,
            timeout: 90_000,
          });
          if (receipt.status !== "success") {
            console.warn(`[redeem] tx reverted hash=${submittedHash} status=${receipt.status}`);
            return {
              success: false,
              error: `On-chain redemption reverted. tx: ${submittedHash}`,
              txHash: submittedHash,
            };
          }
          console.log(`[redeem] confirmed hash=${submittedHash} status=success gasUsed=${receipt.gasUsed}`);
          return { success: true, txHash: submittedHash };
        } catch (waitErr) {
          // Chain lookup itself failed (network hiccup, RPC down). Don't
          // claim success — we don't know. Caller will show the user
          // the submitted hash so they can check Polygonscan.
          console.warn("[redeem] receipt check failed:", waitErr);
          return {
            success: false,
            error: `Submitted but couldn't confirm on-chain. tx: ${submittedHash}`,
            txHash: submittedHash,
          };
        }
      } catch (e) {
        const msg = (e as Error).message || "Redeem failed";
        console.warn("[redeem] threw:", msg);
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setPlacing(false);
      }
    },
    [walletClient, wagmiConnected, googleAddress],
  );

  return { redeem, placing, error };
}
