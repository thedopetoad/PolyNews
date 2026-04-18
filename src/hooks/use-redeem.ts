"use client";

import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { createWalletClient, custom } from "viem";
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

        // Same wait() treatment as the withdraw fix: capture the submitted
        // hash up front so a failed confirmation poll doesn't flip a
        // successful on-chain tx into a UI error.
        const submittedHash = response.transactionHash || null;
        try {
          const confirmed = await response.wait();
          return {
            success: true,
            txHash: confirmed?.transactionHash || submittedHash,
          };
        } catch (waitErr) {
          console.warn("Redeem wait() failed but tx was submitted:", waitErr);
          if (submittedHash) {
            return { success: true, txHash: submittedHash };
          }
          throw waitErr;
        }
      } catch (e) {
        const msg = (e as Error).message || "Redeem failed";
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
