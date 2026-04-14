"use client";

/**
 * Vault withdrawal — admin-signed. User specifies amount + destination
 * address, backend executes vault.withdraw() using the admin key. Zero
 * signing required from the user (they're already authenticated via their
 * session Authorization header).
 *
 * MVP: Polygon USDC.e only. Cross-chain withdrawals (Polygon → Solana/ETH)
 * are a follow-up that layers Relay on top of this.
 */
import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { useAuthStore } from "@/stores/use-auth-store";

interface VaultWithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultBalance: number;         // DB-tracked balance in USDC.e (human units)
  onWithdrawn?: () => void;
}

export function VaultWithdrawModal({ open, onOpenChange, vaultBalance, onWithdrawn }: VaultWithdrawModalProps) {
  const { address: wagmiAddress } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  const userAddress = wagmiAddress || (googleAddress as `0x${string}` | null) || undefined;

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ txHash: string } | null>(null);

  const amountNum = parseFloat(amount || "0");
  const validAmount = amountNum > 0 && amountNum <= vaultBalance + 0.000001;
  const validRecipient = isAddress(recipient.trim());

  const handleMax = useCallback(() => {
    const floored = Math.floor(vaultBalance * 1_000_000) / 1_000_000;
    setAmount(floored.toString());
  }, [vaultBalance]);

  const handleUseConnected = useCallback(() => {
    if (userAddress) setRecipient(userAddress);
  }, [userAddress]);

  const handleWithdraw = useCallback(async () => {
    if (!userAddress || !validAmount || !validRecipient) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      // amount is human-units — convert to smallest (6 decimals)
      const amountSmallest = BigInt(Math.round(amountNum * 1_000_000)).toString();
      const res = await fetch("/api/vault/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userAddress}`,
        },
        body: JSON.stringify({
          userId: userAddress,
          amount: amountSmallest,
          toAddress: recipient.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Vault withdraw failed");
      setSuccess({ txHash: data.txHash });
      setAmount("");
      onWithdrawn?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [userAddress, amount, amountNum, recipient, validAmount, validRecipient, onWithdrawn]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setAmount("");
      setRecipient("");
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Withdraw</DialogTitle>
          <p className="text-xs text-[#768390]">Gasless — PolyStream covers the transaction</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-3">
            <div className="flex items-center justify-between text-[10px] text-[#484f58] uppercase tracking-wider mb-1">
              <span>Vault balance</span>
              <span>USDC.e · Polygon</span>
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">
              {vaultBalance.toFixed(6)} <span className="text-sm font-normal text-[#768390]">USDC.e</span>
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-white">Recipient address (Polygon)</label>
              {userAddress && (
                <button
                  onClick={handleUseConnected}
                  className="text-[10px] font-medium bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded-full px-2 py-0.5 transition-colors"
                >
                  Use connected
                </button>
              )}
            </div>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff]"
            />
            {recipient && !validRecipient && (
              <p className="text-[10px] text-[#f85149] mt-1">Invalid EVM address</p>
            )}
          </div>

          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">Amount</label>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 focus-within:border-[#58a6ff]">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="flex-1 bg-transparent text-xl font-medium text-white placeholder:text-[#484f58] focus:outline-none tabular-nums"
                />
                <span className="text-xs font-semibold text-[#768390]">USDC.e</span>
                <button
                  onClick={handleMax}
                  className="text-[10px] font-semibold text-[#58a6ff] hover:text-[#79c0ff] bg-[#58a6ff]/10 rounded px-1.5 py-0.5"
                >
                  Max
                </button>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-[#484f58] leading-snug">
            MVP: Polygon USDC.e destinations only. Cross-chain withdrawals (Solana / Ethereum / etc.) are coming in a later iteration.
          </p>

          {error && <p className="text-[11px] text-[#f85149]">{error}</p>}
          {success && (
            <div className="text-[11px] text-[#3fb950] bg-[#3fb950]/10 px-3 py-2 rounded-lg">
              Sent!{" "}
              <a href={`https://polygonscan.com/tx/${success.txHash}`} target="_blank" rel="noopener noreferrer" className="underline">
                View on Polygonscan →
              </a>
            </div>
          )}

          <button
            onClick={handleWithdraw}
            disabled={!validAmount || !validRecipient || submitting || !userAddress}
            className="w-full py-3 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : !validRecipient ? "Enter recipient" : !validAmount ? "Enter amount" : "Withdraw"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
