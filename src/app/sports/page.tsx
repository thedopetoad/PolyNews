"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { LoginButton } from "@/components/layout/login-modal";

interface League {
  code: string;
  name: string;
  emoji: string;
  seriesId: string;
  image: string;
}

interface Market {
  id: string;
  question: string;
  slug: string;
  groupItemTitle: string;
  outcomes: string[];
  prices: number[];
  clobTokenIds: string[];
  volume: number;
  endDate: string;
}

interface SportEvent {
  id: string;
  title: string;
  slug: string;
  image: string;
  startDate: string;
  endDate: string;
  volume: number;
  liquidity: number;
  markets: Market[];
  negRisk: boolean;
}

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = d.getTime() - now.getTime();

  if (diff < 0) return "Live";
  if (diff < 86400000) {
    return `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  if (diff < 172800000) {
    return `Tomorrow ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ─── Outcome Button ─── */
function OutcomeButton({ label, price, isFirst, isLast, eventSlug }: {
  label: string;
  price: number;
  isFirst: boolean;
  isLast: boolean;
  eventSlug: string;
}) {
  const pct = (price * 100).toFixed(0);
  return (
    <a
      href={`${POLYMARKET_BASE_URL}/event/${eventSlug}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex-1 flex flex-col items-center justify-center py-3 px-2 border border-[#21262d] hover:border-[#30363d] hover:bg-[#1c2128] transition-all cursor-pointer min-w-0",
        isFirst && "rounded-l-lg",
        isLast && "rounded-r-lg"
      )}
    >
      <span className="text-[11px] text-[#768390] truncate max-w-full">{label}</span>
      <span className={cn(
        "text-lg font-bold tabular-nums mt-0.5",
        price >= 0.5 ? "text-[#3fb950]" : "text-[#e6edf3]"
      )}>
        {pct}¢
      </span>
    </a>
  );
}

/* ─── Game Card ─── */
function GameCard({ event }: { event: SportEvent }) {
  // For negRisk events (soccer etc), show all markets as outcomes of one game
  // For binary events (MLB etc), show the single market's outcomes
  const isMultiMarket = event.negRisk && event.markets.length > 1;

  if (isMultiMarket) {
    // NegRisk: each market is one outcome (Team A win, Draw, Team B win)
    const outcomes = event.markets.map((m) => ({
      label: m.groupItemTitle || m.outcomes[0] || m.question,
      price: m.prices[0] || 0.5,
      slug: m.slug,
    }));

    return (
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden hover:border-[#30363d] transition-colors">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#e6edf3] truncate">{event.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-[#484f58]">{formatDate(event.endDate)}</span>
              {event.volume > 0 && (
                <span className="text-[11px] text-[#484f58]">{formatVolume(event.volume)} vol</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex mx-3 mb-3">
          {outcomes.map((o, idx) => (
            <OutcomeButton
              key={idx}
              label={o.label}
              price={o.price}
              isFirst={idx === 0}
              isLast={idx === outcomes.length - 1}
              eventSlug={event.slug}
            />
          ))}
        </div>
      </div>
    );
  }

  // Binary market (MLB, NBA, UFC, etc.)
  const market = event.markets[0];
  if (!market) return null;

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden hover:border-[#30363d] transition-colors">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[#e6edf3] truncate">{event.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-[#484f58]">{formatDate(event.endDate)}</span>
            {market.volume > 0 && (
              <span className="text-[11px] text-[#484f58]">{formatVolume(market.volume)} vol</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex mx-3 mb-3">
        {market.outcomes.map((outcome, idx) => (
          <OutcomeButton
            key={idx}
            label={outcome}
            price={market.prices[idx] || 0.5}
            isFirst={idx === 0}
            isLast={idx === market.outcomes.length - 1}
            eventSlug={event.slug}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Loading Skeleton ─── */
function GameSkeleton() {
  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden animate-pulse">
      <div className="px-4 py-3">
        <div className="h-4 bg-[#21262d] rounded w-3/4 mb-2" />
        <div className="h-3 bg-[#21262d] rounded w-1/3" />
      </div>
      <div className="flex mx-3 mb-3 gap-px">
        <div className="flex-1 h-16 bg-[#0d1117] rounded-l-lg" />
        <div className="flex-1 h-16 bg-[#0d1117] rounded-r-lg" />
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function SportsPage() {
  const [selectedSport, setSelectedSport] = useState<string>("mlb");

  const { data: leaguesData } = useQuery({
    queryKey: ["sports-leagues"],
    queryFn: async () => {
      const res = await fetch("/api/sports/leagues");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["sports-events", selectedSport],
    queryFn: async () => {
      const res = await fetch(`/api/sports/events?sport=${selectedSport}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const leagues: League[] = leaguesData?.leagues || [];
  const events: SportEvent[] = eventsData?.events || [];

  // Auto-select first league with events if current has none
  useEffect(() => {
    if (!eventsLoading && events.length === 0 && leagues.length > 0) {
      // Don't auto-switch — user selected this league
    }
  }, [events, eventsLoading, leagues]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Sports</h1>
          <p className="text-sm text-[#768390] mt-0.5">
            Real markets. Real odds. Powered by <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">Polymarket</a>
          </p>
        </div>
        <LoginButton />
      </div>

      {/* League Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
        {leagues.map((league) => (
          <button
            key={league.code}
            onClick={() => setSelectedSport(league.code)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0",
              selectedSport === league.code
                ? "bg-[#238636] text-white shadow-lg shadow-[#238636]/20"
                : "bg-[#161b22] text-[#768390] border border-[#21262d] hover:text-[#adbac7] hover:border-[#30363d]"
            )}
          >
            <span className="text-base">{league.emoji}</span>
            <span>{league.name}</span>
          </button>
        ))}
      </div>

      {/* Games Grid */}
      {eventsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <GameSkeleton key={i} />
          ))}
        </div>
      ) : events.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event) => (
            <GameCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-16 text-center">
          <p className="text-lg text-[#484f58]">No upcoming games</p>
          <p className="text-sm text-[#484f58] mt-1">Check back later or try another league</p>
        </div>
      )}

      {/* Footer note */}
      <p className="text-center text-[10px] text-[#484f58] mt-8">
        Markets provided by Polymarket. Prices update every 2 minutes.
      </p>
    </div>
  );
}
