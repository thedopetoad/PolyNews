"use client";

import { useState } from "react";
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

function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n > 0) return `$${n.toFixed(0)}`;
  return "";
}

function formatGameTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return "LIVE";
  if (diff < 86400000) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diff < 172800000) return `Tomorrow`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ─── Odds Pill ─── */
function OddsPill({ label, price, eventSlug, highlight }: {
  label: string;
  price: number;
  eventSlug: string;
  highlight?: boolean;
}) {
  const pct = Math.round(price * 100);
  return (
    <a
      href={`${POLYMARKET_BASE_URL}/event/${eventSlug}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
        highlight
          ? "bg-[#238636]/20 text-[#3fb950] hover:bg-[#238636]/30 border border-[#238636]/30"
          : "bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] border border-transparent"
      )}
    >
      <span className="truncate max-w-[80px]">{label}</span>
      <span className="tabular-nums">{pct}¢</span>
    </a>
  );
}

/* ─── Game Row (Polymarket-style) ─── */
function GameRow({ event }: { event: SportEvent }) {
  const isMultiMarket = event.negRisk && event.markets.length > 1;
  const time = formatGameTime(event.endDate);
  const vol = formatVol(event.volume || event.markets.reduce((s, m) => s + m.volume, 0));
  const isLive = time === "LIVE";

  // Build outcomes list
  let outcomes: { label: string; price: number }[] = [];

  if (isMultiMarket) {
    outcomes = event.markets.map((m) => ({
      label: m.groupItemTitle || m.outcomes[0] || "?",
      price: m.prices[0] || 0,
    }));
  } else if (event.markets[0]) {
    const m = event.markets[0];
    outcomes = m.outcomes.map((o, i) => ({
      label: o,
      price: m.prices[i] || 0,
    }));
  }

  // Filter out 0% or 100% outcomes that are resolved
  outcomes = outcomes.filter((o) => o.price > 0.01 && o.price < 0.99);
  if (outcomes.length === 0 && event.markets[0]) {
    const m = event.markets[0];
    outcomes = m.outcomes.map((o, i) => ({ label: o, price: m.prices[i] || 0.5 }));
  }

  // Find the favorite
  const maxPrice = Math.max(...outcomes.map((o) => o.price));

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-[#21262d] hover:bg-[#1c2128]/50 transition-colors">
      {/* Time */}
      <div className="w-16 flex-shrink-0 text-center">
        {isLive ? (
          <span className="text-[11px] font-bold text-[#f85149] bg-[#f85149]/10 px-2 py-0.5 rounded">LIVE</span>
        ) : (
          <span className="text-[11px] text-[#484f58]">{time}</span>
        )}
      </div>

      {/* Event Title + Volume */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#e6edf3] truncate">{event.title}</p>
        {vol && <span className="text-[10px] text-[#484f58]">{vol} Vol.</span>}
      </div>

      {/* Odds Pills */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {outcomes.slice(0, 3).map((o, idx) => (
          <OddsPill
            key={idx}
            label={o.label}
            price={o.price}
            eventSlug={event.slug}
            highlight={o.price === maxPrice && outcomes.length > 1}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Loading Skeleton ─── */
function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-[#21262d] animate-pulse">
      <div className="w-16 flex-shrink-0"><div className="h-3 bg-[#21262d] rounded w-10 mx-auto" /></div>
      <div className="flex-1"><div className="h-4 bg-[#21262d] rounded w-2/3 mb-1" /><div className="h-3 bg-[#21262d] rounded w-1/4" /></div>
      <div className="flex gap-2"><div className="h-7 w-20 bg-[#21262d] rounded-full" /><div className="h-7 w-20 bg-[#21262d] rounded-full" /></div>
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

  // Separate live and upcoming
  const now = Date.now();
  const liveEvents = events.filter((e) => new Date(e.endDate).getTime() > now && new Date(e.startDate || e.endDate).getTime() <= now);
  const upcomingEvents = events.filter((e) => !liveEvents.includes(e));

  const selectedLeague = leagues.find((l) => l.code === selectedSport);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Sports</h1>
          <p className="text-sm text-[#768390] mt-0.5">
            Real markets. Real odds. Powered by <a href="https://polymarket.com/sports" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">Polymarket</a>
          </p>
        </div>
        <LoginButton />
      </div>

      <div className="flex gap-6">
        {/* Sidebar — League List */}
        <div className="hidden lg:block w-48 flex-shrink-0">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider font-medium mb-2 px-2">Leagues</p>
          <div className="space-y-0.5">
            {leagues.map((league) => (
              <button
                key={league.code}
                onClick={() => setSelectedSport(league.code)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                  selectedSport === league.code
                    ? "bg-[#1c2128] text-white font-medium"
                    : "text-[#768390] hover:text-[#adbac7] hover:bg-[#161b22]"
                )}
              >
                <span className="text-base w-5 text-center">{league.emoji}</span>
                <span className="truncate">{league.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Mobile league tabs */}
          <div className="lg:hidden flex gap-2 overflow-x-auto pb-3 mb-4" style={{ scrollbarWidth: "none" }}>
            {leagues.map((league) => (
              <button
                key={league.code}
                onClick={() => setSelectedSport(league.code)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors",
                  selectedSport === league.code
                    ? "bg-[#238636] text-white"
                    : "bg-[#161b22] text-[#768390] border border-[#21262d]"
                )}
              >
                <span>{league.emoji}</span>
                <span>{league.name}</span>
              </button>
            ))}
          </div>

          {/* League Header */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">{selectedLeague?.emoji}</span>
            <h2 className="text-lg font-semibold text-white">{selectedLeague?.name || selectedSport.toUpperCase()}</h2>
            <span className="text-[11px] text-[#484f58] bg-[#161b22] px-2 py-0.5 rounded-full border border-[#21262d]">
              {events.length} {events.length === 1 ? "game" : "games"}
            </span>
          </div>

          {/* Events List */}
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
            {/* Column Headers */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-[#21262d] text-[10px] text-[#484f58] uppercase tracking-wider">
              <div className="w-16 text-center">Time</div>
              <div className="flex-1">Match</div>
              <div className="flex-shrink-0">Moneyline</div>
            </div>

            {eventsLoading ? (
              Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
            ) : events.length > 0 ? (
              <>
                {liveEvents.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 bg-[#f85149]/5 border-b border-[#21262d]">
                      <span className="text-[10px] font-semibold text-[#f85149] uppercase tracking-wider">Live Now</span>
                    </div>
                    {liveEvents.map((e) => <GameRow key={e.id} event={e} />)}
                  </>
                )}
                {upcomingEvents.length > 0 && (
                  <>
                    {liveEvents.length > 0 && (
                      <div className="px-4 py-1.5 bg-[#0d1117] border-b border-[#21262d]">
                        <span className="text-[10px] font-semibold text-[#484f58] uppercase tracking-wider">Upcoming</span>
                      </div>
                    )}
                    {upcomingEvents.map((e) => <GameRow key={e.id} event={e} />)}
                  </>
                )}
              </>
            ) : (
              <div className="px-4 py-16 text-center">
                <p className="text-[#484f58]">No upcoming games</p>
                <p className="text-[11px] text-[#484f58] mt-1">Check back later or try another league</p>
              </div>
            )}
          </div>

          <p className="text-center text-[10px] text-[#484f58] mt-4">
            Odds update every 2 minutes from Polymarket CLOB
          </p>
        </div>
      </div>
    </div>
  );
}
