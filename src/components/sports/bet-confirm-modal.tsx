"use client";

import { cn } from "@/lib/utils";
import { formatOdds } from "@/lib/odds-format";
import { useOddsFormat } from "@/stores/use-odds-format";

/**
 * Pre-trade confirmation panel. Shows the user exactly what they're about
 * to send: side, outcome, shares, slippage-capped price, cost, and potential
 * profit. Wraps placeOrder so fat-finger mistakes need a second tap to go
 * through — aligns with polymarket.com's real-trade flow.
 *
 * Rendered as a dialog-ish overlay; Confirm fires onConfirm(), Cancel just
 * closes. The parent owns trade state — this is a pure UI gate.
 */
export function BetConfirmModal({
  open,
  onCancel,
  onConfirm,
  side,
  outcomeName,
  shares,
  costUsd,
  avgPrice,
  slippageWarn,
  placing,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  side: "BUY" | "SELL";
  outcomeName: string;
  shares: number;
  costUsd: number;
  avgPrice: number;
  slippageWarn?: string | null;
  placing: boolean;
}) {
  const { format } = useOddsFormat();
  if (!open) return null;

  const toWin = shares - costUsd; // profit if YES resolves, $1/share - cost
  const priceCents = Math.round(avgPrice * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !placing) onCancel(); }}
    >
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border border-[#30363d] bg-[#161b22] shadow-[0_0_40px_-10px_rgba(88,166,255,0.3)]">
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#484f58]">Confirm order</p>
              <p className={cn("text-lg font-bold", side === "BUY" ? "text-[#3fb950]" : "text-[#f85149]")}>
                {side === "BUY" ? "Buy" : "Sell"} {outcomeName}
              </p>
            </div>
            {!placing && (
              <button
                onClick={onCancel}
                className="text-[#484f58] hover:text-white transition-colors"
                aria-label="Cancel"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="rounded-lg border border-[#21262d] bg-[#0d1117] divide-y divide-[#21262d]">
            <Row label="Shares" value={shares.toFixed(2)} />
            <Row label={side === "BUY" ? "Max price" : "Min price"} value={formatOdds(avgPrice, format)} sub={format !== "price" ? `${priceCents}¢` : undefined} />
            <Row label="Cost" value={`$${costUsd.toFixed(2)}`} />
            {side === "BUY" && (
              <Row
                label="To win"
                value={`$${toWin.toFixed(2)}`}
                highlight="green"
                sub={costUsd > 0 ? `+${((toWin / costUsd) * 100).toFixed(0)}% if YES` : undefined}
              />
            )}
          </div>

          {slippageWarn && (
            <p className="mt-3 text-[11px] text-[#d29922] bg-[#d29922]/10 px-2 py-1.5 rounded leading-snug">{slippageWarn}</p>
          )}

          <p className="mt-3 text-[10px] text-[#484f58] leading-snug">
            This is a market order with a 5% slippage cap — it fills at the best available price up to that cap, or cancels.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onCancel}
              disabled={placing}
              className="py-3 rounded-lg text-sm font-semibold bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={placing}
              className={cn(
                "py-3 rounded-lg text-sm font-bold transition-all",
                placing
                  ? "bg-[#21262d] text-[#484f58] cursor-wait"
                  : side === "BUY"
                    ? "bg-[#238636] text-white hover:bg-[#2ea043] active:scale-[0.98]"
                    : "bg-[#f85149] text-white hover:bg-[#e04343] active:scale-[0.98]"
              )}
            >
              {placing ? "Placing…" : side === "BUY" ? "Confirm buy" : "Confirm sell"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, value, sub, highlight,
}: { label: string; value: string; sub?: string; highlight?: "green" | "red" }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-xs text-[#768390]">{label}</span>
      <div className="text-right">
        <p className={cn(
          "text-sm font-semibold tabular-nums",
          highlight === "green" ? "text-[#3fb950]" : highlight === "red" ? "text-[#f85149]" : "text-[#e6edf3]"
        )}>{value}</p>
        {sub && <p className="text-[10px] text-[#484f58] tabular-nums">{sub}</p>}
      </div>
    </div>
  );
}
