"use client";

import { useQuery } from "@tanstack/react-query";
import { formatPercentage, formatVolume } from "@/types/polymarket";
import { POLYMARKET_BASE_URL } from "@/lib/constants";

interface LiveMarket {
  id: string;
  question: string;
  slug: string;
  eventSlug: string;
  volume: string;
  yesPrice: number;
  noPrice: number;
}

function MarketCard({ market }: { market: LiveMarket }) {
  return (
    <a
      href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug || market.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-shrink-0 w-72 rounded-lg border border-[#21262d] bg-[#161b22] p-3 hover:border-[#30363d] hover:shadow-[0_0_12px_rgba(88,166,255,0.1)] transition-all"
    >
      <p className="text-[13px] font-medium text-[#e6edf3] leading-snug line-clamp-2 h-10">
        {market.question}
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
  const { data, isLoading } = useQuery({
    queryKey: ["live-markets"],
    queryFn: async () => {
      const res = await fetch("/api/markets/live");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000, // Refresh every 15 min
  });

  const markets: LiveMarket[] = data?.markets || [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Live Markets</h3>
          <span className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-0.5 rounded">AI-selected</span>
        </div>
        <p className="text-sm text-[#484f58] text-center py-6">Finding relevant markets...</p>
      </div>
    );
  }

  if (markets.length === 0) return null;

  const useScroll = markets.length > 4;
  const tickerItems = useScroll ? [...markets, ...markets] : markets;

  // Scale scroll duration so apparent velocity stays readable regardless of
  // market count. Each card is ~288px wide plus a 12px gap; 4s/card ≈ 75
  // px/s linear, which reads comfortably without pausing.
  const durationSeconds = Math.max(80, markets.length * 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Live Markets</h3>
        <span className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-0.5 rounded">AI-selected</span>
        <span className="text-[10px] text-[#484f58] ml-auto">{markets.length} markets matched to live news</span>
      </div>

      {useScroll ? (
        <div className="overflow-hidden">
          <div
            className="flex gap-3 pl-4 hover:[animation-play-state:paused]"
            style={{
              width: "max-content",
              animation: `ticker ${durationSeconds}s linear infinite`,
            }}
          >
            {tickerItems.map((market, idx) => (
              <MarketCard key={`${market.id}-${idx}`} market={market} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
