"use client";

import { useMemo, useState, useEffect } from "react";

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
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { useUser } from "@/hooks/use-user";
import {
  parseMarketPrices,
  formatPercentage,
  formatVolume,
  PolymarketEvent,
  MarketWithPrices,
} from "@/types/polymarket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AIRDROP_AMOUNTS, MARKET_CATEGORIES, MarketCategory } from "@/lib/constants";
import { LoginButton } from "@/components/layout/login-modal";

/* ─── Market Detail View (Polymarket-style) ─── */
function MarketDetail({
  market,
  onBack,
}: {
  market: MarketWithPrices;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"Yes" | "No">("Yes");
  const [amount, setAmount] = useState("");
  const { user, isConnected, executeTrade, isTrading, positions } = useUser();
  const [error, setError] = useState<string | null>(null);

  const price = outcome === "Yes" ? market.yesPrice : market.noPrice;
  const shares = parseFloat(amount) || 0;
  const cost = shares * price;
  const balance = user?.balance || 0;
  const potentialReturn = shares;
  const canTrade = isConnected && shares > 0 && (tab === "buy" ? cost <= balance : true);

  const myPosition = positions.find(
    (p) => p.marketId === market.id && p.outcome === outcome
  );

  const handleTrade = async () => {
    if (!canTrade) return;
    setError(null);
    try {
      await executeTrade({
        marketId: market.id,
        marketQuestion: market.question,
        outcome,
        side: tab,
        shares,
        price,
      });
      setAmount("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Trade failed");
    }
  };

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="text-[13px] text-[#768390] hover:text-white mb-4 flex items-center gap-1"
      >
        <span>&larr;</span> All markets
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Market info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-6">
            <h2 className="text-lg font-semibold text-white leading-snug">
              {market.question}
            </h2>
            {market.description && (
              <p className="text-sm text-[#768390] mt-2 line-clamp-3">{market.description}</p>
            )}
            <div className="flex items-center gap-4 mt-4 text-sm">
              <span className="text-[#3fb950] font-semibold">
                Yes {formatPercentage(market.yesPrice)}
              </span>
              <span className="text-[#f85149] font-semibold">
                No {formatPercentage(market.noPrice)}
              </span>
              <span className="text-[#484f58]">{formatVolume(market.volume)} Vol</span>
              {market.endDate && (
                <span className="text-[#484f58]">
                  Ends {new Date(market.endDate).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {/* Price visualization */}
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
            <p className="text-xs text-[#484f58] mb-3">Current odds</p>
            <div className="flex items-center gap-2">
              <div
                className="h-8 bg-[#238636]/20 rounded-l-md flex items-center justify-center text-xs font-semibold text-[#3fb950]"
                style={{ width: `${market.yesPrice * 100}%`, minWidth: 40 }}
              >
                Yes {formatPercentage(market.yesPrice)}
              </div>
              <div
                className="h-8 bg-[#f85149]/15 rounded-r-md flex items-center justify-center text-xs font-semibold text-[#f85149]"
                style={{ width: `${market.noPrice * 100}%`, minWidth: 40 }}
              >
                No {formatPercentage(market.noPrice)}
              </div>
            </div>
          </div>

          {/* My position */}
          {myPosition && (
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
              <p className="text-xs text-[#484f58] mb-2">Your position</p>
              <div className="flex items-center gap-3">
                <span className={cn(
                  "px-2 py-1 rounded text-xs font-medium",
                  myPosition.outcome === "Yes" ? "bg-[#238636]/15 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"
                )}>
                  {myPosition.outcome}
                </span>
                <span className="text-sm text-[#adbac7]">
                  {myPosition.shares} shares @ {myPosition.avgPrice.toFixed(2)}
                </span>
                <span className="text-sm text-[#768390]">
                  Value: {(myPosition.shares * myPosition.avgPrice).toFixed(0)} PST
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Trading panel */}
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          {!isConnected ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-[#768390]">Log in to trade</p>
              <LoginButton />
            </div>
          ) : (
            <>
              {/* Buy/Sell tabs */}
              <div className="flex border-b border-[#21262d]">
                <button
                  onClick={() => setTab("buy")}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium text-center transition-colors",
                    tab === "buy"
                      ? "text-[#3fb950] border-b-2 border-[#3fb950]"
                      : "text-[#768390] hover:text-[#adbac7]"
                  )}
                >
                  Buy
                </button>
                <button
                  onClick={() => setTab("sell")}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium text-center transition-colors",
                    tab === "sell"
                      ? "text-[#f85149] border-b-2 border-[#f85149]"
                      : "text-[#768390] hover:text-[#adbac7]"
                  )}
                >
                  Sell
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Outcome */}
                <div>
                  <p className="text-xs text-[#484f58] mb-2">Outcome</p>
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
                      Yes {formatPercentage(market.yesPrice)}
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
                      No {formatPercentage(market.noPrice)}
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <div className="flex justify-between text-xs text-[#484f58] mb-1.5">
                    <span>Shares</span>
                    {tab === "buy" && (
                      <button
                        onClick={() => setAmount(String(Math.floor(balance / price)))}
                        className="text-[#58a6ff] hover:underline"
                      >
                        Max
                      </button>
                    )}
                    {tab === "sell" && myPosition && (
                      <button
                        onClick={() => setAmount(String(myPosition.shares))}
                        className="text-[#58a6ff] hover:underline"
                      >
                        All ({myPosition.shares})
                      </button>
                    )}
                  </div>
                  <Input
                    type="number"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-[#0d1117] border-[#21262d] text-white text-base h-10"
                  />
                </div>

                {/* Summary */}
                {shares > 0 && (
                  <div className="bg-[#0d1117] rounded-lg p-3 space-y-1.5 text-xs border border-[#21262d]">
                    <div className="flex justify-between text-[#768390]">
                      <span>Price per share</span>
                      <span>{price.toFixed(2)} PST</span>
                    </div>
                    <div className="flex justify-between text-[#768390]">
                      <span>{tab === "buy" ? "Total cost" : "Total proceeds"}</span>
                      <span className="text-white font-medium">{cost.toFixed(2)} PST</span>
                    </div>
                    {tab === "buy" && (
                      <>
                        <div className="h-px bg-[#21262d]" />
                        <div className="flex justify-between text-[#768390]">
                          <span>Potential return</span>
                          <span className="text-[#3fb950]">{potentialReturn.toFixed(2)} PST</span>
                        </div>
                        <div className="flex justify-between text-[#768390]">
                          <span>Profit if correct</span>
                          <span className="text-[#3fb950]">
                            +{(potentialReturn - cost).toFixed(2)} ({((potentialReturn - cost) / cost * 100).toFixed(0)}%)
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {error && <p className="text-xs text-[#f85149]">{error}</p>}

                <Button
                  onClick={handleTrade}
                  disabled={!canTrade || isTrading}
                  className={cn(
                    "w-full h-10 font-medium",
                    tab === "buy"
                      ? "bg-[#238636] hover:bg-[#2ea043] text-white"
                      : "bg-[#da3633] hover:bg-[#f85149] text-white"
                  )}
                >
                  {isTrading
                    ? "Processing..."
                    : shares > 0
                      ? `${tab === "buy" ? "Buy" : "Sell"} ${outcome} — ${cost.toFixed(2)} PST`
                      : `${tab === "buy" ? "Buy" : "Sell"} ${outcome}`}
                </Button>

                {/* Balance */}
                <div className="text-center text-[11px] text-[#484f58]">
                  Balance: {balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} PST
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Market Row (Polymarket-style list item) ─── */
function MarketRow({
  market,
  onClick,
}: {
  market: MarketWithPrices;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-3 hover:bg-[#1c2128] cursor-pointer transition-colors border-b border-[#21262d] last:border-b-0"
    >
      {/* Market icon */}
      {market.image ? (
        <img
          src={market.image}
          alt=""
          className="w-8 h-8 rounded-full bg-[#21262d] flex-shrink-0 object-cover"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-[#21262d] flex-shrink-0" />
      )}

      {/* Question */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-[#e6edf3] font-medium truncate">
          {market.question || market.groupItemTitle}
        </p>
        <p className="text-[11px] text-[#484f58] mt-0.5">{formatVolume(market.volume)} Vol</p>
      </div>

      {/* Price */}
      <div className="text-right flex-shrink-0 w-16">
        <p className="text-sm font-bold text-white tabular-nums">
          {formatPercentage(market.yesPrice)}
        </p>
        <p className="text-[10px] text-[#484f58]">Yes</p>
      </div>

      {/* Yes/No buttons */}
      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-[#238636]/15 text-[#3fb950] hover:bg-[#238636]/25 transition-colors"
        >
          Yes
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors"
        >
          No
        </button>
      </div>
    </div>
  );
}

/* ─── Portfolio Bar ─── */
function PortfolioBar({ onPositionClick }: { onPositionClick?: (marketId: string, question: string) => void }) {
  const { user, positions, trades, isConnected, claimAirdrop, isClaimingAirdrop, executeTrade, isTrading } = useUser();
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  if (!isConnected || !user) return null;

  const dailyClaimed = user.lastDailyAirdrop === new Date().toDateString();

  const handleClaim = async () => {
    setClaimError(null);
    try {
      await claimAirdrop("daily");
    } catch (e: unknown) {
      setClaimError(e instanceof Error ? e.message : "Claim failed");
    }
  };

  const handleQuickSell = async (pos: typeof positions[0]) => {
    setSellingId(pos.id);
    try {
      await executeTrade({
        marketId: pos.marketId,
        marketQuestion: pos.marketQuestion,
        outcome: pos.outcome as "Yes" | "No",
        side: "sell",
        shares: pos.shares,
        price: pos.avgPrice || 0.5,
      });
    } catch {}
    setSellingId(null);
  };

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Balance</p>
          <p className="text-xl font-bold text-white tabular-nums">
            {user.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            <span className="text-xs font-normal text-[#484f58] ml-1">PST</span>
          </p>
        </div>
        <div className="text-right text-[11px] text-[#484f58]">
          <p>{positions.length} positions &middot; {trades.length} trades</p>
          <p className="font-mono">{user.referralCode}</p>
        </div>
      </div>
      <div className="mt-3">
        {dailyClaimed ? (
          <DailyCountdown />
        ) : (
          <button
            onClick={handleClaim}
            disabled={isClaimingAirdrop}
            className="px-3 py-1.5 rounded text-[11px] font-medium bg-[#238636] hover:bg-[#2ea043] text-white transition-colors"
          >
            {isClaimingAirdrop ? "Claiming..." : "Claim 100 PST"}
          </button>
        )}
        {claimError && <p className="text-[10px] text-[#f85149] mt-1">{claimError}</p>}
      </div>

      {/* Positions with sell buttons */}
      {positions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#21262d]">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-2">Open Positions</p>
          {positions.map((pos) => (
            <div
              key={pos.id}
              className="flex items-center justify-between py-2 text-[12px] border-b border-[#21262d] last:border-b-0 cursor-pointer hover:bg-[#1c2128] -mx-4 px-4 transition-colors"
              onClick={() => onPositionClick?.(pos.marketId, pos.marketQuestion)}
            >
              <div className="flex-1 min-w-0 mr-2">
                <span className="text-[#adbac7] truncate block hover:text-[#58a6ff]">{pos.marketQuestion}</span>
                <span className={cn(
                  "text-[11px] font-medium",
                  pos.outcome === "Yes" ? "text-[#3fb950]" : "text-[#f85149]"
                )}>
                  {pos.shares} {pos.outcome} @ {pos.avgPrice.toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => handleQuickSell(pos)}
                disabled={isTrading && sellingId === pos.id}
                className="flex-shrink-0 px-2.5 py-1 rounded text-[10px] font-medium bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors"
              >
                {isTrading && sellingId === pos.id ? "..." : "Close"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function TradePage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "40" });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MarketCategory>("all");
  const [selectedMarket, setSelectedMarket] = useState<MarketWithPrices | null>(null);

  const markets = useMemo(() => {
    if (!events) return [];
    let all = events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    );

    // Hide resolved
    all = all.filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);

    // Category filter
    if (category !== "all" && category !== "trending") {
      const catLabel = MARKET_CATEGORIES.find((c) => c.key === category)?.label;
      if (catLabel) {
        all = all.filter((m) => m.category === catLabel);
      }
    }

    if (search) {
      const q = search.toLowerCase();
      all = all.filter((m) => m.question?.toLowerCase().includes(q));
    }

    return all.sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0")).slice(0, 40);
  }, [events, search, category]);

  // ALL markets unfiltered (for position click lookup)
  const allMarkets = useMemo(() => {
    if (!events) return [];
    return events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    ).filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  }, [events]);

  // Detail view
  if (selectedMarket) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <MarketDetail market={selectedMarket} onBack={() => setSelectedMarket(null)} />
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Paper Trade</h1>
          <p className="text-sm text-[#768390] mt-0.5">Practice on real Polymarket data</p>
        </div>
        <LoginButton />
      </div>

      <PortfolioBar onPositionClick={(marketId) => {
        const market = allMarkets.find((m) => m.id === marketId) || markets.find((m) => m.id === marketId);
        if (market) setSelectedMarket(market);
      }} />

      {/* Filters */}
      <div className="flex items-center gap-3 mt-6 mb-4">
        <div className="flex gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: "none" }}>
          {MARKET_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors",
                category === cat.key
                  ? "bg-[#58a6ff] text-white"
                  : "text-[#768390] hover:text-[#adbac7]"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs bg-[#0d1117] border-[#21262d] text-[#e6edf3] placeholder:text-[#484f58] w-48"
        />
      </div>

      {/* Market list */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-[#484f58] text-center py-16">Loading markets...</p>
        ) : markets.length === 0 ? (
          <p className="text-sm text-[#484f58] text-center py-16">No markets found</p>
        ) : (
          markets.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              onClick={() => setSelectedMarket(market)}
            />
          ))
        )}
      </div>
    </div>
  );
}
