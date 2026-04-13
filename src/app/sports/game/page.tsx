"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { BetSlip } from "@/components/sports/bet-slip";
import Link from "next/link";
import { Suspense } from "react";

interface ParsedMarket {
  id: string;
  question: string;
  groupItemTitle: string;
  outcomes: string[];
  prices: number[];
  clobTokenIds: string[];
  volume: number;
}

interface ESPNScore {
  homeTeam: { name: string; abbreviation: string; score: string; logo: string; record?: string };
  awayTeam: { name: string; abbreviation: string; score: string; logo: string; record?: string };
  status: string;
  detail: string;
  period: number;
  clock: string;
  isLive: boolean;
}

interface GameData {
  id: string;
  title: string;
  slug: string;
  image: string;
  gameStartTime: string;
  volume: number;
  espn: ESPNScore | null;
  markets: {
    moneyline: ParsedMarket[];
    spreads: ParsedMarket[];
    totals: ParsedMarket[];
    props: ParsedMarket[];
  };
}

function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n > 0) return `$${n.toFixed(0)}`;
  return "";
}

/* ─── Odds Button ─── */
function OddsBtn({ label, price, highlight, selected, onClick }: { label: string; price: number; highlight?: boolean; selected?: boolean; onClick?: () => void }) {
  const pct = Math.round(price * 100);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-between px-4 py-3 rounded-lg border transition-all cursor-pointer w-full text-left",
        selected
          ? "bg-[#238636]/30 border-[#3fb950] ring-1 ring-[#3fb950]"
          : highlight
            ? "bg-[#238636]/15 border-[#238636]/30 hover:bg-[#238636]/25 hover:shadow-[0_0_12px_rgba(63,185,80,0.2)]"
            : "bg-[#0d1117] border-[#21262d] hover:bg-[#1c2128] hover:border-[#30363d]"
      )}
    >
      <span className="text-sm text-[#e6edf3] font-medium">{label}</span>
      <span className={cn("text-lg font-bold tabular-nums", selected ? "text-[#3fb950]" : highlight ? "text-[#3fb950]" : "text-[#e6edf3]")}>{pct}¢</span>
    </button>
  );
}

