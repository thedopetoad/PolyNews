"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNewsStore, NewsHeadline } from "@/stores/use-news-store";
import { cn } from "@/lib/utils";
import { POLYMARKET_BASE_URL } from "@/lib/constants";

const NEWS_SOURCES = ["All", "RNIntel", "BBC", "NYT", "Al Jazeera", "Guardian", "Sky News"] as const;
const NEWS_CATEGORIES = ["All", "OSINT", "Iran", "Ukraine", "Crypto", "Finance", "Politics", "Tech"] as const;

interface MarketLink {
  headlineIndex: number;
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
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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

  const headlineTitles = useMemo(() => headlines.slice(0, 15).map((h) => h.title), [headlines]);

  // Incremental market search: POST triggers next batch, polls every 60s
  const { data: marketLinksData } = useQuery({
    queryKey: ["news-market-links"],
    queryFn: async () => {
      if (headlineTitles.length === 0) return { links: [], remaining: 0 };
      const res = await fetch("/api/news/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headlines: headlineTitles }),
      });
      if (!res.ok) return { links: [], remaining: 0 };
      return res.json();
    },
    enabled: headlineTitles.length > 0,
    staleTime: 10_000, // Allow refetch after 10s
    refetchInterval: (query) => {
      // Keep polling every 60s if there are unprocessed headlines
      const remaining = query.state.data?.remaining ?? 1;
      return remaining > 0 ? 60_000 : false;
    },
  });

  const marketLinks: MarketLink[] = marketLinksData?.links || [];

  // Map by headline title (fuzzy: first 40 chars lowercase for resilience to title edits)
  const linkByTitle = useMemo(() => {
    const map = new Map<string, MarketLink[]>();
    for (const link of marketLinks) {
      const rawTitle = (link as unknown as { headlineTitle?: string }).headlineTitle || "";
      if (!rawTitle) continue;
      const key = rawTitle.replace(/[^\w\s]/g, "").toLowerCase().slice(0, 40);
      const existing = map.get(key) || [];
      existing.push(link);
      map.set(key, existing);
    }
    return map;
  }, [marketLinks]);

  useEffect(() => {
    setLoading(isLoading);
  }, [isLoading, setLoading]);

  useEffect(() => {
    if (data?.headlines) {
      setHeadlines(data.headlines);
      const allKeywords = data.headlines.flatMap((h: NewsHeadline) => h.keywords);
      setKeywords([...new Set(allKeywords)] as string[]);
    }
  }, [data, setHeadlines, setKeywords]);

  const filtered = useMemo(() => {
    let result = headlines;
    if (activeSource !== "All") result = result.filter((h) => h.source === activeSource);
    if (activeCategory !== "All") result = result.filter((h) => h.categories?.includes(activeCategory));
    return result;
  }, [headlines, activeSource, activeCategory]);

  const headlineWithMarkets = useMemo(() => {
    return filtered.map((h) => {
      const key = h.title.replace(/[^\w\s]/g, "").toLowerCase().slice(0, 40);
      const markets = linkByTitle.get(key) || [];
      return { headline: h, markets };
    });
  }, [filtered, linkByTitle]);


  return (
    <div className={cn("rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden flex flex-col", className)}>
      <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Breaking news</h3>
        {data?.source === "mock" && (
          <span className="text-[10px] text-[#484f58] bg-[#1c2128] px-2 py-0.5 rounded">Demo</span>
        )}
      </div>

      {/* Source filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-[#21262d] overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {NEWS_SOURCES.map((src) => (
          <button
            key={src}
            onClick={() => setActiveSource(src)}
            className={cn(
              "px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
              activeSource === src ? "bg-[#58a6ff]/15 text-[#58a6ff]" : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            {src}
          </button>
        ))}
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-[#21262d] overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {NEWS_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
              activeCategory === cat ? "bg-[#d29922]/15 text-[#d29922]" : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Headlines */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#21262d transparent" }}>
        <div className="divide-y divide-[#21262d]">
          {headlineWithMarkets.map(({ headline, markets }, idx) => {
            const hasMarket = markets.length > 0;
            const isExpanded = expandedIdx === idx;

            return (
              <div
                key={idx}
                className={cn(
                  "px-4 py-3 transition-colors animate-fade-in-up",
                  isExpanded ? "bg-[#1c2128]" : "hover:bg-[#1c2128]/50",
                  hasMarket && "border-l-2 border-l-[#d29922]/50"
                )}
                style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "backwards" }}
              >
                <a
                  href={headline.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-[13px] text-[#e6edf3] leading-snug line-clamp-2">
                    {headline.title}
                  </p>
                </a>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-[#484f58]">{headline.source}</span>
                  {headline.publishedAt && (
                    <span className="text-[10px] text-[#484f58]">{timeAgo(headline.publishedAt)}</span>
                  )}
                  {hasMarket && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedIdx(isExpanded ? null : idx); }}
                      className="text-[10px] text-[#d29922] hover:text-[#e6b422] ml-auto flex items-center gap-1 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                      {isExpanded ? "Hide Markets" : "See Related Markets"}
                    </button>
                  )}
                </div>

                {/* Expanded: horizontal scrollable market cards */}
                {isExpanded && hasMarket && (
                  <div
                    className="mt-2 -mx-1 overflow-x-auto flex gap-2 pb-1"
                    style={{ scrollbarWidth: "thin", scrollbarColor: "#21262d transparent" }}
                    ref={(el) => {
                      if (!el) return;
                      const handler = (e: WheelEvent) => {
                        if (el.scrollWidth > el.clientWidth && e.deltaY !== 0) {
                          e.preventDefault();
                          e.stopPropagation();
                          el.scrollLeft += e.deltaY;
                        }
                      };
                      el.addEventListener("wheel", handler, { passive: false });
                      // Clean up on unmount via data attribute to avoid duplicates
                      if (!el.dataset.wheelBound) {
                        el.dataset.wheelBound = "1";
                      }
                    }}
                  >
                    {markets.map((market, i) => (
                      <a
                        key={i}
                        href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0 w-52 rounded-lg bg-[#0d1117] border border-[#21262d] hover:border-[#d29922]/40 hover:shadow-[0_0_10px_rgba(210,153,34,0.1)] transition-all p-2.5"
                      >
                        <p className="text-[10px] text-[#e6edf3] font-medium leading-snug line-clamp-2 mb-2">{market.question}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1.5">
                            <span className="text-[10px] font-semibold text-[#3fb950] tabular-nums">Yes {Math.round(market.yesPrice * 100)}¢</span>
                            <span className="text-[10px] font-semibold text-[#f85149] tabular-nums">No {Math.round((1 - market.yesPrice) * 100)}¢</span>
                          </div>
                          <span className="text-[8px] text-[#58a6ff]">Trade →</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && !isLoading && (
            <p className="text-sm text-[#484f58] text-center py-12">No headlines available</p>
          )}
          {isLoading && (
            <p className="text-sm text-[#484f58] text-center py-12">Loading...</p>
          )}
        </div>
      </div>

    </div>
  );
}
