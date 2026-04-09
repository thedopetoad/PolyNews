"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { useUser, DbPosition } from "@/hooks/use-user";
import { useQuery } from "@tanstack/react-query";
import {
  parseMarketPrices,
  formatPercentage,
  formatVolume,
  PolymarketEvent,
  MarketWithPrices,
} from "@/types/polymarket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AIRDROP_AMOUNTS, POLYMARKET_BASE_URL } from "@/lib/constants";
import { LoginButton } from "@/components/layout/login-modal";
import { getTopConsensusMarkets } from "@/lib/market-filters";
import { useLivePrices, usePositionLivePrices } from "@/hooks/use-live-prices";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

/* ─── Daily Countdown ─── */
function DailyCountdown() {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const ms = tomorrow.getTime() - now.getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);
  return (
    <span className="px-3 py-1.5 rounded text-[11px] font-medium border border-[#21262d] text-[#484f58] inline-block">
      Next claim in {timeLeft}
    </span>
  );
}

/* ─── Consensus Result Type ─── */
interface ConsensusResult {
  consensus: number;
  confidence: number;
  trend: string;
}

/* ─── Trade Confirmation Dialog ─── */
interface PendingTrade {
  marketQuestion: string;
  outcome: string;
  shares: number;
  price: number;
  cost: number;
  side: "buy" | "sell";
  potentialWin?: number;
  pnl?: number;
}

