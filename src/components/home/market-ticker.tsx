"use client";

import { usePolymarketEvents } from "@/hooks/use-polymarket";
import {
  parseMarketPrices,
  formatPercentage,
  formatVolume,
  MarketWithPrices,
  PolymarketEvent,
} from "@/types/polymarket";
import { useMemo, useState } from "react";
import { POLYMARKET_BASE_URL, MARKET_CATEGORIES, MarketCategory } from "@/lib/constants";
import { cn } from "@/lib/utils";

function MarketCard({ market }: { market: MarketWithPrices }) {
  return (
    <a
      href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug || market.slug || market.conditionId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-shrink-0 w-72 rounded-lg border border-[#21262d] bg-[#161b22] p-3 hover:border-[#30363d] transition-colors"
    >
      <p className="text-[13px] font-medium text-[#e6edf3] leading-snug line-clamp-2 h-10">
        {market.question || market.groupItemTitle}
      </p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs font-semibold text-[#3fb950]">Yes {formatPercentage(market.yesPrice)}</span>
        <span className="text-xs font-semibold text-[#f85149]">No {formatPercentage(market.noPrice)}</span>
        <span className="text-[10px] text-[#484f58] ml-auto">{formatVolume(market.volume)}</span>
      </div>
    </a>
  );
}

export function MarketTicker() {
  const { data: events, isLoading } = usePolymarketEvents();
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("politics");
  const [showAll, setShowAll] = useState(false);

  const allMarkets = useMemo(() => {
    if (!events) return [];
    return events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    ).filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  }, [events]);

  const filteredMarkets = useMemo(() => {
    let markets = allMarkets;

    if (activeCategory !== "all" && activeCategory !== "trending") {
      const catLabel = MARKET_CATEGORIES.find((c) => c.key === activeCategory)?.label;
      if (catLabel) {
        markets = markets.filter((m) => m.category === catLabel);
      }
    }

    return markets
      .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"));
  }, [allMarkets, activeCategory]);

  const tickerMarkets = filteredMarkets.slice(0, 20);

  if (isLoading) return <p className="text-sm text-[#484f58] text-center py-6">Loading markets...</p>;
  if (allMarkets.length === 0) return null;

  // Use scrolling ticker if enough markets and not in grid mode
  const useScroll = tickerMarkets.length > 4 && !showAll;
  const tickerItems = useScroll ? [...tickerMarkets, ...tickerMarkets] : [];

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {MARKET_CATEGORIES.filter((cat) => cat.key !== "all" && cat.key !== "trending").map((cat) => (
          <button
            key={cat.key}
            onClick={() => { setActiveCategory(cat.key); setShowAll(false); }}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              activeCategory === cat.key
                ? "bg-[#58a6ff] text-white"
                : "bg-[#161b22] text-[#768390] border border-[#21262d] hover:text-[#adbac7] hover:border-[#30363d]"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {filteredMarkets.length > 0 ? (
        showAll ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        ) : useScroll ? (
          <div className="overflow-hidden">
            <div
              className="flex gap-3 pl-4 animate-[ticker_80s_linear_infinite] hover:[animation-play-state:paused]"
              style={{ width: "max-content" }}
            >
              {tickerItems.map((market, idx) => (
                <MarketCard key={`${market.id}-${idx}`} market={market} />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {tickerMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-[#484f58] text-center py-6">No markets in this category</p>
      )}

      {filteredMarkets.length > 0 && (
        <div className="flex justify-start mt-2">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[11px] text-[#58a6ff] hover:underline"
          >
            {showAll ? "\u2190 Back to ticker" : "Browse all markets \u2192"}
          </button>
        </div>
      )}
    </div>
  );
}
