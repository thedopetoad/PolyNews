"use client";

import { useMemo, useState } from "react";
import { useUser } from "@/hooks/use-user";
import { usePositionLivePrices } from "@/hooks/use-live-prices";
import { LoginButton } from "@/components/layout/login-modal";
import { MiniPriceChart } from "@/components/mini-price-chart";
import { cn } from "@/lib/utils";
import { PnlChart } from "./pnl-chart";
import type { DbPosition } from "@/hooks/use-user";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// AIRDROP-side (paper) portfolio. Matches the Polymarket-style layout:
// "Positions / History" tab toggle, expandable rows with inline chart,
// and a Close button that sells at the live CLOB mid-price.
//
// "Available to trade" = cash balance. "Total" = balance + open-position
// market value (live prices when ready, entry-price fallback otherwise).

export function AirdropPortfolioTab() {
  const { address, isConnected, user, positions, trades, executeTrade, isTrading } = useUser();
  const [innerTab, setInnerTab] = useState<"positions" | "history">("positions");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<{ pos: DbPosition; livePrice: number } | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const paperPositions = useMemo(
    () => positions.filter((p) => (p as { tradeType?: string }).tradeType !== "real"),
    [positions],
  );

  const priceTargets = useMemo(
    () =>
      paperPositions
        .filter((p) => p.clobTokenId)
        .map((p) => ({
          id: p.marketId,
          tokenId: p.clobTokenId!,
          fallbackYes: p.avgPrice,
          fallbackNo: 1 - p.avgPrice,
        })),
    [paperPositions],
  );
  const { prices: livePrices, ready: pricesReady } = usePositionLivePrices(priceTargets);

  const getLivePrice = (pos: DbPosition): number | null => {
    if (!pricesReady) return null;
    const live = livePrices[pos.marketId];
    if (!live) return null;
    const isYes = pos.outcome === "Yes" || pos.outcome === "Up";
    return isYes ? live.yesPrice : live.noPrice;
  };

  const paperBalance = user?.balance || 0;
  const paperPositionValue = useMemo(() => {
    let total = 0;
    for (const pos of paperPositions) {
      const live = livePrices[pos.marketId];
      const livePrice = live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice;
      total += pos.shares * livePrice;
    }
    return total;
  }, [paperPositions, livePrices]);
  const paperTotal = paperBalance + paperPositionValue;

  const confirmClose = async () => {
    if (!pendingClose) return;
    const { pos, livePrice } = pendingClose;
    setClosingId(pos.id);
    try {
      await executeTrade({
        marketId: pos.marketId,
        marketQuestion: pos.marketQuestion,
        outcome: pos.outcome,
        side: "sell",
        shares: pos.shares,
        price: livePrice,
      });
    } catch { /* non-critical */ }
    setClosingId(null);
    setPendingClose(null);
  };

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/5 via-[#161b22] to-[#161b22] p-10 text-center">
        <p className="text-[#d4a843] font-semibold mb-2">Log in to see your AIRDROP portfolio</p>
        <p className="text-xs text-[#768390] mb-4">Connect a wallet or sign in with Google.</p>
        <div className="inline-block"><LoginButton /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Close-confirm dialog — mirrors the old /trade confirm UX. */}
      <Dialog open={!!pendingClose} onOpenChange={(open) => { if (!open && !isTrading) setPendingClose(null); }}>
        <DialogContent className="bg-[#161b22] border-[#30363d] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Confirm close position</DialogTitle>
          </DialogHeader>
          {pendingClose && (
            <div className="space-y-3 py-2">
              <p className="text-[13px] text-[#e6edf3] font-medium leading-snug">{pendingClose.pos.marketQuestion}</p>
              <div className="grid grid-cols-2 gap-3 bg-[#0d1117] rounded-lg p-3 border border-[#21262d]">
                <div>
                  <p className="text-[10px] text-[#484f58] uppercase">Side</p>
                  <span className={cn(
                    "text-sm font-semibold",
                    pendingClose.pos.outcome === "Yes" ? "text-[#3fb950]" : "text-[#f85149]",
                  )}>{pendingClose.pos.outcome}</span>
                </div>
                <div>
                  <p className="text-[10px] text-[#484f58] uppercase">Shares</p>
                  <p className="text-sm text-[#e6edf3] tabular-nums">{pendingClose.pos.shares.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#484f58] uppercase">Sell price</p>
                  <p className="text-sm text-[#e6edf3] tabular-nums">{(pendingClose.livePrice * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#484f58] uppercase">Proceeds</p>
                  <p className="text-sm text-[#e6edf3] tabular-nums">
                    {(pendingClose.pos.shares * pendingClose.livePrice).toFixed(0)} AIRDROP
                  </p>
                </div>
              </div>
              {(() => {
                const pnl = (pendingClose.livePrice - pendingClose.pos.avgPrice) * pendingClose.pos.shares;
                return (
                  <div className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 border",
                    pnl >= 0 ? "bg-[#238636]/10 border-[#238636]/20" : "bg-[#f85149]/10 border-[#f85149]/20",
                  )}>
                    <span className="text-xs text-[#768390]">P&L</span>
                    <span className={cn("text-lg font-bold tabular-nums", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)} AIRDROP
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="border-[#30363d] text-[#768390] hover:text-white" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={confirmClose}
              disabled={isTrading && closingId !== null}
              className="bg-[#f85149] hover:bg-[#f85149]/80 text-white font-medium"
            >
              {isTrading && closingId !== null ? "Closing…" : "Confirm Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top row: AIRDROP balance card + PnL chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Balance card */}
        <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/10 via-[#161b22] to-[#161b22] p-5 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">Airdrop Portfolio</p>
            <span className="text-[10px] text-[#f5c542] bg-[#f5c542]/10 border border-[#f5c542]/20 px-1.5 py-0.5 rounded font-medium">AIRDROP</span>
          </div>
          <p className="text-3xl font-bold bg-gradient-to-r from-[#f5c542] to-[#d4a843] bg-clip-text text-transparent tabular-nums">
            {paperTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <div className="flex gap-6 mt-4">
            <div>
              <p className="text-[10px] text-[#d4a843]/60 uppercase tracking-wider">Available to trade</p>
              <p className="text-sm font-semibold text-white tabular-nums mt-0.5">
                {paperBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#d4a843]/60 uppercase tracking-wider">In positions</p>
              <p className="text-sm font-semibold text-white tabular-nums mt-0.5">
                {paperPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        </div>

        {/* PnL chart */}
        <PnlChart />
      </div>

      {/* Positions / History tabs */}
      <div>
        <div className="flex gap-0 border-b border-[#21262d] mb-4">
          <button
            onClick={() => setInnerTab("positions")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors",
              innerTab === "positions" ? "text-white border-b-2 border-[#58a6ff]" : "text-[#768390] hover:text-[#adbac7]",
            )}
          >
            Positions
          </button>
          <button
            onClick={() => setInnerTab("history")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors",
              innerTab === "history" ? "text-white border-b-2 border-[#58a6ff]" : "text-[#768390] hover:text-[#adbac7]",
            )}
          >
            History
          </button>
        </div>

        {innerTab === "positions" && (
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
              <div className="col-span-4">Market</div>
              <div className="col-span-2 text-right">Avg → Now</div>
              <div className="col-span-1 text-right">Traded</div>
              <div className="col-span-1 text-right">To win</div>
              <div className="col-span-2 text-right">Value</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            {paperPositions.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-[#adbac7]">No positions yet</p>
                <p className="text-xs text-[#484f58] mt-2">
                  Head to the{" "}
                  <a href="/airdrop?tab=trade" className="text-[#58a6ff] hover:underline">Airdrop Trade tab</a>
                  {" "}to place one with AIRDROP.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#21262d]">
                {paperPositions.map((pos) => {
                  const livePrice = getLivePrice(pos);
                  const livePriceDisplay = livePrice ?? pos.avgPrice;
                  const value = pos.shares * livePriceDisplay;
                  const pnl = (livePriceDisplay - pos.avgPrice) * pos.shares;
                  const pnlPct = pos.avgPrice > 0 ? ((livePriceDisplay - pos.avgPrice) / pos.avgPrice) * 100 : 0;
                  const traded = pos.shares * pos.avgPrice;
                  const toWin = pos.shares; // $1 per share at resolution
                  const isExpanded = expandedId === pos.id;
                  const isClosing = isTrading && closingId === pos.id;

                  return (
                    <div key={pos.id}>
                      <div
                        className="grid grid-cols-12 gap-2 px-4 py-3 items-center cursor-pointer hover:bg-[#1c2128]/50 transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                      >
                        <div className="col-span-4 min-w-0 flex items-start gap-2">
                          <svg
                            className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0 mt-0.5", isExpanded && "rotate-90")}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              <span className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded",
                                pos.outcome === "Yes" || pos.outcome === "Up"
                                  ? "bg-[#3fb950]/15 text-[#3fb950]"
                                  : "bg-[#f85149]/15 text-[#f85149]",
                              )}>
                                {pos.outcome} {Math.round(pos.avgPrice * 100)}¢
                              </span>
                              <span className="text-[10px] text-[#484f58] tabular-nums">{pos.shares.toFixed(1)} shares</span>
                            </div>
                          </div>
                        </div>
                        <div className="col-span-2 text-right">
                          <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}¢</span>
                          <span className="text-[10px] text-[#484f58] mx-0.5">→</span>
                          <span className={cn("text-xs font-medium tabular-nums", livePrice !== null ? "text-[#e6edf3]" : "text-[#484f58]")}>
                            {Math.round(livePriceDisplay * 100)}¢
                          </span>
                        </div>
                        <div className="col-span-1 text-right">
                          <span className="text-xs text-[#e6edf3] tabular-nums">{traded.toFixed(0)}</span>
                        </div>
                        <div className="col-span-1 text-right">
                          <span className="text-xs text-[#3fb950] tabular-nums font-medium">{toWin.toFixed(0)}</span>
                        </div>
                        <div className="col-span-2 text-right">
                          <span className="text-xs text-[#e6edf3] tabular-nums font-semibold">{value.toFixed(0)}</span>
                          <div className={cn("text-[10px] tabular-nums leading-tight", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)} <span className="opacity-60">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)</span>
                          </div>
                        </div>
                        <div className="col-span-2 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (livePrice === null) return;
                              setPendingClose({ pos, livePrice });
                            }}
                            disabled={isClosing || livePrice === null}
                            className={cn(
                              "px-3 py-1.5 rounded text-[11px] font-semibold transition-colors",
                              isClosing
                                ? "bg-[#21262d] text-[#484f58] cursor-wait"
                                : livePrice === null
                                  ? "bg-[#21262d] text-[#484f58] cursor-not-allowed"
                                  : "bg-[#f85149]/15 text-[#f85149] hover:bg-[#f85149]/25",
                            )}
                          >
                            {isClosing ? "Closing…" : livePrice === null ? "Loading…" : "Close"}
                          </button>
                        </div>
                      </div>

                      {/* Expanded detail: inline price chart + stats row */}
                      {isExpanded && (
                        <div className="px-4 py-3 bg-[#0d1117] border-t border-[#21262d] space-y-3">
                          {pos.clobTokenId ? (
                            <MiniPriceChart tokenId={pos.clobTokenId} />
                          ) : (
                            <p className="text-[11px] text-[#484f58] text-center py-4">No price history for this market</p>
                          )}
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            <div>
                              <p className="text-[#484f58]">Avg. entry</p>
                              <p className="text-[#e6edf3] tabular-nums">{(pos.avgPrice * 100).toFixed(1)}%</p>
                            </div>
                            <div>
                              <p className="text-[#484f58]">Current</p>
                              <p className="text-[#e6edf3] tabular-nums">
                                {livePrice !== null ? `${(livePrice * 100).toFixed(1)}%` : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[#484f58]">End date</p>
                              <p className="text-[#e6edf3]">
                                {pos.marketEndDate ? new Date(pos.marketEndDate).toLocaleDateString() : "—"}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {innerTab === "history" && (
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
              <div className="col-span-1">Side</div>
              <div className="col-span-5">Market</div>
              <div className="col-span-2 text-right">Shares</div>
              <div className="col-span-2 text-right">Price</div>
              <div className="col-span-2 text-right">When</div>
            </div>
            {trades.length === 0 ? (
              <p className="text-sm text-[#484f58] text-center py-12">No trade history</p>
            ) : (
              <div className="divide-y divide-[#21262d]">
                {trades.map((t) => {
                  const time = new Date(t.createdAt);
                  const timeStr =
                    time.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
                    " " +
                    time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  return (
                    <div key={t.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                      <div className="col-span-1">
                        <span className={cn("text-xs font-semibold", t.side === "buy" ? "text-[#3fb950]" : "text-[#f85149]")}>
                          {t.side.toUpperCase()}
                        </span>
                      </div>
                      <div className="col-span-5">
                        <p className="text-[13px] text-[#e6edf3] leading-snug line-clamp-1">{t.marketQuestion}</p>
                        <p className="text-[10px] text-[#484f58]">{t.outcome}</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-xs text-[#e6edf3] tabular-nums">{t.shares.toFixed(1)}</span>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-xs text-[#e6edf3] tabular-nums">{Math.round(t.price * 100)}¢</span>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-[10px] text-[#484f58]">{timeStr}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
