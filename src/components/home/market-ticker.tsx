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
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("all");

  const allMarkets = useMemo(() => {
    if (!events) return [];
    return events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    ).filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  }, [events]);

  const filteredMarkets = useMemo(() => {
    let markets = allMarkets;

    if (activeCategory !== "all" && activeCategory !== "trending") {
      const cat = MARKET_CATEGORIES.find((c) => c.key === activeCategory);
      if (cat && "keywords" in cat) {
        const catKeywords = cat.keywords as readonly string[];
        markets = markets.filter((m) => {
          const text = `${m.question} ${m.description || ""} ${m.groupItemTitle || ""}`.toLowerCase();
          return catKeywords.some((kw) => text.includes(kw));
        });
      }
    }

    return markets
      .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
      .slice(0, 20);
  }, [allMarkets, activeCategory]);

  if (isLoading) return <p className="text-sm text-[#484f58] text-center py-6">Loading markets...</p>;
  if (allMarkets.length === 0) return null;

  // Use scrolling ticker if enough markets, static grid if few
  const useScroll = filteredMarkets.length > 4;
  const tickerItems = useScroll ? [...filteredMarkets, ...filteredMarkets] : filteredMarkets;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {MARKET_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
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
        useScroll ? (
          <div className="overflow-hidden">
            <div
              className="flex gap-3 animate-[ticker_80s_linear_infinite] hover:[animation-play-state:paused]"
              style={{ width: "max-content" }}
            >
              {tickerItems.map((market, idx) => (
                <MarketCard key={`${market.id}-${idx}`} market={market} />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-[#484f58] text-center py-6">No markets in this category</p>
      )}
    </div>
  );
}
