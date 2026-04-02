"use client";

import { useMemo, useState } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { usePaperTradingStore } from "@/stores/use-paper-trading-store";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AIRDROP_AMOUNTS } from "@/lib/constants";

function BalanceCard() {
  const { balance, positions, claimDailyAirdrop, claimWeeklyAirdrop, referralCode } =
    usePaperTradingStore();
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [weeklyClaimed, setWeeklyClaimed] = useState(false);

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
      <p className="text-xs text-[#768390]">Virtual Balance</p>
      <p className="text-3xl font-bold text-white tabular-nums mt-1">
        {balance.toLocaleString()}{" "}
        <span className="text-sm font-medium text-[#768390]">PST</span>
      </p>

      <div className="flex items-center gap-2 mt-3 text-[11px] text-[#484f58]">
        <span>{positions.length} positions</span>
        <span>&middot;</span>
        <span>Ref: {referralCode}</span>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => { if (claimDailyAirdrop()) setDailyClaimed(true); }}
          disabled={dailyClaimed}
          className={cn(
            "flex-1 py-2 rounded-md text-xs font-medium transition-colors",
            dailyClaimed
              ? "bg-[#1c2128] text-[#484f58] cursor-not-allowed"
              : "bg-[#238636] hover:bg-[#2ea043] text-white"
          )}
        >
          {dailyClaimed ? "Claimed" : `Daily +${AIRDROP_AMOUNTS.daily}`}
        </button>
        <button
          onClick={() => { if (claimWeeklyAirdrop()) setWeeklyClaimed(true); }}
          disabled={weeklyClaimed}
          className={cn(
            "flex-1 py-2 rounded-md text-xs font-medium transition-colors",
            weeklyClaimed
              ? "bg-[#1c2128] text-[#484f58] cursor-not-allowed"
              : "bg-[#58a6ff] hover:bg-[#79c0ff] text-white"
          )}
        >
          {weeklyClaimed ? "Claimed" : `Weekly +${AIRDROP_AMOUNTS.weekly}`}
        </button>
      </div>

      <p className="text-[10px] text-[#484f58] mt-3">
        Refer: +{AIRDROP_AMOUNTS.referralBonus.toLocaleString()} per signup, +{AIRDROP_AMOUNTS.referralFirstTrade} per first trade
      </p>
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
  const { balance, buyShares } = usePaperTradingStore();

  if (!market) return null;

  const price = outcome === "Yes" ? market.yesPrice : market.noPrice;
  const sharesNum = parseFloat(shares) || 0;
  const cost = sharesNum * price;
  const canAfford = cost <= balance && sharesNum > 0;

  const handleBuy = () => {
    if (!canAfford) return;
    buyShares(market.id, market.question, outcome, sharesNum, price);
    setShares("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="border-[#21262d] bg-[#161b22] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-sm leading-snug">
            {market.question}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex gap-2">
            <button
              onClick={() => setOutcome("Yes")}
              className={cn(
                "flex-1 py-2.5 rounded-md text-sm font-medium transition-colors border",
                outcome === "Yes"
                  ? "bg-[#238636]/20 text-[#3fb950] border-[#238636]"
                  : "bg-[#1c2128] text-[#768390] border-[#21262d] hover:text-[#adbac7]"
              )}
            >
              Yes {formatPercentage(market.yesPrice)}
            </button>
            <button
              onClick={() => setOutcome("No")}
              className={cn(
                "flex-1 py-2.5 rounded-md text-sm font-medium transition-colors border",
                outcome === "No"
                  ? "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/40"
                  : "bg-[#1c2128] text-[#768390] border-[#21262d] hover:text-[#adbac7]"
              )}
            >
              No {formatPercentage(market.noPrice)}
            </button>
          </div>

          <div>
            <label className="text-xs text-[#768390] mb-1.5 block">Shares</label>
            <Input
              type="number"
              placeholder="0"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="bg-[#0d1117] border-[#21262d] text-white"
            />
          </div>

          <div className="bg-[#0d1117] rounded-md p-3 space-y-1.5 text-xs border border-[#21262d]">
            <div className="flex justify-between text-[#768390]">
              <span>Price</span>
              <span>{price.toFixed(2)} PST</span>
            </div>
            <div className="flex justify-between text-[#768390]">
              <span>Quantity</span>
              <span>{sharesNum}</span>
            </div>
            <div className="h-px bg-[#21262d]" />
            <div className="flex justify-between text-white font-medium">
              <span>Total</span>
              <span>{cost.toFixed(2)} PST</span>
            </div>
          </div>

          <Button
            onClick={handleBuy}
            disabled={!canAfford}
            className={cn(
              "w-full",
              outcome === "Yes"
                ? "bg-[#238636] hover:bg-[#2ea043] text-white"
                : "bg-[#da3633] hover:bg-[#f85149] text-white"
            )}
          >
            Buy {outcome} &mdash; {cost.toFixed(2)} PST
          </Button>
        </div>
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
  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4 hover:border-[#30363d] transition-colors">
      <p className="text-[13px] font-medium text-[#e6edf3] leading-snug line-clamp-2 min-h-[2.5rem]">
        {market.question || market.groupItemTitle}
      </p>

      <div className="flex items-center gap-3 mt-2.5 text-xs">
        <span className="font-semibold text-[#3fb950]">
          Yes {formatPercentage(market.yesPrice)}
        </span>
        <span className="font-semibold text-[#f85149]">
          No {formatPercentage(market.noPrice)}
        </span>
        <span className="text-[10px] text-[#484f58] ml-auto">
          {formatVolume(market.volume)}
        </span>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onTrade(market)}
          className="flex-1 py-1.5 rounded-md text-xs font-medium bg-[#238636]/15 text-[#3fb950] hover:bg-[#238636]/25 transition-colors"
        >
          Buy Yes
        </button>
        <button
          onClick={() => onTrade(market)}
          className="flex-1 py-1.5 rounded-md text-xs font-medium bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 transition-colors"
        >
          Buy No
        </button>
      </div>
    </div>
  );
}

function PortfolioSection() {
  const { positions, tradeHistory } = usePaperTradingStore();

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <Tabs defaultValue="positions" className="w-full">
        <TabsList className="w-full rounded-none border-b border-[#21262d] bg-transparent h-auto p-0">
          <TabsTrigger
            value="positions"
            className="flex-1 rounded-none border-b-2 border-transparent text-xs py-2.5 text-[#768390] data-[state=active]:border-[#58a6ff] data-[state=active]:text-white data-[state=active]:bg-transparent"
          >
            Positions ({positions.length})
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="flex-1 rounded-none border-b-2 border-transparent text-xs py-2.5 text-[#768390] data-[state=active]:border-[#58a6ff] data-[state=active]:text-white data-[state=active]:bg-transparent"
          >
            History ({tradeHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="mt-0">
          <ScrollArea className="h-48">
            {positions.length === 0 ? (
              <p className="text-sm text-[#484f58] text-center py-10">No open positions</p>
            ) : (
              <div className="divide-y divide-[#21262d]">
                {positions.map((pos) => (
                  <div key={`${pos.marketId}-${pos.outcome}`} className="px-4 py-3">
                    <p className="text-xs text-[#adbac7] line-clamp-1">{pos.marketQuestion}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className={pos.outcome === "Yes" ? "text-[#3fb950]" : "text-[#f85149]"}>
                        {pos.outcome}
                      </span>
                      <span className="text-[#484f58]">
                        {pos.shares} shares @ {pos.avgPrice.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <ScrollArea className="h-48">
            {tradeHistory.length === 0 ? (
              <p className="text-sm text-[#484f58] text-center py-10">No trades yet</p>
            ) : (
              <div className="divide-y divide-[#21262d]">
                {tradeHistory.slice(0, 20).map((trade) => (
                  <div key={trade.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[#adbac7] line-clamp-1">{trade.marketQuestion}</p>
                      <span className="text-[10px] text-[#484f58]">
                        {trade.shares} {trade.outcome} @ {trade.price.toFixed(2)}
                      </span>
                    </div>
                    <span className={cn("text-[11px] font-medium", trade.side === "buy" ? "text-[#3fb950]" : "text-[#f85149]")}>
                      {trade.side.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function TradePage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "40" });
  const [search, setSearch] = useState("");
  const [tradeMarket, setTradeMarket] = useState<MarketWithPrices | null>(null);

  const markets = useMemo(() => {
    if (!events) return [];
    let all = events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    );
    if (search) {
      const q = search.toLowerCase();
      all = all.filter((m) => m.question?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q));
    }
    return all.sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0")).slice(0, 30);
  }, [events, search]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
        <p className="mt-1 text-sm text-[#768390]">
          Trade mirrored Polymarket markets with virtual PST tokens.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <BalanceCard />
          <PortfolioSection />
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Input
            placeholder="Search markets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 bg-[#161b22] border-[#21262d] text-[#e6edf3] placeholder:text-[#484f58]"
          />

          {isLoading ? (
            <p className="text-sm text-[#484f58] text-center py-16">Loading markets...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {markets.map((market) => (
                <MarketTradeCard key={market.id} market={market} onTrade={setTradeMarket} />
              ))}
            </div>
          )}
        </div>
      </div>

      <TradeDialog market={tradeMarket} open={!!tradeMarket} onClose={() => setTradeMarket(null)} />
    </div>
  );
}
