"use client";

import { useState, useMemo } from "react";
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
  gameStartTime: string;
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

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
  const isTomorrow = d.toDateString() === tmrw.toDateString();
  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Extract key markets from an event: moneyline, spread, total
function extractKeyMarkets(event: SportEvent) {
  const markets = event.markets;
  let moneyline: Market | null = null;
  let spread: Market | null = null;
  let total: Market | null = null;

  for (const m of markets) {
    const q = m.question.toLowerCase();
    if (!moneyline && !q.includes("spread") && !q.includes("o/u") && !q.includes(":") && !q.includes("halftime") && !q.includes("exact")) {
      moneyline = m;
    }
    if (!spread && q.includes("spread")) {
      spread = m;
    }
    if (!total && q.includes("o/u") && !q.includes(":")) {
      total = m;
    }
  }

  // For negRisk events (soccer), first market is typically the main one
  if (!moneyline && markets.length > 0) {
    moneyline = markets[0];
  }

  return { moneyline, spread, total, totalMarkets: markets.length };
}

// Parse team names from event title ("Team A vs. Team B" → ["Team A", "Team B"])
function parseTeams(title: string): [string, string] {
  const parts = title.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) return [parts[0].trim(), parts[1].trim()];
  return [title, ""];
}

// Abbreviate team name
function abbrev(name: string): string {
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  // Use last word (usually the team name, not city)
  return words[words.length - 1].slice(0, 3).toUpperCase();
}

