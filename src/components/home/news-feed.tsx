"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNewsStore, NewsHeadline } from "@/stores/use-news-store";
import { ScrollArea } from "@/components/ui/scroll-area";

export function NewsFeed() {
  const { headlines, setHeadlines, setKeywords, setLoading } = useNewsStore();

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

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Breaking news</h3>
        {data?.source === "mock" && (
          <span className="text-[10px] text-[#484f58] bg-[#1c2128] px-2 py-0.5 rounded">Demo</span>
        )}
      </div>
      <ScrollArea className="h-[340px]">
        <div className="divide-y divide-[#21262d]">
          {headlines.map((headline, idx) => (
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
          {headlines.length === 0 && !isLoading && (
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
