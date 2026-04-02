"use client";

import { useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AIRDROP_AMOUNTS, MARKET_CATEGORIES, MarketCategory } from "@/lib/constants";
import { LoginButton } from "@/components/layout/login-modal";

function BalanceCard() {
  const { user, positions, isConnected, claimAirdrop, isClaimingAirdrop } = useUser();
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [weeklyClaimed, setWeeklyClaimed] = useState(false);

  if (!isConnected || !user) {
    return (
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-6 text-center space-y-3">
        <p className="text-sm text-[#768390]">Log in to start paper trading</p>
        <LoginButton />
      </div>
    );
  }

  const handleClaim = async (type: "daily" | "weekly") => {
    try {
      await claimAirdrop(type);
      if (type === "daily") setDailyClaimed(true);
      if (type === "weekly") setWeeklyClaimed(true);
    } catch {}
  };

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-[#484f58] uppercase tracking-wider">Balance</p>
          <p className="text-3xl font-bold text-white tabular-nums mt-0.5">
            {user.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            <span className="text-sm font-medium text-[#484f58] ml-1">PST</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[#484f58]">{positions.length} open</p>
          <p className="text-[10px] text-[#484f58] mt-0.5 font-mono">{user.referralCode}</p>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => handleClaim("daily")}
          disabled={dailyClaimed || isClaimingAirdrop}
          className={cn(
            "flex-1 py-2 rounded-md text-xs font-medium transition-colors",
            dailyClaimed
              ? "bg-[#1c2128] text-[#484f58]"
              : "bg-[#238636] hover:bg-[#2ea043] text-white"
          )}
        >
          {dailyClaimed ? "Claimed today" : `+${AIRDROP_AMOUNTS.daily} Daily`}
        </button>
        <button
          onClick={() => handleClaim("weekly")}
          disabled={weeklyClaimed || isClaimingAirdrop}
          className={cn(
            "flex-1 py-2 rounded-md text-xs font-medium transition-colors",
            weeklyClaimed
              ? "bg-[#1c2128] text-[#484f58]"
              : "bg-[#1c2128] border border-[#30363d] hover:border-[#58a6ff] text-[#adbac7]"
          )}
        >
          {weeklyClaimed ? "Claimed this week" : `+${AIRDROP_AMOUNTS.weekly} Weekly`}
        </button>
      </div>
    </div>
  );
}

function TradeDialog({
  market,
  open,
  onClose,
}: {
  market: MarketWithPrices | null;
  open: boolean;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<"Yes" | "No">("Yes");
  const [shares, setShares] = useState("");
  const { user, isConnected, executeTrade, isTrading } = useUser();
  const [error, setError] = useState<string | null>(null);

  if (!market) return null;

  const price = outcome === "Yes" ? market.yesPrice : market.noPrice;
  const sharesNum = parseFloat(shares) || 0;
  const cost = sharesNum * price;
  const balance = user?.balance || 0;
  const canAfford = cost <= balance && sharesNum > 0 && isConnected;
  const potentialReturn = sharesNum; // each share pays 1 if correct
  const profitIfCorrect = potentialReturn - cost;

  const handleBuy = async () => {
    if (!canAfford) return;
    setError(null);
    try {
      await executeTrade({
        marketId: market.id,
        marketQuestion: market.question,
        outcome,
        side: "buy",
        shares: sharesNum,
        price,
      });
      setShares("");
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Trade failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { setError(null); setShares(""); onClose(); }}>
      <DialogContent className="border-[#21262d] bg-[#161b22] max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white text-sm leading-snug pr-6">
            {market.question}
          </DialogTitle>
        </DialogHeader>

        {!isConnected ? (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-[#768390]">Log in to trade</p>
            <LoginButton />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Outcome buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOutcome("Yes")}
                className={cn(
                  "py-3 rounded-lg text-center transition-all border-2",
                  outcome === "Yes"
                    ? "bg-[#238636]/15 border-[#238636] text-[#3fb950]"
                    : "bg-[#0d1117] border-[#21262d] text-[#768390] hover:border-[#30363d]"
                )}
              >
                <div className="text-lg font-bold">{formatPercentage(market.yesPrice)}</div>
                <div className="text-[11px] mt-0.5">Yes</div>
              </button>
              <button
                onClick={() => setOutcome("No")}
                className={cn(
                  "py-3 rounded-lg text-center transition-all border-2",
                  outcome === "No"
                    ? "bg-[#f85149]/10 border-[#f85149]/50 text-[#f85149]"
                    : "bg-[#0d1117] border-[#21262d] text-[#768390] hover:border-[#30363d]"
                )}
              >
                <div className="text-lg font-bold">{formatPercentage(market.noPrice)}</div>
                <div className="text-[11px] mt-0.5">No</div>
              </button>
            </div>

            {/* Amount */}
            <div>
              <div className="flex justify-between text-xs text-[#484f58] mb-1.5">
                <span>Amount</span>
                <button
                  onClick={() => setShares(String(Math.floor(balance / price)))}
                  className="text-[#58a6ff] hover:underline"
                >
                  Max
                </button>
              </div>
              <Input
                type="number"
                placeholder="0"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="bg-[#0d1117] border-[#21262d] text-white text-lg h-11"
              />
            </div>

            {/* Summary */}
            {sharesNum > 0 && (
              <div className="bg-[#0d1117] rounded-lg p-3 space-y-2 text-xs border border-[#21262d]">
                <div className="flex justify-between text-[#768390]">
                  <span>Cost</span>
                  <span className="text-white">{cost.toFixed(2)} PST</span>
                </div>
                <div className="flex justify-between text-[#768390]">
                  <span>Potential return</span>
                  <span className="text-[#3fb950]">{potentialReturn.toFixed(2)} PST</span>
                </div>
                <div className="flex justify-between text-[#768390]">
                  <span>Profit if correct</span>
                  <span className="text-[#3fb950]">+{profitIfCorrect.toFixed(2)} PST ({((profitIfCorrect / cost) * 100).toFixed(0)}%)</span>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-[#f85149]">{error}</p>}

            <Button
              onClick={handleBuy}
              disabled={!canAfford || isTrading}
              className={cn(
                "w-full h-11 text-sm font-medium",
                outcome === "Yes"
                  ? "bg-[#238636] hover:bg-[#2ea043] text-white"
                  : "bg-[#da3633] hover:bg-[#f85149] text-white"
              )}
            >
              {isTrading
                ? "Placing trade..."
                : sharesNum > 0
                  ? `Buy ${outcome} — ${cost.toFixed(2)} PST`
                  : `Buy ${outcome}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MarketTradeCard({
  market,
  onTrade,
}: {
  market: MarketWithPrices;
  onTrade: (m: MarketWithPrices) => void;
}) {
  // Determine if market is interesting (not resolved at 0/100)
  const isResolved = market.yesPrice <= 0.01 || market.yesPrice >= 0.99;

  return (
    <div
      className={cn(
        "rounded-lg border bg-[#161b22] p-4 transition-colors cursor-pointer",
        isResolved
          ? "border-[#21262d] opacity-50"
          : "border-[#21262d] hover:border-[#30363d]"
      )}
      onClick={() => !isResolved && onTrade(market)}
    >
      <p className="text-[13px] font-medium text-[#e6edf3] leading-snug line-clamp-2 min-h-[2.5rem]">
        {market.question || market.groupItemTitle}
      </p>

      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1 grid grid-cols-2 gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); if (!isResolved) onTrade(market); }}
            disabled={isResolved}
            className="py-2 rounded-md text-xs font-semibold bg-[#238636]/10 text-[#3fb950] hover:bg-[#238636]/20 transition-colors text-center"
          >
            Yes {formatPercentage(market.yesPrice)}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); if (!isResolved) onTrade(market); }}
            disabled={isResolved}
            className="py-2 rounded-md text-xs font-semibold bg-[#f85149]/8 text-[#f85149] hover:bg-[#f85149]/15 transition-colors text-center"
          >
            No {formatPercentage(market.noPrice)}
          </button>
        </div>
        <span className="text-[10px] text-[#484f58] whitespace-nowrap">
          {formatVolume(market.volume)}
        </span>
      </div>

      {isResolved && (
        <p className="text-[10px] text-[#484f58] mt-2">Resolved</p>
      )}
    </div>
  );
}

function PortfolioSection() {
  const { positions, trades, isConnected } = useUser();
  const [tab, setTab] = useState<"positions" | "history">("positions");

  if (!isConnected) return null;

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <div className="flex border-b border-[#21262d]">
        <button
          onClick={() => setTab("positions")}
          className={cn(
            "flex-1 py-2.5 text-xs font-medium text-center border-b-2 transition-colors",
            tab === "positions"
              ? "border-[#58a6ff] text-white"
              : "border-transparent text-[#768390] hover:text-[#adbac7]"
          )}
        >
          Positions ({positions.length})
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "flex-1 py-2.5 text-xs font-medium text-center border-b-2 transition-colors",
            tab === "history"
              ? "border-[#58a6ff] text-white"
              : "border-transparent text-[#768390] hover:text-[#adbac7]"
          )}
        >
          History ({trades.length})
        </button>
      </div>

      <ScrollArea className="h-52">
        {tab === "positions" ? (
          positions.length === 0 ? (
            <p className="text-sm text-[#484f58] text-center py-10">No open positions yet</p>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {positions.map((pos) => (
                <div key={pos.id} className="px-4 py-3">
                  <p className="text-xs text-[#adbac7] line-clamp-1">{pos.marketQuestion}</p>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        pos.outcome === "Yes" ? "bg-[#238636]/15 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"
                      )}>
                        {pos.outcome}
                      </span>
                      <span className="text-[#484f58]">
                        {pos.shares} @ {pos.avgPrice.toFixed(2)}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#768390] tabular-nums">
                      {(pos.shares * pos.avgPrice).toFixed(0)} PST
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          trades.length === 0 ? (
            <p className="text-sm text-[#484f58] text-center py-10">No trades yet</p>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {trades.slice(0, 20).map((trade) => (
                <div key={trade.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#adbac7] line-clamp-1">{trade.marketQuestion}</p>
                    <span className="text-[10px] text-[#484f58]">
                      {trade.shares} {trade.outcome} @ {trade.price.toFixed(2)}
                    </span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded ml-2",
                    trade.side === "buy" ? "bg-[#238636]/15 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"
                  )}>
                    {trade.side.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </ScrollArea>
    </div>
  );
}

export default function TradePage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "40" });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MarketCategory>("all");
  const [tradeMarket, setTradeMarket] = useState<MarketWithPrices | null>(null);

  const markets = useMemo(() => {
    if (!events) return [];
    let all = events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    );

    // Filter out fully resolved markets (push them to bottom)
    all.sort((a, b) => {
      const aResolved = a.yesPrice <= 0.01 || a.yesPrice >= 0.99;
      const bResolved = b.yesPrice <= 0.01 || b.yesPrice >= 0.99;
      if (aResolved !== bResolved) return aResolved ? 1 : -1;
      return parseFloat(b.volume || "0") - parseFloat(a.volume || "0");
    });

    // Category filter
    if (category !== "all" && category !== "trending") {
      const cat = MARKET_CATEGORIES.find((c) => c.key === category);
      if (cat && "keywords" in cat) {
        const kws = cat.keywords as readonly string[];
        all = all.filter((m) => {
          const text = `${m.question} ${m.description || ""}`.toLowerCase();
          return kws.some((kw) => text.includes(kw));
        });
      }
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      all = all.filter((m) => m.question?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q));
    }

    return all.slice(0, 30);
  }, [events, search, category]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
        <p className="mt-1 text-sm text-[#768390]">
          Practice trading on real Polymarket data with virtual PST tokens.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left sidebar */}
        <div className="space-y-4">
          <BalanceCard />
          <PortfolioSection />
        </div>

        {/* Market grid */}
        <div className="lg:col-span-2 space-y-3">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1" style={{ scrollbarWidth: "none" }}>
              {MARKET_CATEGORIES.slice(0, 6).map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setCategory(cat.key)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors",
                    category === cat.key
                      ? "bg-[#58a6ff] text-white"
                      : "bg-[#1c2128] text-[#768390] border border-[#21262d] hover:border-[#30363d]"
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
              className="h-8 text-xs bg-[#0d1117] border-[#21262d] text-[#e6edf3] placeholder:text-[#484f58] sm:max-w-[180px]"
            />
          </div>

          {isLoading ? (
            <p className="text-sm text-[#484f58] text-center py-16">Loading markets...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {markets.map((market) => (
                <MarketTradeCard key={market.id} market={market} onTrade={setTradeMarket} />
              ))}
              {markets.length === 0 && (
                <p className="col-span-full text-sm text-[#484f58] text-center py-12">No markets found</p>
              )}
            </div>
          )}
        </div>
      </div>

      <TradeDialog market={tradeMarket} open={!!tradeMarket} onClose={() => setTradeMarket(null)} />
    </div>
  );
}