function TradeConfirmDialog({
  pending,
  onClose,
  onConfirm,
  isLoading,
}: {
  pending: PendingTrade | null;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  if (!pending) return null;
  const isBuy = pending.side === "buy";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isBuy ? "Confirm Buy" : "Confirm Close Position"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-[13px] text-[#e6edf3] font-medium leading-snug">{pending.marketQuestion}</p>

          <div className="grid grid-cols-2 gap-3 bg-[#0d1117] rounded-lg p-3 border border-[#21262d]">
            <div>
              <p className="text-[10px] text-[#484f58] uppercase">Side</p>
              <span className={cn(
                "text-sm font-semibold",
                pending.outcome === "Yes" ? "text-[#3fb950]" : "text-[#f85149]"
              )}>
                {pending.outcome}
              </span>
            </div>
            <div>
              <p className="text-[10px] text-[#484f58] uppercase">Shares</p>
              <p className="text-sm text-[#e6edf3] tabular-nums">{pending.shares}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#484f58] uppercase">Price</p>
              <p className="text-sm text-[#e6edf3] tabular-nums">{(pending.price * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-[#484f58] uppercase">{isBuy ? "Cost" : "Proceeds"}</p>
              <p className="text-sm text-[#e6edf3] tabular-nums">{pending.cost.toFixed(2)} AIRDROP</p>
            </div>
          </div>

          {isBuy && pending.potentialWin !== undefined && pending.potentialWin > 0 && (
            <div className="flex items-center justify-between bg-[#238636]/10 rounded-lg px-3 py-2 border border-[#238636]/20">
              <span className="text-xs text-[#768390]">Potential win</span>
              <span className="text-lg font-bold text-[#3fb950] tabular-nums">{pending.potentialWin.toFixed(0)} AIRDROP</span>
            </div>
          )}

          {!isBuy && pending.pnl !== undefined && (
            <div className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 border",
              pending.pnl >= 0
                ? "bg-[#238636]/10 border-[#238636]/20"
                : "bg-[#f85149]/10 border-[#f85149]/20"
            )}>
              <span className="text-xs text-[#768390]">P&L</span>
              <span className={cn("text-lg font-bold tabular-nums", pending.pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                {pending.pnl >= 0 ? "+" : ""}{pending.pnl.toFixed(0)} AIRDROP
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="border-[#30363d] text-[#768390] hover:text-white" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "font-medium",
              isBuy
                ? "bg-[#238636] hover:bg-[#2ea043] text-white"
                : "bg-[#f85149] hover:bg-[#f85149]/80 text-white"
            )}
          >
            {isLoading ? "Processing..." : isBuy ? "Confirm Buy" : "Confirm Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Mini Price Chart (pure SVG, no dependencies) ─── */
function MiniPriceChart({ tokenId }: { tokenId: string }) {
  const [history, setHistory] = useState<{ t: number; p: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ x: number; price: number; date: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/polymarket/price-history?token_id=${tokenId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.history?.length) setHistory(data.history);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tokenId]);

  if (loading) return <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">Loading chart...</div>;
  if (history.length < 2) return <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">No price history</div>;

  const W = 400;
  const H = 80;
  const prices = history.map((h) => h.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.01;

  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W;
    const y = H - 4 - ((p - min) / range) * (H - 8);
    return `${x},${y}`;
  });

  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? "#3fb950" : "#f85149";
  const gradientId = `grad-${tokenId.slice(0, 8)}`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (history.length - 1));
    const clamped = Math.max(0, Math.min(history.length - 1, idx));
    const point = history[clamped];
    const date = new Date(point.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    setHover({ x: (clamped / (history.length - 1)) * W, price: point.p, date });
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[80px] cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {hover && (
          <line x1={hover.x} y1={0} x2={hover.x} y2={H} stroke="#484f58" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3,3" />
        )}
      </svg>
      {hover && (
        <div
          className="absolute top-0 pointer-events-none bg-[#1c2128] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white whitespace-nowrap z-10"
          style={{ left: `${(hover.x / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <span className="font-semibold tabular-nums" style={{ color }}>{(hover.price * 100).toFixed(1)}%</span>
          <span className="text-[#484f58] ml-1.5">{hover.date}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Expandable Position Detail ─── */
function PositionDetail({ pos, livePrice }: { pos: DbPosition; livePrice: number | null }) {
  return (
    <div className="px-4 py-3 bg-[#0d1117] border-t border-[#21262d] space-y-3">
      {pos.clobTokenId && (
        <MiniPriceChart tokenId={pos.clobTokenId} />
      )}

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-[#484f58]">Avg. Buy Price</p>
          <p className="text-[#e6edf3] tabular-nums">{(pos.avgPrice * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[#484f58]">Current Price</p>
          <p className="text-[#e6edf3] tabular-nums">
            {livePrice !== null ? `${(livePrice * 100).toFixed(1)}%` : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-[#484f58]">End Date</p>
          <p className="text-[#e6edf3]">
            {pos.marketEndDate ? new Date(pos.marketEndDate).toLocaleDateString() : "N/A"}
          </p>
        </div>
      </div>

      {pos.eventSlug && (
        <a
          href={`${POLYMARKET_BASE_URL}/event/${pos.eventSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[#58a6ff] hover:underline"
        >
          View on Polymarket
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        </a>
      )}
    </div>
  );
}

/* ─── Portfolio Tab ─── */
function PortfolioTab({ allMarkets, onSwitchTab }: { allMarkets: MarketWithPrices[]; onSwitchTab: () => void }) {
  const { user, positions, trades, isConnected, claimAirdrop, isClaimingAirdrop, executeTrade, isTrading, address, setDisplayName, isSettingName } = useUser();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedToday, setClaimedToday] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  // Build price targets from stored clobTokenIds on positions
  const priceTargets = useMemo(() => {
    return positions
      .map((pos) => {
        let tokenId = pos.clobTokenId || "";
        if (!tokenId) {
          const market = allMarkets.find((m) => m.id === pos.marketId)
            || allMarkets.find((m) => m.question === pos.marketQuestion);
          if (market?.clobTokenIds) {
            try { const ids = JSON.parse(market.clobTokenIds); tokenId = ids[0] || ""; } catch {}
          }
        }
        // avgPrice is the price paid for the chosen outcome.
        // For Yes positions: avgPrice = yesPrice. For No positions: avgPrice = noPrice.
        const isYes = pos.outcome === "Yes" || pos.outcome === "Up";
        const fallbackYes = isYes ? pos.avgPrice : 1 - pos.avgPrice;
        const fallbackNo = isYes ? 1 - pos.avgPrice : pos.avgPrice;
        return { id: pos.marketId, tokenId, fallbackYes, fallbackNo };
      })
      .filter((t) => t.tokenId);
  }, [positions, allMarkets]);
  const { getPrice: getPositionLivePrice, ready: positionPricesReady } = usePositionLivePrices(priceTargets);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<{ pos: DbPosition; livePrice: number } | null>(null);

  if (!isConnected || !user) {
    return (
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-12 text-center space-y-4">
        <p className="text-[#768390]">Log in to start paper trading</p>
        <LoginButton />
      </div>
    );
  }

  const todayUTC = new Date().toISOString().slice(0, 10);
  const dailyClaimed = claimedToday || user.lastDailyAirdrop === todayUTC;

  const handleClaim = async () => {
    setClaimError(null);
    try {
      await claimAirdrop("daily");
      setClaimedToday(true);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "Already claimed today") {
        setClaimedToday(true); // Server says already claimed — show countdown
      } else {
        setClaimError(e instanceof Error ? e.message : "Claim failed");
      }
    }
  };

  const getLivePrice = (pos: DbPosition): number | null => {
    // Wait for CLOB prices before showing any price — prevents stale fallback bugs
    if (!positionPricesReady) return null;
    const isYes = pos.outcome === "Yes" || pos.outcome === "Up";
    const fallbackYes = isYes ? pos.avgPrice : 1 - pos.avgPrice;
    const fallbackNo = isYes ? 1 - pos.avgPrice : pos.avgPrice;
    const live = getPositionLivePrice(pos.marketId, fallbackYes, fallbackNo);
    return isYes ? live.yesPrice : live.noPrice;
  };

  const handleClose = (pos: DbPosition) => {
    const livePrice = getLivePrice(pos);
    if (livePrice === null) return;
    setPendingClose({ pos, livePrice });
  };

  const confirmClose = async () => {
    if (!pendingClose) return;
    const { pos, livePrice } = pendingClose;
    setClosingId(pos.id);
    try {
      await executeTrade({
        marketId: pos.marketId,
        marketQuestion: pos.marketQuestion,
        outcome: pos.outcome as "Yes" | "No" | "Up" | "Down",
        side: "sell",
        shares: pos.shares,
        price: livePrice,
      });
    } catch {}
    setClosingId(null);
    setPendingClose(null);
  };

  // Calculate total portfolio value
  const positionValues = positions.map((pos) => {
    const livePrice = getLivePrice(pos);
    return livePrice !== null ? pos.shares * livePrice : pos.shares * pos.avgPrice;
  });
  const totalPortfolioValue = user.balance + positionValues.reduce((sum, v) => sum + v, 0);

  return (
    <div className="space-y-4">
      {/* Confirmation Dialog */}
      <TradeConfirmDialog
        pending={pendingClose ? {
          marketQuestion: pendingClose.pos.marketQuestion,
          outcome: pendingClose.pos.outcome,
          shares: pendingClose.pos.shares,
          price: pendingClose.livePrice,
          cost: pendingClose.pos.shares * pendingClose.livePrice,
          side: "sell",
          pnl: (pendingClose.livePrice - pendingClose.pos.avgPrice) * pendingClose.pos.shares,
        } : null}
        onClose={() => setPendingClose(null)}
        onConfirm={confirmClose}
        isLoading={isTrading && closingId !== null}
      />

      {/* Username + Balance Card */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
        {/* Username */}
        <div className="mb-3 pb-3 border-b border-[#21262d]">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Username (2-20 chars)"
                className="bg-[#0d1117] border-[#21262d] text-white h-8 text-sm max-w-[200px]"
                maxLength={20}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    setNameError(null);
                    try {
                      await setDisplayName(nameInput.trim());
                      setEditingName(false);
                    } catch (err: unknown) {
                      setNameError(err instanceof Error ? err.message : "Failed");
                    }
                  } else if (e.key === "Escape") {
                    setEditingName(false);
                  }
                }}
                autoFocus
              />
              <button
                onClick={async () => {
                  setNameError(null);
                  try {
                    await setDisplayName(nameInput.trim());
                    setEditingName(false);
                  } catch (err: unknown) {
                    setNameError(err instanceof Error ? err.message : "Failed");
                  }
                }}
                disabled={isSettingName}
                className="px-2 py-1 rounded text-[11px] font-medium bg-[#238636] text-white hover:bg-[#2ea043]"
              >
                {isSettingName ? "..." : "Save"}
              </button>
              <button onClick={() => setEditingName(false)} className="text-[11px] text-[#484f58] hover:text-white">Cancel</button>
              {nameError && <span className="text-[10px] text-[#f85149]">{nameError}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {user.displayName ? (
                <span className="text-sm font-semibold text-[#e6edf3]">{user.displayName}</span>
              ) : (
                <span className="text-sm text-[#484f58]">No username set</span>
              )}
              <button
                onClick={() => { setNameInput(user.displayName || ""); setEditingName(true); }}
                className="text-[10px] text-[#58a6ff] hover:underline"
              >
                {user.displayName ? "edit" : "set username"}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Cash Balance</p>
            <p className="text-2xl font-bold text-white tabular-nums">
              {user.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal text-[#484f58] ml-1">AIRDROP</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Total Portfolio</p>
            <p className="text-lg font-bold text-white tabular-nums">
              {totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} AIRDROP
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {dailyClaimed || claimError === "Already claimed today" ? (
            <DailyCountdown />
          ) : (
            <button
              onClick={handleClaim}
              disabled={isClaimingAirdrop}
              className="px-3 py-1.5 rounded text-[11px] font-medium bg-[#238636] hover:bg-[#2ea043] text-white transition-colors"
            >
              {isClaimingAirdrop ? "Claiming..." : `Claim ${AIRDROP_AMOUNTS.daily} AIRDROP`}
            </button>
          )}
          {claimError && claimError !== "Already claimed today" && (
            <span className="text-[10px] text-[#f85149]">{claimError}</span>
          )}
          <span className="text-[11px] text-[#484f58] ml-auto">{positions.length} positions &middot; {trades.length} trades</span>
        </div>
      </div>

      {/* Open Positions */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#21262d]">
          <h3 className="text-sm font-semibold text-white">Open Positions</h3>
        </div>

        {positions.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[#484f58]">No open positions</p>
            <button onClick={onSwitchTab} className="text-xs text-[#58a6ff] hover:underline mt-2">
              Browse tradable markets
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#21262d]">
            {/* Header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-[#484f58] uppercase tracking-wider">
              <div className="col-span-4">Market</div>
              <div className="col-span-1 text-center">Side</div>
              <div className="col-span-1 text-center">Shares</div>
              <div className="col-span-2 text-center">Buy-in</div>
              <div className="col-span-2 text-center">Live / P&L</div>
              <div className="col-span-2 text-center">Action</div>
            </div>

            {positions.map((pos) => {
              const livePrice = getLivePrice(pos);
              const pnl = livePrice !== null ? (livePrice - pos.avgPrice) * pos.shares : null;
              const pnlPct = livePrice !== null && pos.avgPrice > 0 ? ((livePrice - pos.avgPrice) / pos.avgPrice) * 100 : null;
              const isExpanded = expandedId === pos.id;

              return (
                <div key={pos.id}>
                  {/* Desktop */}
                  <div
                    className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 items-center cursor-pointer hover:bg-[#1c2128]/50 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                  >
                    <div className="col-span-4 flex items-center gap-2">
                      <svg className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0", isExpanded && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      <p className="text-[13px] text-[#e6edf3] font-medium truncate">{pos.marketQuestion}</p>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className={cn(
                        "text-[11px] font-semibold px-2 py-0.5 rounded",
                        pos.outcome === "Yes" ? "bg-[#238636]/15 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"
                      )}>
                        {pos.outcome}
                      </span>
                    </div>
                    <div className="col-span-1 text-center text-sm text-[#adbac7] tabular-nums">{pos.shares}</div>
                    <div className="col-span-2 text-center text-sm text-[#adbac7] tabular-nums">{(pos.avgPrice * 100).toFixed(0)}%</div>
                    <div className="col-span-2 text-center">
                      {livePrice !== null ? (
                        <div>
                          <p className="text-sm text-[#e6edf3] tabular-nums">{(livePrice * 100).toFixed(0)}%</p>
                          <p className={cn("text-[11px] font-semibold tabular-nums", pnl! >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                            {pnl! >= 0 ? "+" : ""}{pnl!.toFixed(0)} AIRDROP ({pnlPct! >= 0 ? "+" : ""}{pnlPct!.toFixed(0)}%)
                          </p>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#484f58]">Price unavailable</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleClose(pos); }}
                        disabled={(isTrading && closingId === pos.id) || livePrice === null}
                        className="px-3 py-1.5 rounded text-[11px] font-medium bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors disabled:opacity-50"
                      >
                        {isTrading && closingId === pos.id ? "Closing..." : "Close"}
                      </button>
                    </div>
                  </div>

                  {/* Mobile */}
                  <div
                    className="sm:hidden px-4 py-3 space-y-2 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                  >
                    <div className="flex items-start gap-2">
                      <svg className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0 mt-0.5", isExpanded && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      <p className="text-[13px] text-[#e6edf3] font-medium">{pos.marketQuestion}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "text-[11px] font-semibold px-2 py-0.5 rounded",
                          pos.outcome === "Yes" ? "bg-[#238636]/15 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"
                        )}>
                          {pos.outcome}
                        </span>
                        <span className="text-xs text-[#adbac7]">{pos.shares} @ {(pos.avgPrice * 100).toFixed(0)}%</span>
                        {pnl !== null && (
                          <span className={cn("text-xs font-semibold", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)} AIRDROP
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleClose(pos); }}
                        disabled={(isTrading && closingId === pos.id) || livePrice === null}
                        className="px-3 py-1.5 rounded text-[11px] font-medium bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors disabled:opacity-50"
                      >
                        {isTrading && closingId === pos.id ? "..." : "Close"}
                      </button>
                    </div>
                  </div>

                  {/* Expandable Detail */}
                  {isExpanded && <PositionDetail pos={pos} livePrice={livePrice} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Tradable Markets Tab ─── */
/* ─── Sports Multi-Outcome Chart (for trade page) ─── */
const CHART_COLORS = ["#4d8fea", "#8b949e", "#58a6ff", "#da3633", "#3fb950"];

function SportsTradeChart({ market }: { market: MarketWithPrices }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [seriesData, setSeriesData] = useState<{ t: number; p: number }[][]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ xPct: number; values: { name: string; price: number; yPct: number; color: string }[]; date: string } | null>(null);

  // Parse outcomes and token IDs
  const outcomes = useMemo(() => {
    let names: string[] = [];
    let tokenIds: string[] = [];
    try { names = JSON.parse(market.outcomes || "[]"); } catch {}
    try { tokenIds = JSON.parse(market.clobTokenIds || "[]"); } catch {}
    // For binary markets: first token is fetched, second derived
    return names.map((name, i) => ({
      name,
      tokenId: tokenIds[i] || "",
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [market.outcomes, market.clobTokenIds]);

  useEffect(() => {
    if (outcomes.length === 0) { setLoading(false); return; }
    let cancelled = false;
    const firstToken = outcomes.find((o) => o.tokenId)?.tokenId;
    if (!firstToken) { setLoading(false); return; }

    const uniqueTokens = [...new Set(outcomes.filter((o) => o.tokenId).map((o) => o.tokenId))];
    Promise.all(
      uniqueTokens.map((tid) =>
        fetch(`/api/polymarket/price-history?token_id=${tid}`)
          .then((r) => r.json())
          .then((d) => ({ tid, history: d.history || [] }))
          .catch(() => ({ tid, history: [] }))
      )
    ).then((results) => {
      if (cancelled) return;
      const historyMap: Record<string, { t: number; p: number }[]> = {};
      for (const r of results) historyMap[r.tid] = r.history;

      const series = outcomes.map((o) => {
        if (o.tokenId && historyMap[o.tokenId]) return historyMap[o.tokenId];
        const base = historyMap[firstToken];
        if (base) return base.map((pt) => ({ t: pt.t, p: 1 - pt.p }));
        return [];
      });
      setSeriesData(series);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [outcomes]);

  const currentPcts = useMemo(() =>
    seriesData.map((s) => (s.length > 0 ? Math.round(s[s.length - 1].p * 100) : 0)),
    [seriesData]
  );

  if (loading) return <div className="h-[120px] flex items-center justify-center text-[10px] text-[#484f58]">Loading chart...</div>;
  if (seriesData.every((s) => s.length < 2)) return <div className="h-[120px] flex items-center justify-center text-[10px] text-[#484f58]">No history</div>;

  const refSeries = seriesData.reduce((a, b) => (a.length >= b.length ? a : b), []);
  const W = 400, H = 120;
  const allPrices = seriesData.flatMap((s) => s.map((pt) => pt.p));
  const pMin = Math.min(...allPrices), pMax = Math.max(...allPrices);
  const pRange = pMax - pMin || 0.01;

  const paths = seriesData.map((series) => {
    if (series.length < 2) return "";
    return series.map((pt, i) => {
      const x = (i / (series.length - 1)) * W;
      const y = H - 4 - ((pt.p - pMin) / pRange) * (H - 8);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const values = seriesData.map((series, i) => {
      const idx = Math.round(ratio * (series.length - 1));
      const clamped = Math.max(0, Math.min(series.length - 1, idx));
      const price = series[clamped]?.p ?? 0;
      const yPct = ((price - pMin) / pRange) * 100;
      return { name: outcomes[i].name, price, yPct, color: outcomes[i].color };
    });
    const refIdx = Math.round(ratio * (refSeries.length - 1));
    const refPt = refSeries[Math.max(0, Math.min(refSeries.length - 1, refIdx))];
    const date = refPt ? new Date(refPt.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    setHover({ xPct: ratio * 100, values, date });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
        {outcomes.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: o.color }} />
            <span className="text-[11px] text-[#adbac7]">{o.name}</span>
            <span className="text-[11px] font-semibold text-[#e6edf3]">{currentPcts[i]}%</span>
          </div>
        ))}
      </div>
      <div className="relative h-[120px] cursor-crosshair" onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          {paths.map((d, i) => d && (
            <path key={i} d={d} fill="none" stroke={outcomes[i].color} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.9} />
          ))}
        </svg>
        {hover && (
          <>
            <div className="absolute top-0 bottom-0 w-px pointer-events-none" style={{ left: `${hover.xPct}%`, background: "repeating-linear-gradient(to bottom, #484f58 0px, #484f58 3px, transparent 3px, transparent 6px)" }} />
            {hover.values.map((v, i) => (
              <div key={i} className="absolute w-[9px] h-[9px] rounded-full pointer-events-none border-2 border-[#0d1117]" style={{ left: `${hover.xPct}%`, bottom: `${v.yPct}%`, backgroundColor: v.color, transform: "translate(-50%, 50%)" }} />
            ))}
            <div className="absolute pointer-events-none bg-[#1c2128] border border-[#30363d] rounded px-2 py-1.5 text-[11px] whitespace-nowrap z-10" style={{ left: `${hover.xPct}%`, bottom: -4, transform: `translateY(100%) ${hover.xPct > 75 ? "translateX(-100%)" : hover.xPct < 25 ? "" : "translateX(-50%)"}` }}>
              {hover.values.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
                  <span className="font-semibold tabular-nums" style={{ color: v.color }}>{(v.price * 100).toFixed(1)}%</span>
                </div>
              ))}
              <div className="text-[#484f58] text-[10px] mt-0.5">{hover.date}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Sports market types ─── */
interface SportsMarket {
  id: string;
  question: string;
  slug: string;
  groupItemTitle: string;
  outcomes: string[];
  prices: number[];
  clobTokenIds: string[];
  volume: number;
  endDate: string;
}

interface SportsEvent {
  id: string;
  title: string;
  slug: string;
  image: string;
  gameStartTime: string;
  endDate: string;
  volume: number;
  liquidity: number;
  markets: SportsMarket[];
  negRisk: boolean;
  espnLive?: boolean;
}

interface SportsLeague {
  code: string;
  name: string;
  emoji: string;
}

function sportsToTradeable(event: SportsEvent, market: SportsMarket, leagueEmoji: string, leagueName: string): MarketWithPrices & { _sportLabel: string; _isLive: boolean; _gameTime: string } {
  return {
    id: market.id,
    question: market.question,
    slug: market.slug,
    endDate: market.endDate,
    outcomes: JSON.stringify(market.outcomes),
    outcomePrices: JSON.stringify(market.prices.map(String)),
    clobTokenIds: JSON.stringify(market.clobTokenIds),
    volume: String(market.volume),
    eventSlug: event.slug,
    category: "Sports",
    yesPrice: market.prices[0] || 0.5,
    noPrice: market.prices[1] || (1 - (market.prices[0] || 0.5)),
    parsedOutcomes: market.outcomes.length > 0 ? market.outcomes : ["Yes", "No"],
    // Defaults for unused PolymarketMarket fields
    conditionId: "", liquidity: "0", volume24hr: "0", active: true, closed: false,
    marketMakerAddress: "", image: event.image || "", icon: "", description: "",
    groupItemTitle: market.groupItemTitle, enableOrderBook: true,
    // Sports-specific metadata
    _sportLabel: `${leagueEmoji} ${leagueName}`,
    _isLive: event.espnLive === true,
    _gameTime: event.gameStartTime,
  };
}

function TradableMarketsTab({ allMarkets, events, onBought }: {
  allMarkets: MarketWithPrices[];
  events: PolymarketEvent[];
  onBought: () => void;
}) {
  const { user, isConnected, executeTrade, isTrading } = useUser();
  const [selectedMarket, setSelectedMarket] = useState<MarketWithPrices | null>(null);
  const [outcome, setOutcome] = useState<"Yes" | "No">("Yes");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [consensusResults, setConsensusResults] = useState<Record<string, ConsensusResult>>({});
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);
  const [pendingBuy, setPendingBuy] = useState<{
    market: MarketWithPrices;
    outcome: "Yes" | "No";
    shares: number;
    price: number;
    cost: number;
    potentialWin: number;
  } | null>(null);

  // Get the 10 AI consensus markets
  const consensusMarkets = useMemo(() => getTopConsensusMarkets(events), [events]);
  const { getPrice, ready: pricesReady } = useLivePrices(consensusMarkets);

  // ─── Fetch sports markets from all leagues ───
  const { data: leaguesData } = useQuery({
    queryKey: ["sports-leagues-trade"],
    queryFn: async () => {
      const res = await fetch("/api/sports/leagues");
      if (!res.ok) return { leagues: [] };
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const leagues: SportsLeague[] = leaguesData?.leagues || [];

  const { data: allSportsData, isLoading: sportsLoading } = useQuery({
    queryKey: ["sports-all-trade", leagues.map((l) => l.code).join(",")],
    queryFn: async () => {
      if (leagues.length === 0) return [];
      const results = await Promise.all(
        leagues.map(async (l) => {
          try {
            const res = await fetch(`/api/sports/events?sport=${l.code}`);
            if (!res.ok) return [];
            const data = await res.json();
            return ((data.events || []) as SportsEvent[]).map((e) => ({ event: e, league: l }));
          } catch { return []; }
        })
      );
      return results.flat();
    },
    enabled: leagues.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  // Transform sports events into tradeable MarketWithPrices
  const sportsMarkets = useMemo(() => {
    if (!allSportsData || allSportsData.length === 0) return [];
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    const markets: (MarketWithPrices & { _sportLabel: string; _isLive: boolean; _gameTime: string })[] = [];

    for (const { event, league } of allSportsData) {
      const gs = new Date(event.gameStartTime).getTime();
      // Only include live games or games starting within 24 hours
      const isLive = event.espnLive === true;
      const isUpcoming = gs > now && gs - now < twentyFourHours;
      if (!isLive && !isUpcoming) continue;

      // Get moneyline market (main bet — skip spreads, totals, props)
      let moneyline: SportsMarket | null = null;
      for (const m of event.markets) {
        const q = m.question.toLowerCase();
        if (!q.includes("spread") && !q.includes("o/u") && !q.includes(":") && !q.includes("halftime") && !q.includes("exact")) {
          moneyline = m;
          break;
        }
      }
      // Fallback for negRisk events
      if (!moneyline && event.markets.length > 0) moneyline = event.markets[0];
      if (!moneyline || !moneyline.clobTokenIds[0]) continue;

      // Skip settled markets
      if (moneyline.prices.some((p) => p >= 0.95)) continue;

      markets.push(sportsToTradeable(event, moneyline, league.emoji, league.name));
    }

    // Sort: live games first, then by start time
    markets.sort((a, b) => {
      if (a._isLive && !b._isLive) return -1;
      if (!a._isLive && b._isLive) return 1;
      return new Date(a._gameTime).getTime() - new Date(b._gameTime).getTime();
    });

    return markets;
  }, [allSportsData]);

  // Live prices for sports markets
  const { getPrice: getSportsPrice, ready: sportsPricesReady } = useLivePrices(sportsMarkets);

  // Fetch consensus results for the AI markets
  useEffect(() => {
    if (consensusMarkets.length === 0) return;
    consensusMarkets.forEach(async (market) => {
      if (consensusResults[market.id]) return;
      try {
        const res = await fetch("/api/consensus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ marketQuestion: market.question, currentYesPrice: market.yesPrice }),
        });
        if (res.ok) {
          const result = await res.json();
          setConsensusResults((prev) => ({ ...prev, [market.id]: result }));
        }
      } catch {}
    });
  }, [consensusMarkets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use the right price getter depending on which section the selected market is from
  const isSportsMarket = selectedMarket ? sportsMarkets.some((m) => m.id === selectedMarket.id) : false;
  const selectedLive = selectedMarket ? (isSportsMarket ? getSportsPrice(selectedMarket) : getPrice(selectedMarket)) : null;
  const price = selectedLive ? (outcome === "Yes" ? selectedLive.yesPrice : selectedLive.noPrice) : 0;
  const shares = parseFloat(amount) || 0;
  const cost = shares * price;
  const balance = user?.balance || 0;
  const canTrade = isConnected && shares > 0 && cost <= balance;

  const handleBuy = () => {
    if (!selectedMarket || !canTrade) return;
    setError(null);
    const potentialWin = cost / price - cost;
    setPendingBuy({ market: selectedMarket, outcome, shares, price, cost, potentialWin });
  };

  const confirmBuy = async () => {
    if (!pendingBuy) return;
    const { market, outcome: buyOutcome, shares: buyShares, price: buyPrice } = pendingBuy;
    try {
      let tokenId = "";
      try { const ids = JSON.parse(market.clobTokenIds || "[]"); tokenId = ids[0] || ""; } catch {}
      await executeTrade({
        marketId: market.id,
        marketQuestion: market.question,
        outcome: buyOutcome,
        side: "buy",
        shares: buyShares,
        price: buyPrice,
        clobTokenId: tokenId,
        marketEndDate: market.endDate,
        eventSlug: market.eventSlug || market.slug,
      });
      setSelectedMarket(null);
      setAmount("");
      setPendingBuy(null);
      onBought();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Trade failed");
      setPendingBuy(null);
    }
  };

  const renderMarketRow = (market: MarketWithPrices, label: string, priceGetter: (m: MarketWithPrices) => { yesPrice: number; noPrice: number }, consensus?: ConsensusResult, rowIndex?: number) => {
    const isExpanded = expandedMarketId === market.id;
    let tokenId = "";
    try { const ids = JSON.parse(market.clobTokenIds || "[]"); tokenId = ids[0] || ""; } catch {}
    const liveP = priceGetter(market);

    return (
      <div key={market.id} className="animate-fade-in-up" style={{ animationDelay: `${(rowIndex ?? 0) * 50}ms`, animationFillMode: "backwards" }}>
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-3 border-b border-[#21262d] last:border-b-0 transition-colors cursor-pointer",
            selectedMarket?.id === market.id ? "bg-[#1c2128]" : "hover:bg-[#1c2128]/50"
          )}
          onClick={() => setExpandedMarketId(isExpanded ? null : market.id)}
        >
          {/* Chevron */}
          <svg className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0", isExpanded && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>

          {/* Market info */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{market.question}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-[#484f58]">{formatVolume(market.volume)}</span>
              <span className="text-[10px] text-[#484f58]">{label}</span>
              {consensus && (
                <span className="text-[10px] text-[#58a6ff]">AI: {consensus.consensus.toFixed(0)}%</span>
              )}
            </div>
          </div>

          {/* Live odds */}
          <div className="flex gap-2 flex-shrink-0">
            {market.category === "Sports" && market.parsedOutcomes.length >= 2 ? (
              <>
                <span className="text-xs font-semibold text-[#3fb950] tabular-nums">{market.parsedOutcomes[0].split(/\s+/).pop()} {formatPercentage(liveP.yesPrice)}</span>
                <span className="text-xs font-semibold text-[#f85149] tabular-nums">{market.parsedOutcomes[1].split(/\s+/).pop()} {formatPercentage(liveP.noPrice)}</span>
              </>
            ) : (
              <>
                <span className="text-xs font-semibold text-[#3fb950] tabular-nums">Yes {formatPercentage(liveP.yesPrice)}</span>
                <span className="text-xs font-semibold text-[#f85149] tabular-nums">No {formatPercentage(liveP.noPrice)}</span>
              </>
            )}
          </div>

          {/* Trade button */}
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedMarket(selectedMarket?.id === market.id ? null : market); setOutcome("Yes"); setAmount(""); setError(null); }}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded text-[11px] font-medium transition-colors",
              selectedMarket?.id === market.id
                ? "bg-[#21262d] text-[#768390]"
                : "bg-[#238636]/15 text-[#3fb950] hover:bg-[#238636]/25"
            )}
          >
            {selectedMarket?.id === market.id ? "Cancel" : "Trade"}
          </button>
        </div>

        {/* Expandable Detail */}
        {isExpanded && (
          <div className="px-4 py-3 bg-[#0d1117] border-b border-[#21262d] space-y-3">
            {/* Multi-outcome chart for sports, single-line for others */}
            {market.category === "Sports" && tokenId ? (
              <SportsTradeChart market={market} />
            ) : tokenId ? (
              <MiniPriceChart tokenId={tokenId} />
            ) : null}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-[#484f58]">Volume</p>
                <p className="text-[#e6edf3]">{formatVolume(market.volume)}</p>
              </div>
              <div>
                <p className="text-[#484f58]">{market.category === "Sports" ? "Game Time" : "End Date"}</p>
                <p className="text-[#e6edf3]">
                  {market.category === "Sports" && (market as MarketWithPrices & { _gameTime?: string })._gameTime
                    ? new Date((market as MarketWithPrices & { _gameTime: string })._gameTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                    : market.endDate ? new Date(market.endDate).toLocaleDateString() : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-[#484f58]">{market.category === "Sports" ? "Markets" : "24h Volume"}</p>
                <p className="text-[#e6edf3]">{market.category === "Sports" ? "Moneyline" : formatVolume(market.volume24hr)}</p>
              </div>
            </div>
            {(market.eventSlug || market.slug) && (
              <a
                href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug || market.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[#58a6ff] hover:underline"
              >
                View on Polymarket
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Buy Confirmation Dialog */}
      <TradeConfirmDialog
        pending={pendingBuy ? {
          marketQuestion: pendingBuy.market.question,
          outcome: pendingBuy.outcome,
          shares: pendingBuy.shares,
          price: pendingBuy.price,
          cost: pendingBuy.cost,
          side: "buy",
          potentialWin: pendingBuy.potentialWin,
        } : null}
        onClose={() => setPendingBuy(null)}
        onConfirm={confirmBuy}
        isLoading={isTrading}
      />

      {/* AI Consensus Markets */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">AI Swarm Consensus Markets</h3>
          <span className="text-[10px] text-[#484f58]">{consensusMarkets.length} markets</span>
        </div>
        {consensusMarkets.length === 0 || !pricesReady ? (
          <p className="text-sm text-[#484f58] text-center py-8">Loading live prices...</p>
        ) : (
          consensusMarkets.map((m, idx) => renderMarketRow(m, "AI Pick", getPrice, consensusResults[m.id], idx))
        )}
      </div>

      {/* Live Sports Markets */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">🏟️ Live Sports Markets</h3>
          <span className="text-[10px] text-[#484f58]">{sportsMarkets.length} markets</span>
        </div>
        {sportsLoading || (leagues.length > 0 && !allSportsData) ? (
          <p className="text-sm text-[#484f58] text-center py-8">Loading sports markets...</p>
        ) : sportsMarkets.length === 0 ? (
          <p className="text-sm text-[#484f58] text-center py-8">No live sports markets right now</p>
        ) : !sportsPricesReady ? (
          <p className="text-sm text-[#484f58] text-center py-8">Loading live prices...</p>
        ) : (
          sportsMarkets.map((m, idx) => {
            const sm = m as MarketWithPrices & { _sportLabel: string; _isLive: boolean };
            const label = sm._isLive
              ? `🔴 LIVE · ${sm._sportLabel}`
              : sm._sportLabel;
            return renderMarketRow(m, label, getSportsPrice, undefined, idx);
          })
        )}
      </div>

      {/* Inline Buy Panel */}
      {selectedMarket && (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 sticky bottom-4 shadow-2xl">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-white">{selectedMarket.question}</p>
              <p className="text-[11px] text-[#484f58] mt-0.5">Buy at live Polymarket odds</p>
            </div>
            <button onClick={() => setSelectedMarket(null)} className="text-[#484f58] hover:text-white text-lg leading-none">&times;</button>
          </div>

          {!isConnected ? (
            <div className="text-center py-4 space-y-2">
              <p className="text-sm text-[#768390]">Log in to trade</p>
              <LoginButton />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Outcome — show team names for sports, Yes/No for others */}
              {(() => {
                const isSport = selectedMarket.category === "Sports" && selectedMarket.parsedOutcomes.length >= 2;
                const labelA = isSport ? selectedMarket.parsedOutcomes[0] : "Yes";
                const labelB = isSport ? selectedMarket.parsedOutcomes[1] : "No";
                return (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOutcome("Yes")}
                      className={cn(
                        "py-2.5 rounded-lg text-sm font-medium text-center border transition-all",
                        outcome === "Yes"
                          ? "bg-[#238636]/15 border-[#238636] text-[#3fb950]"
                          : "bg-[#0d1117] border-[#21262d] text-[#768390]"
                      )}
                    >
                      {labelA} {selectedLive ? formatPercentage(selectedLive.yesPrice) : ""}
                    </button>
                    <button
                      onClick={() => setOutcome("No")}
                      className={cn(
                        "py-2.5 rounded-lg text-sm font-medium text-center border transition-all",
                        outcome === "No"
                          ? "bg-[#f85149]/10 border-[#f85149]/50 text-[#f85149]"
                          : "bg-[#0d1117] border-[#21262d] text-[#768390]"
                      )}
                    >
                      {labelB} {selectedLive ? formatPercentage(selectedLive.noPrice) : ""}
                    </button>
                  </div>
                );
              })()}

              {/* Shares */}
              <div>
                <div className="flex justify-between text-xs text-[#484f58] mb-1.5">
                  <span>Shares</span>
                  <button
                    onClick={() => price > 0 && setAmount(String(Math.floor(balance / price)))}
                    className={cn("hover:underline", price > 0 ? "text-[#58a6ff]" : "text-[#484f58] cursor-not-allowed")}
                  >
                    Max
                  </button>
                </div>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  value={amount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || parseFloat(val) >= 0) setAmount(val);
                  }}
                  className="bg-[#0d1117] border-[#21262d] text-white text-base h-10"
                />
              </div>

              {/* Summary + To Win */}
              {cost > 0 && (
                <div className="bg-[#0d1117] rounded-lg p-3 text-xs border border-[#21262d]">
                  <div className="flex justify-between text-[#768390] mb-1.5">
                    <span>Avg. Price {(price * 100).toFixed(0)}¢</span>
                    <span>Cost: {cost.toFixed(2)} AIRDROP</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[#768390]">To win</span>
                    <span className="text-xl font-bold text-[#3fb950] tabular-nums">{(cost / price - cost).toFixed(0)} AIRDROP</span>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-[#f85149]">{error}</p>}

              <Button
                onClick={handleBuy}
                disabled={!canTrade || isTrading}
                className="w-full h-10 font-medium bg-[#238636] hover:bg-[#2ea043] text-white"
              >
                {(() => {
                  const isSport = selectedMarket.category === "Sports" && selectedMarket.parsedOutcomes.length >= 2;
                  const outcomeLabel = isSport
                    ? (outcome === "Yes" ? selectedMarket.parsedOutcomes[0] : selectedMarket.parsedOutcomes[1])
                    : outcome;
                  return isTrading ? "Processing..." : shares > 0 ? `Buy ${outcomeLabel} — ${cost.toFixed(2)} AIRDROP` : `Buy ${outcomeLabel}`;
                })()}
              </Button>

              <p className="text-center text-[11px] text-[#484f58]">Balance: {balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} AIRDROP</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Leaderboard Tab ─── */
function LeaderboardTab() {
  const { address } = useUser();
  const [leaderboard, setLeaderboard] = useState<{ id: string; displayName: string | null; balance: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data) => { if (data.leaderboard) setLeaderboard(data.leaderboard); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const currentAddress = address?.toLowerCase() || "";

  if (loading) return <p className="text-sm text-[#484f58] text-center py-16">Loading leaderboard...</p>;

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#21262d]">
        <h3 className="text-sm font-semibold text-white">Top Traders</h3>
      </div>

      {/* Header */}
      <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
        <div className="col-span-1">#</div>
        <div className="col-span-7">Player</div>
        <div className="col-span-4 text-right">Balance</div>
      </div>

      {leaderboard.length === 0 ? (
        <p className="text-sm text-[#484f58] text-center py-12">No traders yet</p>
      ) : (
        <div className="divide-y divide-[#21262d]">
          {leaderboard.map((entry, idx) => {
            const isMe = entry.id === currentAddress;
            const rank = idx + 1;
            const displayId = entry.id.startsWith("0x")
              ? `${entry.id.slice(0, 6)}...${entry.id.slice(-4)}`
              : entry.id.slice(0, 10);

            return (
              <div
                key={entry.id}
                className={cn(
                  "grid grid-cols-12 gap-2 px-4 py-3 items-center animate-fade-in-up",
                  isMe && "bg-[#58a6ff]/5 border-l-2 border-[#58a6ff]"
                )}
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: "backwards" }}
              >
                <div className="col-span-1">
                  <span className={cn(
                    "text-sm font-bold tabular-nums",
                    rank === 1 ? "text-[#d29922]" : rank === 2 ? "text-[#768390]" : rank === 3 ? "text-[#a0603e]" : "text-[#484f58]"
                  )}>
                    {rank}
                  </span>
                </div>
                <div className="col-span-7">
                  <span className={cn("text-sm font-medium", isMe ? "text-[#58a6ff]" : "text-[#e6edf3]")}>
                    {entry.displayName || displayId}
                  </span>
                  {isMe && <span className="text-[10px] text-[#58a6ff] ml-2">(you)</span>}
                </div>
                <div className="col-span-4 text-right">
                  <span className="text-sm font-semibold text-white tabular-nums">
                    {entry.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-[10px] text-[#484f58] ml-1">AIRDROP</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function TradePage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "50" });
  const [tab, setTab] = useState<"portfolio" | "markets" | "leaderboard">("portfolio");

  const allMarkets = useMemo(() => {
    if (!events) return [];
    return (events as PolymarketEvent[]).flatMap((e) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    ).filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  }, [events]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Paper Trade</h1>
          <p className="text-sm text-[#768390] mt-0.5">Practice with live Polymarket data</p>
        </div>
        <LoginButton />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#21262d] mb-6">
        <button
          onClick={() => setTab("portfolio")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors",
            tab === "portfolio"
              ? "text-white border-b-2 border-[#58a6ff]"
              : "text-[#768390] hover:text-[#adbac7]"
          )}
        >
          Portfolio
        </button>
        <button
          onClick={() => setTab("markets")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors",
            tab === "markets"
              ? "text-white border-b-2 border-[#58a6ff]"
              : "text-[#768390] hover:text-[#adbac7]"
          )}
        >
          Tradable Markets
        </button>
        <button
          onClick={() => setTab("leaderboard")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors",
            tab === "leaderboard"
              ? "text-white border-b-2 border-[#d29922]"
              : "text-[#768390] hover:text-[#adbac7]"
          )}
        >
          Leaderboard
        </button>
      </div>

      <div key={tab} className="animate-fade-in-up">
        {tab === "leaderboard" ? (
          <LeaderboardTab />
        ) : isLoading ? (
          <p className="text-sm text-[#484f58] text-center py-16">Loading markets...</p>
        ) : tab === "portfolio" ? (
          <PortfolioTab allMarkets={allMarkets} onSwitchTab={() => setTab("markets")} />
        ) : (
          <TradableMarketsTab
            allMarkets={allMarkets}
            events={(events || []) as PolymarketEvent[]}
            onBought={() => setTab("portfolio")}
          />
        )}
      </div>
    </div>
  );
}
