"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNewsStore, NewsHeadline } from "@/stores/use-news-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const NEWS_SOURCES = ["All", "RNIntel", "BBC", "NYT", "Al Jazeera", "Guardian", "Sky News"] as const;
const NEWS_CATEGORIES = ["All", "OSINT", "Iran", "Ukraine", "Crypto", "Finance", "Politics", "Tech"] as const;

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
          {filtered.map((headline, idx) => (
            <a
              key={idx}
              href={headline.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-3 hover:bg-[#1c2128] transition-colors"
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
          ))}
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
