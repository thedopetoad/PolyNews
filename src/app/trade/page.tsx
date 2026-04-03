"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { useUser, DbPosition } from "@/hooks/use-user";
import {
  parseMarketPrices,
  formatPercentage,
  formatVolume,
  PolymarketEvent,
  MarketWithPrices,
} from "@/types/polymarket";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AIRDROP_AMOUNTS, POLYMARKET_BASE_URL } from "@/lib/constants";
import { LoginButton } from "@/components/layout/login-modal";
import { getTopConsensusMarkets, getSportsMarketsEndingSoon } from "@/lib/market-filters";

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

/* ─── BTC 5-Min Market Types ─── */
interface Btc5mActive {
  id: string;
  question: string;
  slug: string;
  endDate: string;
  marketId: string;
  conditionId: string;
  upPrice: number;
  downPrice: number;
  volume: string;
  windowStart: number;
  windowEnd: number;
  secondsRemaining: number;
}

interface Btc5mPrevious {
  id: string;
  marketId: string;
  question: string;
  closed: boolean;
  resolved: boolean;
  outcome: string | null;
}

interface Btc5mData {
  active: Btc5mActive | null;
  previous: Btc5mPrevious | null;
}

/* ─── BTC 5-Min Hook ─── */
function useBtc5m() {
  const [data, setData] = useState<Btc5mData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/polymarket/btc5m");
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading, refetch: fetchData };
}

/* ─── BTC 5-Min Countdown ─── */
function Btc5mCountdown({ windowEnd }: { windowEnd: number }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const remaining = windowEnd - Math.floor(Date.now() / 1000);
      if (remaining <= 0) {
        setTimeLeft("0:00");
        setExpired(true);
      } else {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        setTimeLeft(`${m}:${s.toString().padStart(2, "0")}`);
        setExpired(false);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [windowEnd]);

  return (
    <span className={cn(
      "text-lg font-bold tabular-nums",
      expired ? "text-[#d29922] animate-pulse" : "text-[#e6edf3]"
    )}>
      {expired ? "Resolving..." : timeLeft}
    </span>
  );
}

