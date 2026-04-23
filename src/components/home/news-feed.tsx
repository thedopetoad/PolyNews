"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

// Actual shape returned by /api/news/markets — the server keys links
// by headlineTitle so the client can group them. `MarketLink` above is
// legacy from an earlier headlineIndex-based design that's still kept
// as a structural hint.
interface ApiLink {
  headlineHash?: string;
  headlineTitle: string;
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
  const queryClient = useQueryClient();
  const [activeSource, setActiveSource] = useState<string>("All");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  // Headline title → current state of a user-triggered Find Related Markets
  // request. "finding" while the POST is in flight, "empty" after the
  // pipeline returned zero matches. Absent = idle (show Find button).
  const [findState, setFindState] = useState<Record<string, "finding" | "empty">>({});

  // Ref callback that wires a NATIVE (non-passive) wheel listener for
  // horizontal scroll on the filter strips. React's onWheel prop is
  // passive by default in modern versions, which means preventDefault()
  // is a no-op — the browser scrolls the page vertically regardless of
  // our handler, and the strip never budges horizontally. Attaching via
  // addEventListener with { passive: false } is the only way to both
  // block default scroll AND redirect it sideways. Same pattern the
  // expanded-markets row in portfolio uses.
  //
  // Covers all input types:
  //   - Mouse wheel (deltaY only) → maps to scrollLeft
  //   - Trackpad 2-finger up/down (deltaY) → maps to scrollLeft
  //   - Trackpad 2-finger left/right (deltaX) → scrollLeft directly
  //     (browser already scrolls overflow-x on its own for pure deltaX,
  //     but some paths get captured as "swipe to go back" — preventing
  //     default here keeps the gesture inside the strip)
  const attachHorizontalWheel = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      // Pick the larger-magnitude axis so a pure horizontal trackpad
      // swipe (deltaX only) also consumes the gesture here instead of
      // the browser firing its "swipe back" default.
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      // Both are needed:
      //   preventDefault — blocks the browser's default wheel behavior
      //     on this element (vertical page scroll, swipe-back, etc).
      //   stopPropagation — keeps the event from bubbling to any
      //     ancestor wheel listener (the document's natural scroll
      //     chain) which would ALSO fire and scroll the page. Without
      //     this, the page was scrolling vertically at the same time
      //     as the strip slid horizontally.
      e.preventDefault();
      e.stopPropagation();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", handler, { passive: false });
    // Stash cleanup on the element itself so React's next ref-callback
    // call (on unmount / re-render) can tear it down. Parent doesn't
    // have a clean hook to run cleanup from a ref callback otherwise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).__wheelCleanup?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).__wheelCleanup = () => el.removeEventListener("wheel", handler);
  }, []);

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

  // Must match NEWS_MARKETS_MAX_HEADLINES on the backend. The news API
  // returns ~30, the UI renders all of them, and every rendered row
  // needs to participate in market matching.
  const headlineTitles = useMemo(() => headlines.slice(0, 30).map((h) => h.title), [headlines]);

  // Incremental market search: POST triggers next batch, polls every 60s
  const { data: marketLinksData, isLoading: marketLinksLoading } = useQuery({
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

  // Kicked off when the user clicks "Find Related Markets" on a headline
  // that came back with zero matches. Sends just that one headline to the
  // backend with force=true, which bypasses the processed-hash cache and
  // reruns the match pipeline fresh. Result is persisted in the shared
  // consensus_cache row so every other visitor benefits too.
  const findMarketsForHeadline = useCallback(
    async (title: string, idx: number) => {
      setFindState((prev) => ({ ...prev, [title]: "finding" }));
      try {
        const res = await fetch("/api/news/markets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headlines: [title], force: true }),
        });
        const payload = (await res.json()) as { links?: ApiLink[]; remaining?: number };
        const newLinks: ApiLink[] = Array.isArray(payload?.links) ? payload.links : [];
        const gotAny = newLinks.length > 0;

        // Instantly merge the new links into the react-query cache so
        // `linkByTitle` picks them up without a round-trip refetch. We
        // avoid `invalidateQueries` here because awaiting it blocks the
        // spinner clear on the 15-headline refetch — which can be slow
        // and made the button look stuck. The backend already persisted
        // the matches to `consensus_cache`, so next natural refetch
        // (or other visitors) get the same state from the server.
        queryClient.setQueryData<{ links: ApiLink[]; remaining?: number } | undefined>(
          ["news-market-links"],
          (old) => {
            const existing = old?.links ?? [];
            // Drop any old links tied to this title (handles a prior
            // cached-as-empty state) before merging the new ones in.
            const filtered = existing.filter((l) => l.headlineTitle !== title);
            return { ...(old ?? {}), links: [...filtered, ...newLinks], remaining: 0 };
          },
        );

        if (gotAny) {
          setFindState((prev) => {
            const next = { ...prev };
            delete next[title];
            return next;
          });
          setExpandedIdx(idx);
        } else {
          setFindState((prev) => ({ ...prev, [title]: "empty" }));
        }
      } catch {
        setFindState((prev) => {
          const next = { ...prev };
          delete next[title];
          return next;
        });
      }
    },
    [queryClient],
  );

  return (
    <div className={cn("rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden flex flex-col", className)}>
      <div className="px-4 py-2.5 border-b border-[#21262d] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Breaking news</h3>
        {data?.source === "mock" && (
          <span className="text-[10px] text-[#484f58] bg-[#1c2128] px-2 py-0.5 rounded">Demo</span>
        )}
      </div>

      {/* Source filter tabs */}
      <div
        className="flex gap-1.5 px-3 py-2 border-b border-[#21262d] overflow-x-auto flex-shrink-0"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        ref={attachHorizontalWheel}
      >
        {NEWS_SOURCES.map((src) => (
          <button
            key={src}
            onClick={() => setActiveSource(src)}
            className={cn(
              "px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap flex-shrink-0",
              activeSource === src ? "bg-[#58a6ff]/15 text-[#58a6ff]" : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            {src}
          </button>
        ))}
      </div>

      {/* Category filter tabs */}
      <div
        className="flex gap-1.5 px-3 py-2 border-b border-[#21262d] overflow-x-auto flex-shrink-0"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        ref={attachHorizontalWheel}
      >
        {NEWS_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap flex-shrink-0",
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
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-[11px] text-[#484f58]">{headline.source}</span>
                  {headline.publishedAt && (
                    <span className="text-[10px] text-[#484f58]">{timeAgo(headline.publishedAt)}</span>
                  )}
                  {hasMarket ? (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedIdx(isExpanded ? null : idx); }}
                      aria-expanded={isExpanded}
                      // Neutral accordion-style toggle. Blends with the card
                      // background (bg-[#21262d]) so it reads as part of this
                      // item's own UI rather than a CTA linking somewhere else.
                      // The rotating chevron is the universal "expand this
                      // panel" affordance. Size / tap target kept (min-h-[36px]
                      // + text-[12px] + py-2 + touch-manipulation).
                      className={cn(
                        "ml-auto flex items-center gap-1.5 rounded-md border transition-all duration-150 touch-manipulation select-none font-medium whitespace-nowrap text-[12px] px-3 py-2 min-h-[36px] active:translate-y-[1px]",
                        isExpanded
                          ? "border-[#30363d] bg-[#0d1117] text-[#adbac7] hover:bg-[#161b22]"
                          : "border-[#30363d] bg-[#21262d] text-[#e6edf3] hover:bg-[#2d333b] hover:border-[#444c56]"
                      )}
                    >
                      {isExpanded ? "Hide Markets" : "Click to See Markets"}
                      <svg
                        className={cn("w-3.5 h-3.5 text-[#d29922] transition-transform duration-150", isExpanded && "rotate-180")}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        viewBox="0 0 20 20"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
                      </svg>
                    </button>
                  ) : findState[headline.title] === "finding" ? (
                    <span
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#21262d] text-[#adbac7] whitespace-nowrap text-[12px] px-3 py-2 min-h-[36px] select-none"
                      aria-live="polite"
                    >
                      <svg className="w-3.5 h-3.5 text-[#58a6ff] animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                      Searching markets…
                    </span>
                  ) : findState[headline.title] === "empty" ? (
                    <span
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-[#21262d] bg-transparent text-[#484f58] whitespace-nowrap text-[12px] px-3 py-2 min-h-[36px] select-none"
                      title="The matcher couldn't find any Polymarket markets directly related to this headline."
                    >
                      No markets found
                    </span>
                  ) : marketLinksLoading ? (
                    // Initial page-load state: the top-level market-links
                    // query hasn't resolved yet, so we don't know if this
                    // headline has cached matches. Show a neutral "finding"
                    // pill instead of the active Find CTA so we don't
                    // tempt the user into triggering a duplicate force
                    // request while the bulk POST is already in flight.
                    <span
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#21262d] text-[#adbac7] whitespace-nowrap text-[12px] px-3 py-2 min-h-[36px] select-none"
                      aria-live="polite"
                    >
                      <svg className="w-3.5 h-3.5 text-[#58a6ff] animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                      Finding related markets…
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); findMarketsForHeadline(headline.title, idx); }}
                      // Find Related Markets: a muted blue pill so it reads
                      // as "trigger a search" rather than "open content".
                      // Same shape/size as the expand toggle so rows stay
                      // visually consistent. Clicking kicks off the pipeline
                      // server-side and the result is cached globally.
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-[#1f6feb]/40 bg-[#1f6feb]/10 text-[#58a6ff] hover:bg-[#1f6feb]/20 hover:border-[#1f6feb]/60 transition-all duration-150 touch-manipulation select-none font-medium whitespace-nowrap text-[12px] px-3 py-2 min-h-[36px] active:translate-y-[1px]"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20">
                        <circle cx="9" cy="9" r="5" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 13l3.5 3.5" />
                      </svg>
                      Find Related Markets
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
