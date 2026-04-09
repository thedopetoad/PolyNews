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
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

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

  // POST headlines to get market matches (only when headlines are loaded)
  const headlineTitles = useMemo(() => headlines.slice(0, 15).map((h) => h.title), [headlines]);

  const { data: marketLinksData } = useQuery({
    queryKey: ["news-market-links", headlineTitles[0]],
    queryFn: async () => {
      if (headlineTitles.length === 0) return { links: [] };
      const res = await fetch("/api/news/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headlines: headlineTitles }),
      });
      if (!res.ok) return { links: [] };
      return res.json();
    },
    enabled: headlineTitles.length > 0,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const marketLinks: MarketLink[] = marketLinksData?.links || [];

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

  const headlineWithIndex = useMemo(() => {
    return filtered.map((h) => {
      const origIdx = headlines.indexOf(h);
      return { headline: h, origIdx };
    });
  }, [filtered, headlines]);

  // Get hovered market
  const hoveredMarket = hoveredIdx !== null ? linkMap.get(hoveredIdx) : null;

  return (
    <div className={cn("rounded-lg border border-[#21262d] bg-[#161b22] overflow-visible flex flex-col relative", className)}>
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
            const hasMarket = linkMap.has(origIdx);

            return (
              <a
                key={idx}
                href={headline.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "block px-4 py-3 transition-colors animate-fade-in-up relative",
                  hoveredIdx === origIdx ? "bg-[#1c2128]" : "hover:bg-[#1c2128]",
                  hasMarket && "border-l-2 border-l-[#d29922]/50"
                )}
                style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "backwards" }}
                onMouseEnter={() => hasMarket && setHoveredIdx(origIdx)}
                onMouseLeave={() => setHoveredIdx(null)}
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
                  {hasMarket && (
                    <span className="text-[9px] text-[#d29922] ml-auto">📊</span>
                  )}
                </div>
              </a>
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

      {/* Floating Market Panel — appears on hover, positioned to the left of the news feed */}
      {hoveredMarket && (
        <div className="absolute left-full top-16 ml-3 w-64 z-50 pointer-events-auto hidden lg:block animate-fade-in-up">
          <a
            href={`${POLYMARKET_BASE_URL}/event/${hoveredMarket.eventSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-2xl shadow-black/50 hover:border-[#58a6ff]/30 hover:shadow-[0_0_20px_rgba(88,166,255,0.15)] transition-all"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <svg className="w-3 h-3 text-[#d29922]" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
              <span className="text-[10px] text-[#d29922] font-medium">Related Market</span>
            </div>
            <p className="text-[12px] text-[#e6edf3] font-medium leading-snug mb-3">
              {hoveredMarket.question}
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#3fb950] tabular-nums">
                  Yes {Math.round(hoveredMarket.yesPrice * 100)}¢
                </span>
                <span className="text-xs font-semibold text-[#f85149] tabular-nums">
                  No {Math.round((1 - hoveredMarket.yesPrice) * 100)}¢
                </span>
              </div>
              <span className="text-[9px] text-[#58a6ff]">Polymarket →</span>
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