/* ─── Portfolio Tab ─── */
function PortfolioTab({ allMarkets, onSwitchTab }: { allMarkets: MarketWithPrices[]; onSwitchTab: () => void }) {
  const { user, positions, trades, isConnected, claimAirdrop, isClaimingAirdrop, executeTrade, isTrading, address } = useUser();
  const queryClient = useQueryClient();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [autoCloseMsg, setAutoCloseMsg] = useState<string | null>(null);
  const autoCloseRef = useRef<Set<string>>(new Set());
  const { data: btcData } = useBtc5m();

  // Auto-close BTC 5-min positions when market resolves
  useEffect(() => {
    if (!btcData?.previous?.resolved || !btcData.previous.outcome) return;
    const prevId = btcData.previous.marketId;
    if (autoCloseRef.current.has(prevId)) return; // Already processed

    const btcPositions = positions.filter((p) => p.marketId === prevId);
    if (btcPositions.length === 0) return;

    autoCloseRef.current.add(prevId);
    const slug = `btc-updown-5m-${Math.floor(Math.floor(Date.now() / 1000) / 300) * 300 - 300}`;

    fetch("/api/trade/auto-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId: prevId, marketSlug: slug }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (result.closed > 0) {
          setAutoCloseMsg(`BTC 5-min settled: ${btcData.previous!.outcome} won! ${result.closed} position(s) closed.`);
          queryClient.invalidateQueries({ queryKey: ["user", address] });
          queryClient.invalidateQueries({ queryKey: ["positions", address] });
          queryClient.invalidateQueries({ queryKey: ["trades", address] });
          setTimeout(() => setAutoCloseMsg(null), 8000);
        }
      })
      .catch(() => {});
  }, [btcData?.previous?.resolved, btcData?.previous?.marketId, positions, address, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isConnected || !user) {
    return (
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-12 text-center space-y-4">
        <p className="text-[#768390]">Log in to start paper trading</p>
        <LoginButton />
      </div>
    );
  }

  const dailyClaimed = user.lastDailyAirdrop === new Date().toDateString();

  const handleClaim = async () => {
    setClaimError(null);
    try {
      await claimAirdrop("daily");
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "Already claimed today") {
        setClaimError(null); // Will show countdown
      } else {
        setClaimError(e instanceof Error ? e.message : "Claim failed");
      }
    }
  };

  const getLivePrice = (pos: DbPosition): number | null => {
    // Check if it's a BTC 5-min position
    const isBtc5m = pos.marketQuestion.toLowerCase().includes("bitcoin up or down");
    if (isBtc5m && btcData?.active) {
      // If position is for the current active market, use live CLOB price
      if (pos.marketId === btcData.active.marketId) {
        return pos.outcome === "Up" ? btcData.active.upPrice : btcData.active.downPrice;
      }
      // If position is for a resolved previous market, return null (will be auto-closed)
      return null;
    }

    const market = allMarkets.find((m) => m.id === pos.marketId)
      || allMarkets.find((m) => m.conditionId === pos.marketId)
      || allMarkets.find((m) => m.question === pos.marketQuestion);
    if (!market) return null;
    return pos.outcome === "Yes" ? market.yesPrice : market.noPrice;
  };

  const handleClose = async (pos: DbPosition) => {
    const livePrice = getLivePrice(pos);
    if (livePrice === null) return;
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
  };

  // Calculate total portfolio value
  const positionValues = positions.map((pos) => {
    const livePrice = getLivePrice(pos);
    return livePrice !== null ? pos.shares * livePrice : pos.shares * pos.avgPrice;
  });
  const totalPortfolioValue = user.balance + positionValues.reduce((sum, v) => sum + v, 0);

  return (
    <div className="space-y-4">
      {/* Balance Card */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Cash Balance</p>
            <p className="text-2xl font-bold text-white tabular-nums">
              {user.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal text-[#484f58] ml-1">PST</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Total Portfolio</p>
            <p className="text-lg font-bold text-white tabular-nums">
              {totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} PST
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
              {isClaimingAirdrop ? "Claiming..." : `Claim ${AIRDROP_AMOUNTS.daily} PST`}
            </button>
          )}
          {claimError && claimError !== "Already claimed today" && (
            <span className="text-[10px] text-[#f85149]">{claimError}</span>
          )}
          <span className="text-[11px] text-[#484f58] ml-auto">{positions.length} positions &middot; {trades.length} trades</span>
        </div>
      </div>

      {/* Auto-close notification */}
      {autoCloseMsg && (
        <div className="rounded-lg border border-[#d29922]/30 bg-[#d29922]/10 px-4 py-3 text-sm text-[#d29922] font-medium">
          {autoCloseMsg}
        </div>
      )}

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

              return (
                <div key={pos.id}>
                  {/* Desktop */}
                  <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 items-center">
                    <div className="col-span-4">
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
                            {pnl! >= 0 ? "+" : ""}{pnl!.toFixed(0)} PST ({pnlPct! >= 0 ? "+" : ""}{pnlPct!.toFixed(0)}%)
                          </p>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#484f58]">Price unavailable</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      <button
                        onClick={() => handleClose(pos)}
                        disabled={(isTrading && closingId === pos.id) || livePrice === null}
                        className="px-3 py-1.5 rounded text-[11px] font-medium bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors disabled:opacity-50"
                      >
                        {isTrading && closingId === pos.id ? "Closing..." : "Close"}
                      </button>
                    </div>
                  </div>

                  {/* Mobile */}
                  <div className="sm:hidden px-4 py-3 space-y-2">
                    <p className="text-[13px] text-[#e6edf3] font-medium">{pos.marketQuestion}</p>
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
                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)} PST
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleClose(pos)}
                        disabled={(isTrading && closingId === pos.id) || livePrice === null}
                        className="px-3 py-1.5 rounded text-[11px] font-medium bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors disabled:opacity-50"
                      >
                        {isTrading && closingId === pos.id ? "..." : "Close"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── BTC 5-Min Trading Card ─── */
function Btc5mCard({ onBought }: { onBought: () => void }) {
  const { user, isConnected, executeTrade, isTrading } = useUser();
  const { data: btcData, loading } = useBtc5m();
  const [outcome, setOutcome] = useState<"Up" | "Down">("Up");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = btcData?.active;
  const price = active ? (outcome === "Up" ? active.upPrice : active.downPrice) : 0;
  const shares = parseFloat(amount) || 0;
  const cost = shares * price;
  const balance = user?.balance || 0;
  const canTrade = isConnected && shares > 0 && cost <= balance && active;

  const handleBuy = async () => {
    if (!active || !canTrade) return;
    setError(null);
    try {
      await executeTrade({
        marketId: active.marketId,
        marketQuestion: active.question,
        outcome,
        side: "buy",
        shares,
        price,
      });
      setAmount("");
      onBought();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Trade failed");
    }
  };

  if (loading) return <div className="rounded-lg border border-[#d29922]/30 bg-[#161b22] p-6 text-center text-sm text-[#484f58]">Loading BTC market...</div>;
  if (!active) return <div className="rounded-lg border border-[#d29922]/30 bg-[#161b22] p-6 text-center text-sm text-[#484f58]">No active BTC 5-min market</div>;

  return (
    <div className="rounded-lg border border-[#d29922]/30 bg-[#161b22] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#21262d] flex items-center justify-between bg-[#d29922]/5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#d29922]">BTC</span>
          <span className="text-sm font-semibold text-white">Bitcoin 5-Min Up or Down</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#484f58] uppercase">Ends in</span>
          <Btc5mCountdown windowEnd={active.windowEnd} />
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <a
            href={`${POLYMARKET_BASE_URL}/event/${active.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[#e6edf3] hover:text-[#58a6ff] font-medium"
          >
            {active.question}
          </a>
          <div className="flex gap-3 flex-shrink-0 ml-4">
            <span className="text-sm font-bold text-[#3fb950] tabular-nums">Up {(active.upPrice * 100).toFixed(0)}%</span>
            <span className="text-sm font-bold text-[#f85149] tabular-nums">Down {(active.downPrice * 100).toFixed(0)}%</span>
          </div>
        </div>

        {btcData?.previous?.resolved && (
          <p className="text-[11px] text-[#484f58]">
            Last result: <span className={btcData.previous.outcome === "Up" ? "text-[#3fb950]" : "text-[#f85149]"}>{btcData.previous.outcome}</span>
          </p>
        )}

        {isConnected ? (
          <div className="space-y-3">
            {/* Outcome buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOutcome("Up")}
                className={cn(
                  "px-4 py-2.5 rounded-lg text-sm font-medium border transition-all",
                  outcome === "Up"
                    ? "bg-[#238636]/15 border-[#238636] text-[#3fb950]"
                    : "bg-[#0d1117] border-[#21262d] text-[#768390]"
                )}
              >
                Up {(active.upPrice * 100).toFixed(0)}¢
              </button>
              <button
                onClick={() => setOutcome("Down")}
                className={cn(
                  "px-4 py-2.5 rounded-lg text-sm font-medium border transition-all",
                  outcome === "Down"
                    ? "bg-[#f85149]/10 border-[#f85149]/50 text-[#f85149]"
                    : "bg-[#0d1117] border-[#21262d] text-[#768390]"
                )}
              >
                Down {(active.downPrice * 100).toFixed(0)}¢
              </button>
            </div>

            {/* Amount + To Win */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <div className="flex justify-between text-xs text-[#484f58] mb-1.5">
                  <span>Amount (PST)</span>
                  <button onClick={() => setAmount(String(Math.floor(balance)))} className="text-[#58a6ff] hover:underline">Max</button>
                </div>
                <Input
                  type="number"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-[#0d1117] border-[#21262d] text-white h-10"
                />
              </div>
              {cost > 0 && (
                <div className="text-right pb-1">
                  <p className="text-[10px] text-[#484f58]">Avg. Price {(price * 100).toFixed(0)}¢</p>
                  <p className="text-[10px] text-[#484f58]">To win</p>
                  <p className="text-xl font-bold text-[#3fb950] tabular-nums">{(cost / price - cost).toFixed(0)} PST</p>
                </div>
              )}
            </div>

            <Button
              onClick={handleBuy}
              disabled={!canTrade || isTrading}
              className="w-full h-10 bg-[#d29922] hover:bg-[#d29922]/80 text-black font-medium"
            >
              {isTrading ? "Processing..." : cost > 0 ? `Buy ${outcome} — ${cost.toFixed(0)} PST` : `Buy ${outcome}`}
            </Button>
            <p className="text-center text-[11px] text-[#484f58]">Balance: {balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} PST</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-sm text-[#768390]">Log in to trade</p>
            <LoginButton />
          </div>
        )}
        {error && <p className="text-xs text-[#f85149]">{error}</p>}
        <p className="text-[10px] text-[#484f58]">Positions auto-close when the 5-minute window ends. Shares pay out 1 PST each if your prediction is correct, 0 if wrong.</p>
      </div>
    </div>
  );
}

/* ─── Tradable Markets Tab ─── */
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

  // Get the 10 AI consensus markets + 5 sports markets
  const consensusMarkets = useMemo(() => getTopConsensusMarkets(events), [events]);
  const sportsMarkets = useMemo(() => getSportsMarketsEndingSoon(events), [events]);

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

  const price = selectedMarket ? (outcome === "Yes" ? selectedMarket.yesPrice : selectedMarket.noPrice) : 0;
  const shares = parseFloat(amount) || 0;
  const cost = shares * price;
  const balance = user?.balance || 0;
  const canTrade = isConnected && shares > 0 && cost <= balance;

  const handleBuy = async () => {
    if (!selectedMarket || !canTrade) return;
    setError(null);
    try {
      await executeTrade({
        marketId: selectedMarket.id,
        marketQuestion: selectedMarket.question,
        outcome,
        side: "buy",
        shares,
        price,
      });
      setSelectedMarket(null);
      setAmount("");
      onBought();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Trade failed");
    }
  };

  const renderMarketRow = (market: MarketWithPrices, label: string, consensus?: ConsensusResult) => (
    <div
      key={market.id}
      className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-[#21262d] last:border-b-0 transition-colors",
        selectedMarket?.id === market.id ? "bg-[#1c2128]" : "hover:bg-[#1c2128]/50"
      )}
    >
      {/* Market info */}
      <div className="flex-1 min-w-0">
        <a
          href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug || market.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] text-[#e6edf3] hover:text-[#58a6ff] font-medium leading-snug line-clamp-1"
          onClick={(e) => e.stopPropagation()}
        >
          {market.question}
        </a>
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
        <span className="text-xs font-semibold text-[#3fb950] tabular-nums">Yes {formatPercentage(market.yesPrice)}</span>
        <span className="text-xs font-semibold text-[#f85149] tabular-nums">No {formatPercentage(market.noPrice)}</span>
      </div>

      {/* Trade button */}
      <button
        onClick={() => { setSelectedMarket(selectedMarket?.id === market.id ? null : market); setOutcome("Yes"); setAmount(""); setError(null); }}
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
  );

  return (
    <div className="space-y-4">
      {/* BTC 5-Min Market */}
      <Btc5mCard onBought={onBought} />

      {/* AI Consensus Markets */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">AI Swarm Consensus Markets</h3>
          <span className="text-[10px] text-[#484f58]">{consensusMarkets.length} markets</span>
        </div>
        {consensusMarkets.length === 0 ? (
          <p className="text-sm text-[#484f58] text-center py-8">Loading markets...</p>
        ) : (
          consensusMarkets.map((m) => renderMarketRow(m, "AI Pick", consensusResults[m.id]))
        )}
      </div>

      {/* Sports Markets */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Sports Markets</h3>
          <span className="text-[10px] text-[#484f58]">{sportsMarkets.length} markets</span>
        </div>
        {sportsMarkets.length === 0 ? (
          <p className="text-sm text-[#484f58] text-center py-8">No sports markets available</p>
        ) : (
          sportsMarkets.map((m) => renderMarketRow(m, "Sports"))
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
              {/* Outcome */}
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
                  Yes {formatPercentage(selectedMarket.yesPrice)}
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
                  No {formatPercentage(selectedMarket.noPrice)}
                </button>
              </div>

              {/* Shares */}
              <div>
                <div className="flex justify-between text-xs text-[#484f58] mb-1.5">
                  <span>Shares</span>
                  <button
                    onClick={() => setAmount(String(Math.floor(balance / price)))}
                    className="text-[#58a6ff] hover:underline"
                  >
                    Max
                  </button>
                </div>
                <Input
                  type="number"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-[#0d1117] border-[#21262d] text-white text-base h-10"
                />
              </div>

              {/* Summary + To Win */}
              {cost > 0 && (
                <div className="bg-[#0d1117] rounded-lg p-3 text-xs border border-[#21262d]">
                  <div className="flex justify-between text-[#768390] mb-1.5">
                    <span>Avg. Price {(price * 100).toFixed(0)}¢</span>
                    <span>Cost: {cost.toFixed(2)} PST</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[#768390]">To win</span>
                    <span className="text-xl font-bold text-[#3fb950] tabular-nums">{(cost / price - cost).toFixed(0)} PST</span>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-[#f85149]">{error}</p>}

              <Button
                onClick={handleBuy}
                disabled={!canTrade || isTrading}
                className="w-full h-10 font-medium bg-[#238636] hover:bg-[#2ea043] text-white"
              >
                {isTrading ? "Processing..." : shares > 0 ? `Buy ${outcome} — ${cost.toFixed(2)} PST` : `Buy ${outcome}`}
              </Button>

              <p className="text-center text-[11px] text-[#484f58]">Balance: {balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} PST</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function TradePage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "50" });
  const [tab, setTab] = useState<"portfolio" | "markets">("portfolio");

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
      </div>

      {isLoading ? (
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
  );
}
