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
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words[words.length - 1].slice(0, 4).toUpperCase();
}

const QUICK_AMOUNTS = [1, 5, 10, 100];

export function BetSlip({ eventTitle, eventSlug, eventEndDate, marketId, marketQuestion, outcomes, negRisk }: BetSlipProps) {
  const { address } = useUser();
  const { placeOrder, placing, error: tradeError, canTrade, isOnPolygon } = usePolymarketTrade();
  const { switchChain } = useSwitchChain();

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [selectedOutcome, setSelectedOutcome] = useState<number>(0);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ success: boolean; msg: string } | null>(null);

  if (outcomes.length === 0) return null;

  const selected = outcomes[selectedOutcome];
  const amountNum = parseFloat(amount) || 0;
  const shares = selected && amountNum > 0 ? amountNum / selected.price : 0;
  const payout = shares; // Each share pays $1 if outcome wins

  const handleTrade = async () => {
    if (!selected || amountNum <= 0) return;
    setResult(null);
    const res = await placeOrder({
      tokenId: selected.tokenId,
      side,
      amount: amountNum,
      price: selected.price,
      negRisk,
    });
    if (res.success) {
      setResult({ success: true, msg: `Order filled! ${shares.toFixed(1)} shares` });
      setAmount("");
    } else {
      setResult({ success: false, msg: res.error || "Order failed" });
    }
  };

  if (!address) {
    return (
      <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-[#768390] text-center">Connect wallet to trade</p>
        <div className="flex justify-center"><LoginButton /></div>
      </div>
    );
  }

  if (!isOnPolygon) {
    return (
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => switchChain({ chainId: polygon.id })}
          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[#8247e5] text-white hover:bg-[#7038d4] transition-colors"
        >
          Switch to Polygon
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Outcome name */}
      <p className="text-xs text-[#58a6ff] font-medium">{selected?.name}</p>

      {/* Buy / Sell tabs */}
      <div className="flex gap-0 bg-[#0d1117] rounded-lg p-0.5">
        <button
          onClick={() => setSide("BUY")}
          className={cn(
            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors",
            side === "BUY" ? "bg-[#238636] text-white" : "text-[#768390] hover:text-white"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("SELL")}
          className={cn(
            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors",
            side === "SELL" ? "bg-[#f85149] text-white" : "text-[#768390] hover:text-white"
          )}
        >
          Sell
        </button>
      </div>

      {/* Outcome buttons */}
      <div className="flex gap-2">
        {outcomes.map((o, i) => (
          <button
            key={o.name}
            onClick={() => { setSelectedOutcome(i); setResult(null); }}
            className={cn(
              "flex-1 py-2 rounded-lg text-xs font-semibold tabular-nums transition-all border",
              selectedOutcome === i
                ? "bg-[#238636]/20 border-[#3fb950] text-[#3fb950]"
                : "bg-[#0d1117] border-[#21262d] text-[#e6edf3] hover:border-[#30363d]"
            )}
          >
            {abbrev(o.name)} {Math.round(o.price * 100)}¢
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div>
        <label className="text-[10px] text-[#484f58] uppercase tracking-wider block mb-1">Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#484f58]">$</span>
          <input
            type="number"
            placeholder="0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setResult(null); }}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-7 pr-3 py-2.5 text-lg text-white placeholder-[#30363d] focus:border-[#58a6ff] outline-none tabular-nums font-semibold"
            min="0.1"
            step="0.01"
          />
        </div>
      </div>

      {/* Quick amount buttons */}
      <div className="flex gap-1.5">
        {QUICK_AMOUNTS.map((q) => (
          <button
            key={q}
            onClick={() => { setAmount(String((amountNum || 0) + q)); setResult(null); }}
            className="flex-1 py-1.5 rounded-md text-[11px] font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors tabular-nums"
          >
            +${q}
          </button>
        ))}
        <button
          onClick={() => { setAmount("1000"); setResult(null); }}
          className="flex-1 py-1.5 rounded-md text-[11px] font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors"
        >
          Max
        </button>
      </div>

      {/* Payout preview */}
      {amountNum > 0 && selected && (
        <div className="flex justify-between text-xs text-[#768390] px-1">
          <span>{shares.toFixed(1)} shares</span>
          <span>Payout: <span className="text-[#3fb950] font-medium">${payout.toFixed(2)}</span></span>
        </div>
      )}

      {/* Trade button */}
      <button
        onClick={handleTrade}
        disabled={placing || amountNum <= 0 || !canTrade}
        className={cn(
          "w-full py-3 rounded-lg text-sm font-bold transition-all",
          placing
            ? "bg-[#21262d] text-[#484f58] cursor-wait"
            : amountNum > 0
              ? "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
              : "bg-[#21262d] text-[#484f58] cursor-not-allowed"
        )}
      >
        {placing ? "Confirming in wallet..." : "Trade"}
      </button>

      {/* Result / Error */}
      {result && (
        <p className={cn("text-xs font-medium text-center", result.success ? "text-[#3fb950]" : "text-[#f85149]")}>
          {result.msg}
        </p>
      )}
      {tradeError && !result && (
        <p className="text-xs text-[#f85149] text-center">{tradeError}</p>
      )}

      {/* Terms */}
      <p className="text-[9px] text-[#484f58] text-center">
        By trading, you agree to the{" "}
        <a href="https://polymarket.com/tos" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">Terms of Use</a>
      </p>
    </div>
  );
}
