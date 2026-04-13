"use client";

import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, isAddress } from "viem";

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

const erc20TransferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usdcBalance: number;
}

export function WithdrawModal({ open, onOpenChange, usdcBalance }: WithdrawModalProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleSend = useCallback(() => {
    setError(null);
    if (!recipient || !isAddress(recipient)) {
      setError("Invalid wallet address");
      return;
    }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (amountNum > usdcBalance) {
      setError("Amount exceeds balance");
      return;
    }
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20TransferAbi,
      functionName: "transfer",
      args: [recipient as `0x${string}`, parseUnits(amount, 6)],
    });
  }, [recipient, amount, usdcBalance, writeContract]);

  const handleClose = (open: boolean) => {
    if (!open) {
      setRecipient("");
      setAmount("");
      setError(null);
      reset();
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Withdraw USDC</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#768390]">Available</span>
            <span className="text-white font-medium">${usdcBalance.toFixed(2)} USDC</span>
          </div>

          {/* Recipient */}
          <div>
            <label className="block text-xs text-[#768390] mb-1">Recipient Address</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              disabled={isPending || isConfirming}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff] disabled:opacity-50"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs text-[#768390] mb-1">Amount (USDC)</label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                disabled={isPending || isConfirming}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 pr-16 text-sm text-white placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff] disabled:opacity-50"
              />
              <button
                onClick={() => setAmount(usdcBalance.toFixed(2))}
                disabled={isPending || isConfirming}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#58a6ff] hover:text-[#79c0ff] px-2 py-0.5 rounded bg-[#58a6ff]/10 disabled:opacity-50"
              >
                Max
              </button>
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-xs text-[#f85149]">{error}</p>}

          {/* Success */}
          {isSuccess && txHash && (
            <div className="text-xs text-[#3fb950] bg-[#3fb950]/10 px-3 py-2 rounded-lg">
              Sent! {" "}
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline"
              >
                View on Polygonscan &rarr;
              </a>
            </div>
          )}

          {/* Send button */}
          {!isSuccess && (
            <button
              onClick={handleSend}
              disabled={isPending || isConfirming}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Confirm in wallet..." : isConfirming ? "Sending..." : "Send USDC"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