/* ─── Market Section ─── */
function MarketSection({ title, markets, volume, eventTitle, eventSlug, eventEndDate, negRisk }: {
  title: string; markets: ParsedMarket[]; volume?: number;
  eventTitle: string; eventSlug: string; eventEndDate: string; negRisk?: boolean;
}) {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [selectedOutcomeIdx, setSelectedOutcomeIdx] = useState<number | null>(null);

  if (markets.length === 0) return null;

  const selectedMarket = markets.find((m) => m.id === selectedMarketId);
  const betOutcomes = selectedMarket ? selectedMarket.outcomes.map((o, i) => ({
    name: o,
    price: selectedMarket.prices[i] || 0.5,
    tokenId: selectedMarket.clobTokenIds[i] || "",
  })) : [];

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden animate-fade-in-up">
      <div className="px-4 py-3 border-b border-[#21262d] flex items-center justify-between">
        <span className="text-sm font-semibold text-white">{title}</span>
        {volume !== undefined && volume > 0 && (
          <span className="text-[10px] text-[#484f58]">{formatVol(volume)} Vol.</span>
        )}
      </div>
      <div className="p-3 space-y-2">
        {markets.map((m) => {
          const maxPrice = Math.max(...m.prices);
          return (
            <div key={m.id}>
              {m.question !== markets[0]?.question && markets.length > 1 && (
                <p className="text-[11px] text-[#484f58] mb-1.5 px-1">{m.question}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {m.outcomes.map((o, i) => (
                  <OddsBtn
                    key={i}
                    label={m.groupItemTitle && m.outcomes.length === 2 && i === 0 ? m.groupItemTitle : o}
                    price={m.prices[i] || 0}
                    highlight={m.prices[i] === maxPrice && m.outcomes.length > 1}
                    selected={selectedMarketId === m.id && selectedOutcomeIdx === i}
                    onClick={() => {
                      if (selectedMarketId === m.id && selectedOutcomeIdx === i) {
                        setSelectedMarketId(null);
                        setSelectedOutcomeIdx(null);
                      } else {
                        setSelectedMarketId(m.id);
                        setSelectedOutcomeIdx(i);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inline Bet Slip when an outcome is selected */}
      {selectedMarket && (
        <div className="p-3 border-t border-[#21262d] bg-[#0d1117]">
          <BetSlip
            eventTitle={eventTitle}
            eventSlug={eventSlug}
            eventEndDate={eventEndDate}
            marketId={selectedMarket.id}
            marketQuestion={selectedMarket.question}
            outcomes={betOutcomes}
            negRisk={negRisk}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Scoreboard ─── */
function Scoreboard({ espn, title, gameTime }: { espn: ESPNScore | null; title: string; gameTime: string }) {
  const teams = title.split(/\s+vs\.?\s+/i);
  const teamA = teams[0]?.trim() || "Team A";
  const teamB = teams[1]?.trim() || "Team B";

  const time = new Date(gameTime);
  const timeStr = !isNaN(time.getTime())
    ? time.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

  if (espn) {
    return (
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-6 animate-fade-in-up">
        {/* Status */}
        <div className="text-center mb-4">
          {espn.isLive ? (
            <span className="text-xs font-bold text-[#f85149] bg-[#f85149]/10 px-3 py-1 rounded-full animate-glow-red">
              LIVE &middot; {espn.detail}
            </span>
          ) : (
            <span className="text-xs text-[#484f58]">{espn.detail || timeStr}</span>
          )}
        </div>

        {/* Teams + Score */}
        <div className="flex items-center justify-center gap-8">
          {/* Away */}
          <div className="flex flex-col items-center gap-2 min-w-[100px]">
            {espn.awayTeam.logo && (
              <img src={espn.awayTeam.logo} alt={espn.awayTeam.abbreviation} className="w-14 h-14 object-contain" />
            )}
            <span className="text-sm font-semibold text-[#e6edf3]">{espn.awayTeam.abbreviation}</span>
            {espn.awayTeam.record && <span className="text-[10px] text-[#484f58]">{espn.awayTeam.record}</span>}
          </div>

          {/* Score */}
          <div className="flex items-center gap-4">
            <span className="text-4xl font-bold text-white tabular-nums">{espn.awayTeam.score}</span>
            <span className="text-lg text-[#484f58]">-</span>
            <span className="text-4xl font-bold text-white tabular-nums">{espn.homeTeam.score}</span>
          </div>

          {/* Home */}
          <div className="flex flex-col items-center gap-2 min-w-[100px]">
            {espn.homeTeam.logo && (
              <img src={espn.homeTeam.logo} alt={espn.homeTeam.abbreviation} className="w-14 h-14 object-contain" />
            )}
            <span className="text-sm font-semibold text-[#e6edf3]">{espn.homeTeam.abbreviation}</span>
            {espn.homeTeam.record && <span className="text-[10px] text-[#484f58]">{espn.homeTeam.record}</span>}
          </div>
        </div>
      </div>
    );
  }

  // Fallback: no ESPN data
  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-6 text-center animate-fade-in-up">
      <p className="text-xs text-[#484f58] mb-3">{timeStr}</p>
      <div className="flex items-center justify-center gap-6">
        <span className="text-lg font-semibold text-[#e6edf3]">{teamA}</span>
        <span className="text-sm text-[#484f58]">vs</span>
        <span className="text-lg font-semibold text-[#e6edf3]">{teamB}</span>
      </div>
    </div>
  );
}

/* ─── Inner Content (needs useSearchParams) ─── */
function GameContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const sport = searchParams.get("sport") || "";

  const { data, isLoading, error } = useQuery<GameData>({
    queryKey: ["sports-game", eventId],
    queryFn: async () => {
      const res = await fetch(`/api/sports/game?eventId=${eventId}&sport=${sport}`);
      if (!res.ok) throw new Error("Failed to load game");
      return res.json();
    },
    enabled: !!eventId,
    staleTime: 30_000,
    refetchInterval: 30_000, // Refresh every 30s for live scores
  });

  if (!eventId) {
    return (
      <div className="text-center py-16">
        <p className="text-[#484f58]">No game selected</p>
        <Link href="/sports" className="text-sm text-[#58a6ff] hover:underline mt-2 inline-block">Back to Sports</Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-6 animate-pulse">
          <div className="flex items-center justify-center gap-8">
            <div className="w-14 h-14 bg-[#21262d] rounded-full" />
            <div className="flex gap-4"><div className="h-10 w-12 bg-[#21262d] rounded" /><div className="h-10 w-4 bg-[#21262d] rounded" /><div className="h-10 w-12 bg-[#21262d] rounded" /></div>
            <div className="w-14 h-14 bg-[#21262d] rounded-full" />
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-[#21262d] bg-[#161b22] p-4 animate-pulse">
            <div className="h-4 bg-[#21262d] rounded w-24 mb-3" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-14 bg-[#0d1117] rounded-lg" />
              <div className="h-14 bg-[#0d1117] rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16">
        <p className="text-[#f85149]">Failed to load game data</p>
        <Link href="/sports" className="text-sm text-[#58a6ff] hover:underline mt-2 inline-block">Back to Sports</Link>
      </div>
    );
  }

  const totalMarketCount =
    data.markets.moneyline.length +
    data.markets.spreads.length +
    data.markets.totals.length +
    data.markets.props.length;

  const totalVolume = data.volume;

  return (
    <>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11px] text-[#484f58] mb-4">
        <Link href="/sports" className="text-[#58a6ff] hover:underline">Sports</Link>
        <span>&rsaquo;</span>
        <span className="text-[#e6edf3]">{data.title}</span>
      </div>

      {/* Title */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white">{data.title}</h1>
        <div className="flex items-center gap-3 text-[11px] text-[#484f58]">
          <span>{totalMarketCount} markets</span>
          {totalVolume > 0 && <span>{formatVol(totalVolume)} Vol.</span>}
          <a
            href={`${POLYMARKET_BASE_URL}/event/${data.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#58a6ff] hover:underline"
          >
            Polymarket &rsaquo;
          </a>
        </div>
      </div>

      {/* Scoreboard */}
      <Scoreboard espn={data.espn} title={data.title} gameTime={data.gameStartTime} />

      {/* Markets */}
      <div className="mt-6 space-y-4">
        <MarketSection
          title="Moneyline"
          markets={data.markets.moneyline}
          volume={data.markets.moneyline.reduce((s, m) => s + m.volume, 0)}
          eventTitle={data.title}
          eventSlug={data.slug}
          eventEndDate={data.gameStartTime}
        />
        <MarketSection
          title="Spread"
          markets={data.markets.spreads.slice(0, 3)}
          volume={data.markets.spreads.reduce((s, m) => s + m.volume, 0)}
          eventTitle={data.title}
          eventSlug={data.slug}
          eventEndDate={data.gameStartTime}
        />
        <MarketSection
          title="Total (Over/Under)"
          markets={data.markets.totals.slice(0, 3)}
          volume={data.markets.totals.reduce((s, m) => s + m.volume, 0)}
          eventTitle={data.title}
          eventSlug={data.slug}
          eventEndDate={data.gameStartTime}
        />
        {data.markets.props.length > 0 && (
          <MarketSection
            title="Player Props"
            markets={data.markets.props}
            volume={data.markets.props.reduce((s, m) => s + m.volume, 0)}
            eventTitle={data.title}
            eventSlug={data.slug}
            eventEndDate={data.gameStartTime}
          />
        )}
      </div>
    </>
  );
}

/* ─── Page Wrapper (Suspense for useSearchParams) ─── */
export default function GamePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Suspense fallback={<p className="text-sm text-[#484f58] text-center py-16">Loading...</p>}>
        <GameContent />
      </Suspense>
    </div>
  );
}
