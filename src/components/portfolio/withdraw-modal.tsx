"use client";

/**
 * Withdraw modal — gasless USDC.e transfer from user's Polymarket proxy wallet.
 *
 * Uses @polymarket/builder-relayer-client which handles:
 *   1. Fetching relay nonce from relayer-v2.polymarket.com
 *   2. Building + signing the proxy transaction (user signs via wagmi wallet / Magic)
 *   3. Submitting with builder HMAC headers (remote-signed via /api/polymarket/builder-headers)
 *   4. Polling for on-chain confirmation
 *
 * Supports same-chain (Polygon address) and cross-chain (via bridge.polymarket.com).
 */

import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWalletClient, useAccount } from "wagmi";
import { parseUnits, isAddress, formatUnits } from "viem";
import { RelayClient } from "@polymarket/builder-relayer-client";
// Use dynamic import to avoid version mismatch between builder-signing-sdk 1.0.0 and 0.0.8
import { RELAYER_URL, USDC_E, deriveProxyAddress, encodeUsdcTransfer } from "@/lib/relay";

const BRIDGE_API = "https://bridge.polymarket.com";

// Destination chains for cross-chain withdrawals
const DEST_CHAINS = [
  { id: "polygon", label: "Polygon (same chain)", chainId: null },
  { id: "ethereum", label: "Ethereum", chainId: "1", tokenAddr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { id: "base", label: "Base", chainId: "8453", tokenAddr: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { id: "solana", label: "Solana", chainId: "1151111081099710", tokenAddr: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
] as const;

type Status = "idle" | "signing" | "submitting" | "polling" | "success" | "error";

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usdcBalance: number;
  userAddress: string | null;
}

export function WithdrawModal({ open, onOpenChange, usdcBalance, userAddress }: WithdrawModalProps) {
  const { data: walletClient } = useWalletClient();
  const { connector } = useAccount();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [destChain, setDestChain] = useState("polygon");
  const [status, setStatus] = useState<Status>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMagicUser = connector?.id === "magic";
  // Wallet users have walletClient, Magic users have the connector's provider
  const canWithdraw = !!(userAddress && (walletClient || isMagicUser));
  const selectedDest = DEST_CHAINS.find((c) => c.id === destChain)!;
  const isCrossChain = destChain !== "polygon";

  const handleWithdraw = useCallback(async () => {
    if (!userAddress) return;

    setError(null);
    setTxHash(null);

    // Validate
    if (!recipient) { setError("Enter a recipient address"); return; }
    if (!isCrossChain && !isAddress(recipient)) { setError("Invalid Polygon address"); return; }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { setError("Enter a valid amount"); return; }
    if (amountNum > usdcBalance) { setError("Amount exceeds balance"); return; }

    const amountRaw = parseUnits(amount, 6); // USDC.e has 6 decimals

    try {
      setStatus("signing");

      // Build the RelayClient with remote builder config (HMAC secrets stay server-side)
      // Use dynamic require to get BuilderConfig from the relayer client's own dependency
      // to avoid version mismatch with the top-level @polymarket/builder-signing-sdk
      const { BuilderConfig } = await import("@polymarket/builder-signing-sdk");
      const builderConfig = new BuilderConfig({
        remoteBuilderConfig: {
          url: `${window.location.origin}/api/polymarket/builder-headers`,
        },
      });

      // Get signer: walletClient for browser wallets, connector provider for Magic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let signer: any = walletClient;
      if (!signer && isMagicUser && connector) {
        signer = await connector.getProvider();
      }
      if (!signer) throw new Error("No wallet signer available");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const relayClient = new RelayClient(
        RELAYER_URL,
        137, // Polygon
        signer,
        builderConfig as any,
      );

      let transferTo = recipient;

      // For cross-chain: get bridge deposit address first
      if (isCrossChain && selectedDest.chainId) {
        setStatus("submitting");
        const bridgeRes = await fetch(`${BRIDGE_API}/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: deriveProxyAddress(userAddress),
            toChainId: selectedDest.chainId,
            toTokenAddress: selectedDest.tokenAddr,
            recipientAddr: recipient,
          }),
        });

        if (!bridgeRes.ok) {
          const err = await bridgeRes.text();
          throw new Error(`Bridge error: ${err}`);
        }

        const bridgeData = await bridgeRes.json();
        // Get the right address type (evm for ETH/Base, svm for Solana)
        const addrType = selectedDest.chainId === "1151111081099710" ? "svm" : "evm";
        transferTo = bridgeData.address?.[addrType];
        if (!transferTo) throw new Error("No bridge address returned");
      }

      // Execute the relay: encode USDC.e transfer → sign → submit → poll
      setStatus("signing");
      const transferData = encodeUsdcTransfer(transferTo, amountRaw);

      const response = await relayClient.execute(
        [{ to: USDC_E, data: transferData, value: "0" }],
        `Withdraw ${amount} USDC.e${isCrossChain ? ` to ${selectedDest.label}` : ""}`,
      );

      setStatus("polling");

      // Poll for confirmation
      const confirmed = await response.wait();
      const hash = confirmed?.transactionHash || response.transactionHash;

      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      console.error("Withdraw failed:", err);
      setError((err as Error).message || "Withdrawal failed");
      setStatus("error");
    }
  }, [userAddress, walletClient, connector, isMagicUser, recipient, amount, usdcBalance, isCrossChain, selectedDest]);

  const handleClose = (next: boolean) => {
    if (!next && status !== "signing" && status !== "submitting" && status !== "polling") {
      setRecipient("");
      setAmount("");
      setDestChain("polygon");
      setStatus("idle");
      setTxHash(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const isProcessing = status === "signing" || status === "submitting" || status === "polling";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Withdraw USDC.e</DialogTitle>
          <p className="text-xs text-[#768390]">Gasless transfer from your Polymarket proxy wallet</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          {/* Balance */}
          <div className="flex items-center justify-between bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5">
            <span className="text-xs text-[#768390]">Available</span>
            <span className="text-sm text-white font-semibold tabular-nums">${usdcBalance.toFixed(2)} USDC.e</span>
          </div>

          {/* Destination chain */}
          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">Destination</label>
            <div className="grid grid-cols-2 gap-2">
              {DEST_CHAINS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setDestChain(c.id)}
                  disabled={isProcessing}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    destChain === c.id
                      ? "border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff]"
                      : "border-[#30363d] bg-[#0d1117] text-[#768390] hover:border-[#484f58]"
                  } disabled:opacity-50`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">
              Recipient address {isCrossChain ? `(${selectedDest.label})` : "(Polygon)"}
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={destChain === "solana" ? "So1..." : "0x..."}
              disabled={isProcessing}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff] disabled:opacity-50"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">Amount (USDC.e)</label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                disabled={isProcessing}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 pr-16 text-sm text-white placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff] disabled:opacity-50"
              />
              <button
                onClick={() => setAmount(usdcBalance.toFixed(2))}
                disabled={isProcessing}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#58a6ff] hover:text-[#79c0ff] px-2 py-0.5 rounded bg-[#58a6ff]/10 disabled:opacity-50"
              >
                Max
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[#f85149] bg-[#f85149]/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Success */}
          {status === "success" && txHash && (
            <div className="text-xs text-[#3fb950] bg-[#3fb950]/10 px-3 py-2.5 rounded-lg">
              Withdrawal complete!{" "}
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline"
              >
                View on Polygonscan &rarr;
              </a>
              {isCrossChain && (
                <p className="mt-1 text-[#768390]">Cross-chain bridge will deliver to {selectedDest.label} shortly.</p>
              )}
            </div>
          )}

          {/* Withdraw button */}
          {status !== "success" && (
            <button
              onClick={handleWithdraw}
              disabled={isProcessing || !canWithdraw}
              className="w-full py-3 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "signing" ? "Sign in wallet..." :
               status === "submitting" ? "Setting up bridge..." :
               status === "polling" ? "Confirming on-chain..." :
               !canWithdraw ? "Connect wallet to withdraw" :
               "Withdraw"}
            </button>
          )}

          {/* Info */}
          <p className="text-[10px] text-[#484f58] leading-snug">
            {isCrossChain
              ? `Funds are relayed from your Polymarket proxy wallet to bridge.polymarket.com, then bridged to ${selectedDest.label}. No gas fees.`
              : "Funds are relayed gaslessly from your Polymarket proxy wallet to the recipient on Polygon. No gas fees."
            }
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
