"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { usePolymarketTrade } from "@/hooks/use-polymarket-trade";
import { LoginButton } from "@/components/layout/login-modal";

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
  const { address, user } = useUser();
  const { placeOrder, placing: realPlacing, canTrade, isOnPolygon } = usePolymarketTrade();

  const [mode, setMode] = useState<"paper" | "real">("paper");
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (outcomes.length === 0) return null;

  const selected = outcomes.find((o) => o.name === selectedOutcome);
  const amountNum = parseFloat(amount) || 0;
  const shares = selected && amountNum > 0 ? amountNum / selected.price : 0;

  const placePaperBet = async () => {
    if (!address || !selected || amountNum <= 0) return;
    setPlacing(true);
    setResult(null);
    try {
      const res = await fetch("/api/sports/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${address}` },
        body: JSON.stringify({
          userId: address,
          marketId,
          marketQuestion: marketQuestion || eventTitle,
          outcome: selected.name,
          side: "buy",
          shares,
          price: selected.price,
          clobTokenId: selected.tokenId,
          eventSlug,
          marketEndDate: eventEndDate,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, msg: `${shares.toFixed(1)} shares of "${selected.name}" at ${Math.round(selected.price * 100)}¢` });
        setAmount("");
        setSelectedOutcome(null);
      } else {
        setResult({ success: false, msg: data.error || "Failed to place bet" });
      }
    } catch {
      setResult({ success: false, msg: "Network error" });
    } finally {
      setPlacing(false);
    }
  };

  const placeRealBet = async () => {
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

  const handleBet = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "real") {
      setConfirming(true);
    } else {
      placePaperBet();
    }
  };

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Quick Bet</p>
        {address && (
          <div className="flex gap-1 bg-[#0d1117] rounded-md p-0.5">
            <button
              onClick={() => { setMode("paper"); setResult(null); }}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                mode === "paper" ? "bg-[#21262d] text-[#e6edf3]" : "text-[#484f58]"
              )}
            >
              Paper
            </button>
            <button
              onClick={() => { setMode("real"); setResult(null); }}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                mode === "real" ? "bg-[#238636]/30 text-[#3fb950]" : "text-[#484f58]"
              )}
            >
              Real $
            </button>
          </div>
        )}
      </div>

      {!address ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-[#768390]">Connect wallet to bet</p>
          <LoginButton />
        </div>
      ) : (
        <>
          {mode === "real" && !isOnPolygon && (
            <p className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-1 rounded">
              Switch to Polygon network for real-money trading
            </p>
          )}

          {/* Outcome buttons */}
          <div className="flex gap-2">
            {outcomes.map((o) => (
              <button
                key={o.name}
                onClick={() => { setSelectedOutcome(selectedOutcome === o.name ? null : o.name); setResult(null); setConfirming(false); }}
                className={cn(
                  "flex-1 py-2 rounded-md text-xs font-semibold tabular-nums transition-all",
                  selectedOutcome === o.name
                    ? mode === "real" ? "bg-[#238636] text-white ring-1 ring-[#3fb950]" : "bg-[#58a6ff] text-white ring-1 ring-[#58a6ff]"
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
                  placeholder={mode === "real" ? "USDC amount" : "AIRDROP amount"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-xs text-white placeholder-[#484f58] focus:border-[#58a6ff] outline-none tabular-nums"
                  min="0.1"
                />
              </div>
              <button
                onClick={handleBet}
                disabled={placing || realPlacing || amountNum <= 0 || (mode === "real" && !canTrade)}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-semibold transition-all",
                  placing || realPlacing
                    ? "bg-[#21262d] text-[#484f58]"
                    : mode === "real"
                      ? "bg-[#238636] text-white hover:bg-[#2ea043]"
                      : "bg-[#58a6ff] text-white hover:bg-[#4d8fea]"
                )}
              >
                {placing || realPlacing ? "Placing..." : mode === "real" ? "Bet $" : "Bet"}
              </button>
            </div>
          )}

          {/* Payout preview */}
          {selectedOutcome && amountNum > 0 && selected && (
            <p className="text-[10px] text-[#768390]">
              {shares.toFixed(1)} shares → payout {shares.toFixed(1)} {mode === "real" ? "USDC" : "AIRDROP"} if "{selectedOutcome}" wins
            </p>
          )}

          {/* Real money confirmation dialog */}
          {confirming && (
            <div className="bg-[#0d1117] border border-[#d29922]/30 rounded-lg p-3 space-y-2 animate-fade-in-up">
              <p className="text-xs text-[#d29922] font-semibold">Confirm Real Money Bet</p>
              <p className="text-[10px] text-[#768390]">
                Buy {shares.toFixed(1)} shares of "{selectedOutcome}" at {Math.round(selected!.price * 100)}¢ for ${amountNum.toFixed(2)} USDC
              </p>
              <div className="flex gap-2">
                <button
                  onClick={placeRealBet}
                  disabled={realPlacing}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold bg-[#238636] text-white hover:bg-[#2ea043]"
                >
                  {realPlacing ? "Placing..." : "Confirm"}
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

          {/* Balance info */}
          {mode === "paper" && user && (
            <p className="text-[10px] text-[#484f58]">Balance: {Math.round(user.balance).toLocaleString()} AIRDROP</p>
          )}
        </>
      )}
    </div>
  );
}
