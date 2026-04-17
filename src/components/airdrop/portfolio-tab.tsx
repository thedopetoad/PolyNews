"use client";

import { useMemo } from "react";
import { useUser } from "@/hooks/use-user";
import { usePositionLivePrices } from "@/hooks/use-live-prices";
import { LoginButton } from "@/components/layout/login-modal";
import { cn } from "@/lib/utils";
import { PnlChart } from "./pnl-chart";

// AIRDROP-side (paper) portfolio. Mirrors the paper sub-sections that
// used to live on /portfolio, plus a PnL chart up top. Real-money
// (USDC) portfolio stays at /portfolio.
//
// "Available to trade" = user's cash balance only (liquid AIRDROP).
// "Total Airdrop" = balance + sum of open-position market value at
// live CLOB midpoints (fallbacks to entry price when the midpoint
// hasn't loaded yet).

export function AirdropPortfolioTab() {
  const { address, isConnected, user, positions, trades } = useUser();
  const paperPositions = useMemo(() => positions.filter((p) => (p as { tradeType?: string }).tradeType !== "real"), [positions]);

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
    [paperPositions]
  );
  const { prices: livePrices } = usePositionLivePrices(priceTargets);

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

      {/* Open positions */}
      <section>
        <h2 className="text-sm font-semibold text-[#f5c542] mb-2">Open positions</h2>
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-4">Market</div>
            <div className="col-span-2 text-right">Avg → Now</div>
            <div className="col-span-2 text-right">Shares</div>
            <div className="col-span-2 text-right">P&L</div>
            <div className="col-span-2 text-right">Value</div>
          </div>
          {paperPositions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#484f58]">No open paper positions</p>
              <p className="text-xs text-[#484f58] mt-2">Head to the <a href="/airdrop?tab=trade" className="text-[#f5c542] hover:underline">Trade</a> tab to place one.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {paperPositions.map((pos) => {
                const live = livePrices[pos.marketId];
                const livePrice = live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice;
                const value = pos.shares * livePrice;
                const pnl = (livePrice - pos.avgPrice) * pos.shares;
                const pnlPct = pos.avgPrice > 0 ? ((livePrice - pos.avgPrice) / pos.avgPrice) * 100 : 0;
                return (
                  <div key={pos.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                    <div className="col-span-4 min-w-0">
                      <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                      <p className="text-[10px] text-[#484f58] mt-0.5">{pos.outcome}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}¢</span>
                      <span className="text-[10px] text-[#484f58] mx-0.5">→</span>
                      <span className={cn("text-xs font-medium tabular-nums", live ? "text-[#e6edf3]" : "text-[#484f58]")}>
                        {Math.round(livePrice * 100)}¢
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pos.shares.toFixed(1)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className={cn("text-xs font-medium tabular-nums", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}
                      </span>
                      <span className={cn("text-[10px] ml-1 tabular-nums", pnl >= 0 ? "text-[#3fb950]/60" : "text-[#f85149]/60")}>
                        ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">
                        {value.toFixed(0)} <span className="text-[#484f58]">AIRDROP</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Trade history */}
      <section>
        <h2 className="text-sm font-semibold text-[#f5c542] mb-2">Trade history</h2>
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
      </section>
    </div>
  );
}
