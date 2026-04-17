"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Polymarket-style "Cash out" modal for a position. The user picks a
 * percentage of their shares to sell via a horizontal slider (with 0 / 25
 * / 50 / 75 / 100 presets); we surface the expected USDC they'll receive
 * and the live fill price. Hitting "Cash out" calls onCashOut with the
 * exact share count — the portfolio page then fires a SELL through the
 * existing placeOrder flow (so TradeProgress + closedLocally + retry all
 * keep working).
 *
 * "Edit order" is a soft escape hatch that just closes the modal — the
 * user can tap the row's expand affordance for more detail, or open a
 * full bet slip via the sports detail page.
 */
export function SellPositionModal({
  open,
  onClose,
  outcomeName,
  marketTitle,
  shares,
  avgPrice,
  currentPrice,
  onCashOut,
  placing,
  marketHref,
}: {
  open: boolean;
  onClose: () => void;
  outcomeName: string;
  marketTitle: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  /** Called with the share count to sell. Modal closes after. */
  onCashOut: (sharesToSell: number) => void;
  placing: boolean;
  /**
   * If provided, "Edit order" turns into a link to this URL — typically
   * /sports/game?slug={eventSlug} so the user jumps to the full bet slip
   * on the market page. When absent, the button just closes the modal.
   */
  marketHref?: string;
}) {
  const [pct, setPct] = useState(100);

  // Reset slider whenever we reopen so a second sell doesn't start at the
  // previous %.
  useEffect(() => {
    if (open) setPct(100);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !placing) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, placing, onClose]);

  if (!open) return null;

  const sharesToSell = Math.max(0, shares * (pct / 100));
  const receive = sharesToSell * currentPrice;
  const pricePct = Math.round(currentPrice * 100);
  // P&L for this partial sell, so the user sees the immediate gain/loss on
  // the amount they're about to liquidate.
  const cost = sharesToSell * avgPrice;
  const pnl = receive - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !placing) onClose(); }}
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#30363d] bg-[#161b22] shadow-[0_0_40px_-10px_rgba(88,166,255,0.3)]">
        <div className="p-5">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-lg font-bold text-white">Sell {outcomeName}</h2>
            {!placing && (
              <button
                onClick={onClose}
                className="text-[#484f58] hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-xs text-[#768390] mb-5 line-clamp-2">{marketTitle}</p>

          {/* Receive */}
          <div className="mb-2">
            <p className="text-[11px] uppercase tracking-wider text-[#484f58]">Receive</p>
            <p className="text-3xl font-bold text-[#3fb950] tabular-nums">${receive.toFixed(2)}</p>
          </div>
          <p className="text-xs text-[#768390] tabular-nums mb-6">
            Selling {sharesToSell.toFixed(2)} shares @ {pricePct}¢
            {cost > 0 && (
              <span className={cn("ml-2 font-medium", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                ({pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} · {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)
              </span>
            )}
          </p>

          {/* Slider with tick marks */}
          <div className="mb-6">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              disabled={placing}
              className="w-full accent-[#58a6ff] cursor-pointer"
              aria-label="Percentage of shares to sell"
            />
            <div className="flex items-center justify-between mt-1 px-0.5 text-[11px] text-[#58a6ff] tabular-nums">
              {[0, 25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  onClick={() => setPct(p)}
                  disabled={placing}
                  className={cn(
                    "hover:text-[#79c0ff] transition-colors",
                    pct === p && "font-bold text-white"
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>

          {/* Actions. Edit order is a link when we have a market URL so the
              user jumps to the full bet slip on the sports page; otherwise
              it just closes the modal. */}
          <div className="grid grid-cols-2 gap-2">
            {marketHref && !placing ? (
              <Link
                href={marketHref}
                onClick={onClose}
                className="py-3 rounded-lg text-sm font-semibold bg-transparent border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] transition-colors text-center"
              >
                Edit order
              </Link>
            ) : (
              <button
                onClick={onClose}
                disabled={placing}
                className="py-3 rounded-lg text-sm font-semibold bg-transparent border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] transition-colors disabled:opacity-50"
              >
                Edit order
              </button>
            )}
            <button
              onClick={() => {
                if (sharesToSell > 0) onCashOut(sharesToSell);
              }}
              disabled={placing || sharesToSell <= 0}
              className={cn(
                "py-3 rounded-lg text-sm font-bold transition-all",
                placing
                  ? "bg-[#21262d] text-[#484f58] cursor-wait"
                  : sharesToSell <= 0
                    ? "bg-[#21262d] text-[#484f58]"
                    : "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
              )}
            >
              {placing ? "Selling…" : `Cash out $${receive.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
