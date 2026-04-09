"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNewsStore, NewsHeadline } from "@/stores/use-news-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { POLYMARKET_BASE_URL } from "@/lib/constants";

const NEWS_SOURCES = ["All", "RNIntel", "BBC", "NYT", "Al Jazeera", "Guardian", "Sky News"] as const;
const NEWS_CATEGORIES = ["All", "OSINT", "Iran", "Ukraine", "Crypto", "Finance", "Politics", "Tech"] as const;

interface MarketLink {
  headlineIndex: number;
  marketId: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NewsFeed({ className }: { className?: string }) {
  const { headlines, setHeadlines, setKeywords, setLoading } = useNewsStore();
  const [activeSource, setActiveSource] = useState<string>("All");
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const { data, isLoading } = useQuery({
    queryKey: ["news-headlines"],
    queryFn: async () => {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch headline → market links
  const { data: marketLinksData } = useQuery({
    queryKey: ["news-market-links"],
    queryFn: async () => {
      const res = await fetch("/api/news/markets");
      if (!res.ok) return { links: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const marketLinks: MarketLink[] = marketLinksData?.links || [];

  // Build a map: headline title → market link
  const linkMap = useMemo(() => {
    const map = new Map<number, MarketLink>();
    for (const link of marketLinks) {
      map.set(link.headlineIndex, link);
    }
    return map;
  }, [marketLinks]);

  useEffect(() => {
    setLoading(isLoading);
  }, [isLoading, setLoading]);

  useEffect(() => {
    if (data?.headlines) {
      setHeadlines(data.headlines);
      const allKeywords = data.headlines.flatMap(
        (h: NewsHeadline) => h.keywords
      );
      setKeywords([...new Set(allKeywords)] as string[]);
    }
  }, [data, setHeadlines, setKeywords]);

  const filtered = useMemo(() => {
    let result = headlines;
    if (activeSource !== "All") {
      result = result.filter((h) => h.source === activeSource);
    }
    if (activeCategory !== "All") {
      result = result.filter((h) => h.categories?.includes(activeCategory));
    }
    return result;
  }, [headlines, activeSource, activeCategory]);

  // Map filtered headlines back to their original index for market link lookup
  const headlineWithIndex = useMemo(() => {
    return filtered.map((h) => {
      const origIdx = headlines.indexOf(h);
      return { headline: h, origIdx };
    });
  }, [filtered, headlines]);

  return (
    <div className={cn("rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden flex flex-col", className)}>
      <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Breaking news</h3>
        {data?.source === "mock" && (
          <span className="text-[10px] text-[#484f58] bg-[#1c2128] px-2 py-0.5 rounded">Demo</span>
        )}
      </div>

      {/* Source filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-[#21262d] overflow-x-auto">
        {NEWS_SOURCES.map((src) => (
          <button
            key={src}
            onClick={() => setActiveSource(src)}
            className={cn(
              "px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
              activeSource === src
                ? "bg-[#58a6ff]/15 text-[#58a6ff]"
                : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            {src}
          </button>
        ))}
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-[#21262d] overflow-x-auto">
        {NEWS_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
              activeCategory === cat
                ? "bg-[#d29922]/15 text-[#d29922]"
                : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="divide-y divide-[#21262d]">
          {headlineWithIndex.map(({ headline, origIdx }, idx) => {
            const market = linkMap.get(origIdx);

            return (
              <div
                key={idx}
                className="px-4 py-3 hover:bg-[#1c2128] transition-colors animate-fade-in-up"
                style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "backwards" }}
              >
                <a
                  href={headline.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <p className="text-[13px] text-[#e6edf3] leading-snug line-clamp-2">
                    {headline.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-[#484f58]">{headline.source}</span>
                    {headline.publishedAt && (
                      <span className="text-[10px] text-[#484f58]">{timeAgo(headline.publishedAt)}</span>
                    )}
                    {headline.keywords.length > 0 && (
                      <div className="flex gap-1">
                        {headline.keywords.slice(0, 3).map((kw) => (
                          <span
                            key={kw}
                            className="text-[10px] text-[#58a6ff] bg-[#58a6ff]/10 px-1.5 py-0.5 rounded"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </a>

                {/* Linked Market */}
                {market && (
                  <a
                    href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0d1117] border border-[#21262d] hover:border-[#30363d] hover:shadow-[0_0_8px_rgba(88,166,255,0.1)] transition-all"
                  >
                    <svg className="w-3 h-3 text-[#d29922] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    <span className="text-[11px] text-[#adbac7] truncate flex-1">{market.question}</span>
                    <span className="text-[11px] font-semibold text-[#3fb950] tabular-nums flex-shrink-0">
                      {Math.round(market.yesPrice * 100)}¢
                    </span>
                  </a>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && !isLoading && (
            <p className="text-sm text-[#484f58] text-center py-12">
              No headlines available
            </p>
          )}
          {isLoading && (
            <p className="text-sm text-[#484f58] text-center py-12">
              Loading...
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