/* ─── Team Row ─── */
function TeamRow({ name, mlPrice, spreadLabel, spreadPrice, totalLabel, totalPrice, highlight, eventSlug }: {
  name: string;
  mlPrice: number;
  spreadLabel?: string;
  spreadPrice?: number;
  totalLabel?: string;
  totalPrice?: number;
  highlight: boolean;
  eventSlug: string;
}) {
  const tag = abbrev(name);
  const pct = Math.round(mlPrice * 100);

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {/* Team */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={cn(
          "inline-flex items-center justify-center w-10 h-6 rounded text-[10px] font-bold tracking-wide",
          highlight ? "bg-[#238636]/25 text-[#3fb950]" : "bg-[#21262d] text-[#768390]"
        )}>
          {tag}
        </span>
        <span className="text-[13px] text-[#e6edf3] truncate">{name}</span>
      </div>

      {/* Moneyline */}
      <a
        href={`${POLYMARKET_BASE_URL}/event/${eventSlug}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "w-24 text-center py-1.5 rounded-md text-xs font-semibold tabular-nums transition-all",
          highlight
            ? "bg-[#238636]/20 text-[#3fb950] hover:bg-[#238636]/30 hover:shadow-[0_0_10px_rgba(63,185,80,0.25)]"
            : "bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
        )}
      >
        {tag} {pct}¢
      </a>

      {/* Spread */}
      <div className="w-24 text-center hidden md:block">
        {spreadLabel && spreadPrice !== undefined ? (
          <span className="text-xs text-[#adbac7] tabular-nums">
            {spreadLabel} <span className="text-[#e6edf3] font-medium">{Math.round(spreadPrice * 100)}¢</span>
          </span>
        ) : (
          <span className="text-xs text-[#484f58]">—</span>
        )}
      </div>

      {/* Total */}
      <div className="w-24 text-center hidden md:block">
        {totalLabel && totalPrice !== undefined ? (
          <span className="text-xs text-[#adbac7] tabular-nums">
            {totalLabel} <span className="text-[#e6edf3] font-medium">{Math.round(totalPrice * 100)}¢</span>
          </span>
        ) : (
          <span className="text-xs text-[#484f58]">—</span>
        )}
      </div>
    </div>
  );
}

/* ─── Game Card (Polymarket-style) ─── */
function GameCard({ event, index }: { event: SportEvent; index: number }) {
  const [teamA, teamB] = parseTeams(event.title);
  const { moneyline, spread, total, totalMarkets } = extractKeyMarkets(event);
  const vol = formatVol(event.volume || event.markets.reduce((s, m) => s + m.volume, 0));
  const time = formatTime(event.gameStartTime);
  const gameStart = new Date(event.gameStartTime).getTime();
  const isLive = gameStart <= Date.now() && (Date.now() - gameStart) < 4 * 60 * 60 * 1000;

  // Moneyline prices
  const mlPriceA = moneyline?.prices[0] ?? 0.5;
  const mlPriceB = moneyline?.prices[1] ?? 0.5;
  const aIsFavorite = mlPriceA > mlPriceB;

  // Spread data (for team A / team B)
  let spreadA: { label: string; price: number } | null = null;
  let spreadB: { label: string; price: number } | null = null;
  if (spread) {
    const q = spread.question;
    const match = q.match(/-?\d+\.?\d*/);
    const val = match ? match[0] : "";
    spreadA = { label: `${abbrev(teamA)} ${val}`, price: spread.prices[0] ?? 0.5 };
    spreadB = { label: `${abbrev(teamB)} +${val.replace("-", "")}`, price: spread.prices[1] ?? 0.5 };
  }

  // Total data
  let totalOver: { label: string; price: number } | null = null;
  let totalUnder: { label: string; price: number } | null = null;
  if (total) {
    const match = total.question.match(/[\d.]+/);
    const val = match ? match[0] : "";
    totalOver = { label: `O ${val}`, price: total.prices[0] ?? 0.5 };
    totalUnder = { label: `U ${val}`, price: total.prices[1] ?? 0.5 };
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-[#161b22] overflow-hidden animate-fade-in-up",
        isLive ? "border-[#f85149]/30" : "border-[#21262d]"
      )}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: "backwards" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#21262d]">
        <div className="flex items-center gap-2">
          {isLive && <span className="text-[10px] font-bold text-[#f85149] bg-[#f85149]/10 px-1.5 py-0.5 rounded animate-glow-red">LIVE</span>}
          <span className="text-[11px] text-[#484f58]">{time}</span>
          {vol && <span className="text-[11px] text-[#484f58]">{vol} Vol.</span>}
        </div>
        <a
          href={`${POLYMARKET_BASE_URL}/event/${event.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[#58a6ff] hover:underline flex items-center gap-1"
        >
          <span className="text-[#484f58]">{totalMarkets}</span> Game View &rsaquo;
        </a>
      </div>

      {/* Column Headers */}
      <div className="flex items-center gap-3 px-4 py-1 text-[9px] text-[#484f58] uppercase tracking-widest">
        <div className="flex-1" />
        <div className="w-24 text-center">Moneyline</div>
        <div className="w-24 text-center hidden md:block">Spread</div>
        <div className="w-24 text-center hidden md:block">Total</div>
      </div>

      {/* Team A */}
      <TeamRow
        name={teamA}
        mlPrice={mlPriceA}
        spreadLabel={spreadA?.label}
        spreadPrice={spreadA?.price}
        totalLabel={totalOver?.label}
        totalPrice={totalOver?.price}
        highlight={aIsFavorite}
        eventSlug={event.slug}
      />

      {/* Team B */}
      <TeamRow
        name={teamB}
        mlPrice={mlPriceB}
        spreadLabel={spreadB?.label}
        spreadPrice={spreadB?.price}
        totalLabel={totalUnder?.label}
        totalPrice={totalUnder?.price}
        highlight={!aIsFavorite}
        eventSlug={event.slug}
      />
    </div>
  );
}

/* ─── Loading Skeleton ─── */
function GameSkeleton() {
  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden animate-pulse">
      <div className="px-4 py-2 border-b border-[#21262d] flex justify-between">
        <div className="h-3 bg-[#21262d] rounded w-24" />
        <div className="h-3 bg-[#21262d] rounded w-16" />
      </div>
      <div className="px-4 py-2 flex items-center gap-3">
        <div className="h-6 w-10 bg-[#21262d] rounded" />
        <div className="h-4 bg-[#21262d] rounded w-32" />
        <div className="ml-auto h-7 w-20 bg-[#21262d] rounded-md" />
      </div>
      <div className="px-4 py-2 flex items-center gap-3">
        <div className="h-6 w-10 bg-[#21262d] rounded" />
        <div className="h-4 bg-[#21262d] rounded w-28" />
        <div className="ml-auto h-7 w-20 bg-[#21262d] rounded-md" />
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function SportsPage() {
  const [selectedSport, setSelectedSport] = useState<string>("mlb");
  const [view, setView] = useState<"live" | "upcoming">("upcoming");

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
  const FOUR_HOURS = 4 * 60 * 60 * 1000;

  const liveEvents = events.filter((e) => {
    const gs = new Date(e.gameStartTime).getTime();
    return gs <= now && (now - gs) < FOUR_HOURS;
  });

  const upcomingEvents = events.filter((e) => {
    const gs = new Date(e.gameStartTime).getTime();
    return gs > now;
  });

  // Group upcoming by date
  const grouped = useMemo(() => {
    const groups: { date: string; events: SportEvent[] }[] = [];
    for (const e of upcomingEvents) {
      const dateKey = new Date(e.gameStartTime).toDateString();
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) { existing.events.push(e); }
      else { groups.push({ date: dateKey, events: [e] }); }
    }
    return groups;
  }, [upcomingEvents]);

  const selectedLeague = leagues.find((l) => l.code === selectedSport);
  const visibleEvents = view === "live" ? liveEvents : upcomingEvents;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Sports</h1>
          <p className="text-sm text-[#768390] mt-0.5">
            Real markets. Real odds. Powered by <a href="https://polymarket.com/sports" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">Polymarket</a>
          </p>
        </div>
        <LoginButton />
      </div>

      {/* Live / Upcoming tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setView("live")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            view === "live"
              ? "bg-[#f85149]/15 text-[#f85149] border border-[#f85149]/30"
              : "bg-[#161b22] text-[#768390] border border-[#21262d] hover:text-[#adbac7]"
          )}
        >
          Live {liveEvents.length > 0 && <span className="ml-1.5 text-[10px] bg-[#f85149] text-white px-1.5 py-0.5 rounded-full">{liveEvents.length}</span>}
        </button>
        <button
          onClick={() => setView("upcoming")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            view === "upcoming"
              ? "bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30"
              : "bg-[#161b22] text-[#768390] border border-[#21262d] hover:text-[#adbac7]"
          )}
        >
          Upcoming
        </button>
      </div>

      <div className="flex gap-6">
        {/* Sidebar — League List */}
        <div className="hidden lg:block w-48 flex-shrink-0">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider font-medium mb-2 px-2">All Sports</p>
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
          </div>

          {/* Games */}
          {eventsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <GameSkeleton key={i} />)}
            </div>
          ) : view === "live" ? (
            liveEvents.length > 0 ? (
              <div className="space-y-3">
                {liveEvents.map((e, i) => <GameCard key={e.id} event={e} index={i} />)}
              </div>
            ) : (
              <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-16 text-center">
                <p className="text-[#484f58]">No live games right now</p>
                <button onClick={() => setView("upcoming")} className="text-sm text-[#58a6ff] hover:underline mt-2">View upcoming</button>
              </div>
            )
          ) : grouped.length > 0 ? (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.date}>
                  <p className="text-sm font-semibold text-[#e6edf3] mb-3">{formatDateHeader(group.events[0].gameStartTime)}</p>
                  <div className="space-y-3">
                    {group.events.map((e, i) => <GameCard key={e.id} event={e} index={i} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-16 text-center">
              <p className="text-[#484f58]">No upcoming games</p>
              <p className="text-[11px] text-[#484f58] mt-1">Check back later or try another league</p>
            </div>
          )}

          <p className="text-center text-[10px] text-[#484f58] mt-6">
            Odds update every 2 minutes from Polymarket CLOB
          </p>
        </div>
      </div>
    </div>
  );
}
