"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { usePolymarketTrade } from "@/hooks/use-polymarket-trade";
import { LoginButton } from "@/components/layout/login-modal";
import { useSwitchChain } from "wagmi";
import { polygon } from "wagmi/chains";

interface BetOutcome {
  name: string;
  price: number;
  tokenId: string;
}

interface BetSlipProps {
  eventTitle: string;
  eventSlug: string;
  eventEndDate: string;
  marketId: string;
  marketQuestion: string;
  outcomes: BetOutcome[];
  negRisk?: boolean;
}

function abbrev(name: string): string {
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words[words.length - 1].slice(0, 3).toUpperCase();
}

export function BetSlip({ eventTitle, eventSlug, eventEndDate, marketId, marketQuestion, outcomes, negRisk }: BetSlipProps) {
  const { address } = useUser();
  const { placeOrder, placing, canTrade, isOnPolygon } = usePolymarketTrade();
  const { switchChain } = useSwitchChain();

  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (outcomes.length === 0) return null;

  const selected = outcomes.find((o) => o.name === selectedOutcome);
  const amountNum = parseFloat(amount) || 0;
  const shares = selected && amountNum > 0 ? amountNum / selected.price : 0;

  const placeBet = async () => {
    if (!selected || amountNum <= 0) return;
    setConfirming(false);
    const res = await placeOrder({
      tokenId: selected.tokenId,
      side: "BUY",
      amount: amountNum,
      price: selected.price,
      negRisk,
    });
    if (res.success) {
      setResult({ success: true, msg: `Order placed! ID: ${res.orderID?.slice(0, 10)}...` });
      setAmount("");
      setSelectedOutcome(null);
    } else {
      setResult({ success: false, msg: res.error || "Order failed" });
    }
  };

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Bet with USDC</p>

      {!address ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-[#768390]">Connect wallet to bet</p>
          <LoginButton />
        </div>
      ) : !isOnPolygon ? (
        <button
          onClick={() => switchChain({ chainId: polygon.id })}
          className="w-full py-2 rounded-md text-xs font-semibold bg-[#8247e5] text-white hover:bg-[#7038d4] transition-colors"
        >
          Switch to Polygon to Place Bets
        </button>
      ) : (
        <>
          {/* Outcome buttons */}
          <div className="flex gap-2">
            {outcomes.map((o) => (
              <button
                key={o.name}
                onClick={() => { setSelectedOutcome(selectedOutcome === o.name ? null : o.name); setResult(null); setConfirming(false); }}
                className={cn(
                  "flex-1 py-2 rounded-md text-xs font-semibold tabular-nums transition-all",
                  selectedOutcome === o.name
                    ? "bg-[#238636] text-white ring-1 ring-[#3fb950]"
                    : "bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
                )}
              >
                {abbrev(o.name)} {Math.round(o.price * 100)}¢
              </button>
            ))}
          </div>

          {/* Amount input + bet button */}
          {selectedOutcome && (
            <div className="flex gap-2 items-center animate-fade-in-up">
              <div className="relative flex-1">
                <input
                  type="number"
                  placeholder="USDC amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-xs text-white placeholder-[#484f58] focus:border-[#3fb950] outline-none tabular-nums"
                  min="0.1"
                />
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
                disabled={placing || amountNum <= 0 || !canTrade}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-semibold transition-all",
                  placing
                    ? "bg-[#21262d] text-[#484f58]"
                    : "bg-[#238636] text-white hover:bg-[#2ea043]"
                )}
              >
                {placing ? "Placing..." : "Bet"}
              </button>
            </div>
          )}

          {/* Payout preview */}
          {selectedOutcome && amountNum > 0 && selected && !confirming && (
            <p className="text-[10px] text-[#768390]">
              {shares.toFixed(1)} shares → payout {shares.toFixed(1)} USDC if "{selectedOutcome}" wins
            </p>
          )}

          {/* Confirmation dialog */}
          {confirming && selected && (
            <div className="bg-[#0d1117] border border-[#d29922]/30 rounded-lg p-3 space-y-2 animate-fade-in-up">
              <p className="text-xs text-[#d29922] font-semibold">Confirm Bet</p>
              <p className="text-[10px] text-[#768390]">
                Buy {shares.toFixed(1)} shares of "{selectedOutcome}" at {Math.round(selected.price * 100)}¢ for ${amountNum.toFixed(2)} USDC
              </p>
              <div className="flex gap-2">
                <button
                  onClick={placeBet}
                  disabled={placing}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold bg-[#238636] text-white hover:bg-[#2ea043]"
                >
                  {placing ? "Placing..." : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Result message */}
          {result && (
            <p className={cn("text-[11px] font-medium", result.success ? "text-[#3fb950]" : "text-[#f85149]")}>
              {result.msg}
            </p>
          )}
        </>
      )}
    </div>
  );
}
