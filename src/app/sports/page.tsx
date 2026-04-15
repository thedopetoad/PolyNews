"use client";

import { useState, useMemo, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { LoginButton } from "@/components/layout/login-modal";
import { BetSlip } from "@/components/sports/bet-slip";
import Link from "next/link";

/* ─── Color palette for multi-outcome charts ─── */
const CHART_COLORS = ["#4d8fea", "#8b949e", "#58a6ff", "#da3633", "#3fb950"];

interface ChartOutcome {
  name: string;
  tokenId: string;       // empty string = derive from first outcome (1 - p)
  color: string;
}

/* ─── Multi-Outcome Price Chart (SVG with hover, matching trade page style) ─── */
function SportsMultiChart({ outcomes }: { outcomes: ChartOutcome[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [seriesData, setSeriesData] = useState<{ t: number; p: number }[][]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ xPct: number; values: { name: string; price: number; yPct: number; color: string }[]; date: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchable = outcomes.map((o) => ({ tokenId: o.tokenId }));
    const firstFetch = fetchable.find((f) => f.tokenId !== "");
    if (!firstFetch) { setLoading(false); return; }

    const uniqueTokens = [...new Set(fetchable.filter((f) => f.tokenId !== "").map((f) => f.tokenId))];
    Promise.all(
      uniqueTokens.map((tid) =>
        fetch(`/api/polymarket/price-history?token_id=${tid}`)
          .then((r) => r.json())
          .then((d) => ({ tid, history: d.history || [] }))
          .catch(() => ({ tid, history: [] }))
      )
    ).then((results) => {
      if (cancelled) return;
      const historyMap: Record<string, { t: number; p: number }[]> = {};
      for (const r of results) historyMap[r.tid] = r.history;

      const series: { t: number; p: number }[][] = outcomes.map((o) => {
        if (o.tokenId && historyMap[o.tokenId]) return historyMap[o.tokenId];
        const base = historyMap[firstFetch.tokenId];
        if (base) return base.map((pt) => ({ t: pt.t, p: 1 - pt.p }));
        return [];
      });

      setSeriesData(series);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [outcomes]);

  const currentPcts = useMemo(() =>
    seriesData.map((s) => (s.length > 0 ? Math.round(s[s.length - 1].p * 100) : 0)),
    [seriesData]
  );

  if (loading) return <div className="h-[120px] flex items-center justify-center text-[10px] text-[#484f58]">Loading chart...</div>;
  if (seriesData.length === 0 || seriesData.every((s) => s.length < 2))
    return <div className="h-[120px] flex items-center justify-center text-[10px] text-[#484f58]">No history</div>;

  // Use the longest series as the reference for X axis
  const refSeries = seriesData.reduce((a, b) => (a.length >= b.length ? a : b), []);
  const W = 400, H = 120;
  const allPrices = seriesData.flatMap((s) => s.map((pt) => pt.p));
  const pMin = Math.min(...allPrices), pMax = Math.max(...allPrices);
  const pRange = pMax - pMin || 0.01;

  // Build SVG paths for each series
  const paths = seriesData.map((series) => {
    if (series.length < 2) return "";
    return series.map((pt, i) => {
      const x = (i / (series.length - 1)) * W;
      const y = H - 4 - ((pt.p - pMin) / pRange) * (H - 8);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const xPos = ratio * W;

    const values = seriesData.map((series, i) => {
      const idx = Math.round(ratio * (series.length - 1));
      const clamped = Math.max(0, Math.min(series.length - 1, idx));
      const price = series[clamped]?.p ?? 0;
      const yPct = ((price - pMin) / pRange) * 100; // 0% = bottom, 100% = top
      return { name: outcomes[i].name, price, yPct, color: outcomes[i].color };
    });

    const refIdx = Math.round(ratio * (refSeries.length - 1));
    const refPt = refSeries[Math.max(0, Math.min(refSeries.length - 1, refIdx))];
    const date = refPt ? new Date(refPt.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

    setHover({ xPct: ratio * 100, values, date });
  };

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
        {outcomes.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: o.color }} />
            <span className="text-[11px] text-[#adbac7]">{o.name}</span>
            <span className="text-[11px] font-semibold text-[#e6edf3]">{currentPcts[i]}%</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div
        className="relative h-[120px] cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* SVG — only the data lines */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
        >
          {paths.map((d, i) => d && (
            <path key={i} d={d} fill="none" stroke={outcomes[i].color} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.9} />
          ))}
        </svg>

        {/* HTML hover elements — not distorted */}
        {hover && (
          <>
            {/* Vertical crosshair line */}
            <div
              className="absolute top-0 bottom-0 w-px pointer-events-none"
              style={{ left: `${hover.xPct}%`, background: "repeating-linear-gradient(to bottom, #484f58 0px, #484f58 3px, transparent 3px, transparent 6px)" }}
            />

            {/* Dots on each line */}
            {hover.values.map((v, i) => (
              <div
                key={i}
                className="absolute w-[9px] h-[9px] rounded-full pointer-events-none border-2 border-[#0d1117]"
                style={{
                  left: `${hover.xPct}%`,
                  bottom: `${v.yPct}%`,
                  backgroundColor: v.color,
                  transform: "translate(-50%, 50%)",
                }}
              />
            ))}

            {/* Tooltip — positioned below chart */}
            <div
              className="absolute pointer-events-none bg-[#1c2128] border border-[#30363d] rounded px-2 py-1.5 text-[11px] whitespace-nowrap z-10"
              style={{
                left: `${hover.xPct}%`,
                bottom: -4,
                transform: `translateY(100%) ${hover.xPct > 75 ? "translateX(-100%)" : hover.xPct < 25 ? "" : "translateX(-50%)"}`,
              }}
            >
              {hover.values.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
                  <span className="font-semibold tabular-nums" style={{ color: v.color }}>{(v.price * 100).toFixed(1)}%</span>
                </div>
              ))}
              <div className="text-[#484f58] text-[10px] mt-0.5">{hover.date}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
  espnLive?: boolean;
  closed?: boolean;
  archived?: boolean;
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
    if (!total && (q.includes(": o/u") || (q.includes("o/u") && !q.includes(":")))) {
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
function TeamRow({ name, mlPrice, spreadLabel, spreadPrice, totalLabel, totalPrice, highlight, gameLink }: {
  name: string;
  mlPrice: number;
  spreadLabel?: string;
  spreadPrice?: number;
  totalLabel?: string;
  totalPrice?: number;
  highlight: boolean;
  gameLink: string;
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
      <Link
        href={gameLink}
        className={cn(
          "w-24 text-center py-1.5 rounded-md text-xs font-semibold tabular-nums transition-all",
          highlight
            ? "bg-[#238636]/20 text-[#3fb950] hover:bg-[#238636]/30 hover:shadow-[0_0_10px_rgba(63,185,80,0.25)]"
            : "bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
        )}
      >
        {tag} {pct}¢
      </Link>

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

/* ─── Live Radio Player ─── */
function LiveRadioPlayer({ teamA, teamB }: { teamA: string; teamB: string }) {
  const [station, setStation] = useState<{ name: string; url: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<"home" | "away">("home");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentTeam = selectedTeam === "home" ? teamA : teamB;

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  // Fetch station + preload audio when team changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPlaying(false);
    setBuffering(false);

    // Stop current audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    fetch(`/api/sports/radio?team=${encodeURIComponent(currentTeam)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.station) {
          setStation(data.station);
          // Preload: create audio element and start buffering in background
          const proxyUrl = `/api/sports/radio/stream?url=${encodeURIComponent(data.station.url)}`;
          const audio = new Audio();
          audio.preload = "auto";
          audio.src = proxyUrl;
          audio.volume = 0.5;
          audioRef.current = audio;

          audio.addEventListener("error", () => {
            setPlaying(false);
            setBuffering(false);
            console.error("Radio stream error:", audio.error?.message);
          });
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentTeam]);

  const toggleMute = () => {
    if (!station || !audioRef.current) return;
    const audio = audioRef.current;

    // Not playing yet — start playback (audio is preloaded)
    if (!playing) {
      setBuffering(true);

      // Listen for actual audio output
      const onPlaying = () => {
        setBuffering(false);
        setPlaying(true);
        setMuted(false);
        audio.removeEventListener("playing", onPlaying);
      };
      audio.addEventListener("playing", onPlaying);

      audio.play().catch((err) => {
        console.error("Radio play failed:", err);
        setPlaying(false);
        setBuffering(false);
        audio.removeEventListener("playing", onPlaying);
      });
      return;
    }

    // Already playing — toggle mute
    if (muted) {
      audio.muted = false;
      setMuted(false);
    } else {
      audio.muted = true;
      setMuted(true);
    }
  };

  return (
    <div className="flex items-center gap-2.5 bg-[#161b22] rounded-md px-3 py-2 border border-[#21262d]" onClick={(e) => e.stopPropagation()}>
      {/* Pulsing volume button */}
      <button
        onClick={toggleMute}
        disabled={buffering}
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
          buffering
            ? "bg-[#58a6ff]/20 text-[#58a6ff]"
            : playing && !muted
              ? "bg-[#f85149]/20 text-[#f85149] animate-pulse shadow-[0_0_12px_rgba(248,81,73,0.4)]"
              : "bg-[#21262d] text-[#484f58] hover:text-[#adbac7] hover:bg-[#30363d]"
        )}
      >
        {buffering ? (
          /* Spinner */
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : playing && !muted ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5.586V18.414a1 1 0 01-1.707.707L5.586 15z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5.586V18.414a1 1 0 01-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        )}
      </button>

      {/* Team toggle */}
      <div className="flex gap-1">
        <button
          className={cn("text-[10px] px-1.5 py-0.5 rounded transition-colors", selectedTeam === "home" ? "bg-[#21262d] text-[#e6edf3]" : "text-[#484f58] hover:text-[#adbac7]")}
          onClick={() => setSelectedTeam("home")}
        >
          {abbrev(teamA)}
        </button>
        <button
          className={cn("text-[10px] px-1.5 py-0.5 rounded transition-colors", selectedTeam === "away" ? "bg-[#21262d] text-[#e6edf3]" : "text-[#484f58] hover:text-[#adbac7]")}
          onClick={() => setSelectedTeam("away")}
        >
          {abbrev(teamB)}
        </button>
      </div>

      {/* Station name + status */}
      {loading ? (
        <span className="text-[10px] text-[#484f58]">Connecting...</span>
      ) : station ? (
        <span className="text-[10px] text-[#adbac7] truncate">{station.name}</span>
      ) : (
        <span className="text-[10px] text-[#484f58]">No station</span>
      )}

      {buffering && (
        <span className="text-[9px] text-[#58a6ff] font-medium ml-auto flex-shrink-0">Buffering...</span>
      )}
      {playing && !muted && !buffering && (
        <span className="text-[9px] text-[#f85149] font-medium ml-auto flex-shrink-0">LIVE</span>
      )}
    </div>
  );
}

/* ─── Game Card (Polymarket-style) ─── */
function GameCard({ event, index, sport, expanded, onToggle, onSelectBet }: { event: SportEvent; index: number; sport: string; expanded: boolean; onToggle: () => void; onSelectBet?: (bet: SelectedBet) => void }) {
  const [teamA, teamB] = parseTeams(event.title);
  const { moneyline, spread, total, totalMarkets } = extractKeyMarkets(event);
  const vol = formatVol(event.volume || event.markets.reduce((s, m) => s + m.volume, 0));
  const time = formatTime(event.gameStartTime);
  const isLive = event.espnLive === true;

  // Build multi-outcome chart data
  const chartOutcomes: ChartOutcome[] = useMemo(() => {
    if (event.negRisk) {
      // negRisk (soccer): each market is a separate outcome
      // Collect main outcome markets (skip spreads, totals, props)
      const mainMarkets = event.markets.filter((m) => {
        const q = m.question.toLowerCase();
        return !q.includes("spread") && !q.includes("o/u") && !q.includes("halftime") && !q.includes("exact") && !q.includes(":");
      }).slice(0, 4); // max 4 outcomes
      return mainMarkets.map((m, i) => ({
        name: m.groupItemTitle || m.outcomes[0] || `Outcome ${i + 1}`,
        tokenId: m.clobTokenIds[0] || "",
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
    }
    // Binary market: 2 teams from moneyline
    if (!moneyline?.clobTokenIds?.[0]) return [];
    return [
      { name: teamA || moneyline.outcomes[0] || "Team A", tokenId: moneyline.clobTokenIds[0], color: CHART_COLORS[0] },
      { name: teamB || moneyline.outcomes[1] || "Team B", tokenId: moneyline.clobTokenIds[1] || "", color: CHART_COLORS[1] },
    ];
  }, [event, moneyline, teamA, teamB]);

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
    const match = total.question.match(/O\/U\s+([\d.]+)/i);
    const val = match ? match[1] : "";
    totalOver = { label: `O ${val}`, price: total.prices[0] ?? 0.5 };
    totalUnder = { label: `U ${val}`, price: total.prices[1] ?? 0.5 };
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking a link or button (radio controls)
    if ((e.target as HTMLElement).closest("a, button, audio")) return;
    onToggle();
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-[#161b22] overflow-hidden animate-fade-in-up transition-all duration-200 cursor-pointer",
        isLive ? "border-[#f85149]/30 hover:shadow-[0_0_20px_rgba(248,81,73,0.1)]" : "border-[#21262d] hover:border-[#30363d] hover:shadow-[0_0_20px_rgba(88,166,255,0.08)]",
        expanded && "ring-1 ring-[#58a6ff]/20"
      )}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: "backwards" }}
      onClick={handleCardClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#21262d]">
        <div className="flex items-center gap-2">
          <svg className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0", expanded && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          {isLive && <span className="text-[10px] font-bold text-[#f85149] bg-[#f85149]/10 px-1.5 py-0.5 rounded animate-glow-red">LIVE</span>}
          <span className="text-[11px] text-[#484f58]">{time}</span>
          {vol && <span className="text-[11px] text-[#484f58]">{vol} Vol.</span>}
        </div>
        <Link
          href={`/sports/game?eventId=${event.id}&sport=${sport}`}
          className="text-[10px] text-[#58a6ff] hover:underline flex items-center gap-1"
        >
          <span className="text-[#484f58]">{totalMarkets}</span> Game View &rsaquo;
        </Link>
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
        gameLink={`/sports/game?eventId=${event.id}&sport=${sport}`}
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
        gameLink={`/sports/game?eventId=${event.id}&sport=${sport}`}
      />

      {/* Expanded Section — radio + chart + stats */}
      {expanded && (
        <div className="border-t border-[#21262d] bg-[#0d1117] px-4 py-3 space-y-3 animate-fade-in-up">
          {/* Live Radio */}
          {isLive && teamA && teamB && (
            <div>
              <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Live Radio</p>
              <LiveRadioPlayer teamA={teamA} teamB={teamB} />
            </div>
          )}

          {chartOutcomes.length > 0 && (
            <div>
              <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Price History</p>
              <SportsMultiChart outcomes={chartOutcomes} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-[#484f58]">Volume</p>
              <p className="text-[#e6edf3] font-medium">{vol || "—"}</p>
            </div>
            <div>
              <p className="text-[#484f58]">Markets</p>
              <p className="text-[#e6edf3] font-medium">{totalMarkets}</p>
            </div>
            <div>
              <p className="text-[#484f58]">Game Time</p>
              <p className="text-[#e6edf3] font-medium">{time}</p>
            </div>
          </div>
          {moneyline && onSelectBet && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectBet({
                  eventTitle: event.title,
                  eventSlug: event.slug,
                  eventEndDate: event.endDate,
                  marketId: moneyline.id,
                  marketQuestion: event.title,
                  outcomes: [
                    { name: teamA || moneyline.outcomes[0] || "Team A", price: moneyline.prices[0] ?? 0.5, tokenId: moneyline.clobTokenIds[0] || "" },
                    { name: teamB || moneyline.outcomes[1] || "Team B", price: moneyline.prices[1] ?? 0.5, tokenId: moneyline.clobTokenIds[1] || "" },
                  ],
                  negRisk: event.negRisk,
                });
              }}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors"
            >
              Bet on this game
            </button>
          )}

          <Link
            href={`/sports/game?eventId=${event.id}&sport=${sport}`}
            className="inline-flex items-center gap-1.5 text-xs text-[#58a6ff] hover:underline"
          >
            View all markets &rsaquo;
          </Link>
        </div>
      )}
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
  return (
    <Suspense fallback={<div className="text-center py-16 text-[#484f58]">Loading...</div>}>
      <SportsContent />
    </Suspense>
  );
}

interface SelectedBet {
  eventTitle: string;
  eventSlug: string;
  eventEndDate: string;
  marketId: string;
  marketQuestion: string;
  outcomes: { name: string; price: number; tokenId: string }[];
  negRisk?: boolean;
}

function SportsContent() {
  const searchParams = useSearchParams();
  const initialSport = searchParams.get("sport") || "mlb";
  const [selectedSport, setSelectedSport] = useState<string>(initialSport);
  const [view, setView] = useState<"live" | "upcoming">("upcoming");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedBet, setSelectedBet] = useState<SelectedBet | null>(null);

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
    // 30s interval matches the 15s server-side cache with headroom. Focus
    // refetch overrides the global off-by-default setting — we want this
    // page to re-sync when a user returns to the tab, especially mobile.
    staleTime: 20 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const leagues: League[] = leaguesData?.leagues || [];
  const events: SportEvent[] = eventsData?.events || [];

  // Fetch ALL leagues for live tab
  const { data: allLiveData, isLoading: allLiveLoading } = useQuery({
    queryKey: ["sports-all-live", leagues.map((l) => l.code).join(",")],
    queryFn: async () => {
      if (leagues.length === 0) return [];
      const results = await Promise.all(
        leagues.map(async (l) => {
          try {
            const res = await fetch(`/api/sports/events?sport=${l.code}`);
            if (!res.ok) return [];
            const data = await res.json();
            return ((data.events || []) as SportEvent[]).map((e) => ({ ...e, _sport: l.code, _league: l }));
          } catch { return []; }
        })
      );
      return results.flat();
    },
    enabled: view === "live" && leagues.length > 0,
    staleTime: 20 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Separate live and upcoming
  const now = Date.now();

  // All live events across all sports (for live tab) — uses ESPN status.
  // Also defensively drop anything Polymarket has flipped to closed/archived
  // even if it's still flagged live on ESPN, so a user never lands on a bet
  // slip for a market that's no longer accepting orders.
  const allLiveEvents = useMemo(() => {
    if (!allLiveData) return [];
    return (allLiveData as (SportEvent & { _sport: string; _league: League })[]).filter(
      (e) => e.espnLive === true && !e.closed && !e.archived,
    );
  }, [allLiveData]);

  // Live count for badge (from all sports)
  const totalLiveCount = allLiveEvents.length;

  // Group live events by sport
  const liveByLeague = useMemo(() => {
    const groups: { league: League; sport: string; events: SportEvent[] }[] = [];
    for (const e of allLiveEvents) {
      const ext = e as SportEvent & { _sport: string; _league: League };
      const existing = groups.find((g) => g.sport === ext._sport);
      if (existing) { existing.events.push(e); }
      else { groups.push({ league: ext._league, sport: ext._sport, events: [e] }); }
    }
    return groups;
  }, [allLiveEvents]);

  // Selected sport events. Drop anything Polymarket flipped to
  // closed/archived so we never show a market that's no longer betable.
  const liveEvents = events.filter((e) => e.espnLive === true && !e.closed && !e.archived);

  // Upcoming = games that haven't started yet, plus a 20-minute grace window
  // for games that JUST started but ESPN hasn't flagged as live yet (so they
  // don't vanish from both tabs entirely during the ESPN indexing lag).
  // Without this bound, any past game that wasn't ESPN-live would stay in
  // Upcoming forever — which is why African/LATAM testers saw yesterday's
  // games still listed on the next day.
  const UPCOMING_GRACE_MS = 20 * 60 * 1000;
  const upcomingEvents = events.filter((e) => {
    if (e.closed || e.archived) return false;
    const gs = new Date(e.gameStartTime).getTime();
    if (gs > now) return true;
    if (!e.espnLive && now - gs < UPCOMING_GRACE_MS) return true;
    return false;
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
      <div className={cn("flex gap-6", selectedBet && "lg:flex-row")}>
      {/* Main content */}
      <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Sports</h1>
          <p className="text-sm text-[#768390] mt-0.5">
            Real markets. Real odds. Powered by <a href="https://polymarket.com/sports" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">Polymarket</a>
          </p>
        </div>
        <div className="flex-shrink-0">
          <LoginButton />
        </div>
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
          Live {totalLiveCount > 0 && <span className="ml-1.5 text-[10px] bg-[#f85149] text-white px-1.5 py-0.5 rounded-full">{totalLiveCount}</span>}
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
        {/* Sidebar — League List (Polymarket style) */}
        <div className="hidden lg:block w-52 flex-shrink-0">
          {/* Gradient-bordered card — draws attention to the full league lineup */}
          <div className="relative rounded-xl p-[1px] bg-gradient-to-b from-[#58a6ff]/50 via-[#30363d]/60 to-[#30363d]/30 shadow-[0_0_32px_-10px_rgba(88,166,255,0.35)]">
            {/* Thin top highlight line for extra polish */}
            <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#58a6ff]/80 to-transparent pointer-events-none" />
            <div className="rounded-[11px] bg-gradient-to-b from-[#161b22] to-[#0d1117] p-3">
              {/* Header with live count badge */}
              <div className="flex items-center justify-between px-2 mb-3">
                <p className="text-[10px] text-[#8b949e] uppercase tracking-[0.18em] font-semibold">All Sports</p>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#58a6ff]/12 text-[#58a6ff] border border-[#58a6ff]/25 tabular-nums leading-none">
                  {leagues.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {leagues.map((league) => (
                  <button
                    key={league.code}
                    onClick={() => setSelectedSport(league.code)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-all text-left group",
                      selectedSport === league.code
                        ? "bg-[#1c2128] text-white font-medium border border-[#30363d] shadow-[inset_0_0_0_1px_rgba(88,166,255,0.15)]"
                        : "text-[#768390] hover:text-[#e6edf3] hover:bg-[#161b22]"
                    )}
                  >
                    {league.image ? (
                      <img src={league.image} alt={league.name} className="w-5 h-5 rounded-sm object-contain flex-shrink-0" />
                    ) : (
                      <span className="text-base w-5 text-center flex-shrink-0">{league.emoji}</span>
                    )}
                    <span className="truncate">{league.name}</span>
                  </button>
                ))}
              </div>
            </div>
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
                    ? "bg-[#1c2128] text-white border border-[#30363d]"
                    : "bg-[#161b22] text-[#768390] border border-[#21262d]"
                )}
              >
                {league.image ? (
                  <img src={league.image} alt={league.name} className="w-4 h-4 rounded-sm object-contain" />
                ) : (
                  <span>{league.emoji}</span>
                )}
                <span>{league.name}</span>
              </button>
            ))}
          </div>

          {/* League Header */}
          <div className="flex items-center gap-3 mb-4">
            {selectedLeague?.image ? (
              <img src={selectedLeague.image} alt={selectedLeague.name} className="w-7 h-7 rounded object-contain" />
            ) : (
              <span className="text-2xl">{selectedLeague?.emoji}</span>
            )}
            <h2 className="text-lg font-semibold text-white">{selectedLeague?.name || selectedSport.toUpperCase()}</h2>
          </div>

          {/* Games */}
          {view === "live" ? (
            allLiveLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <GameSkeleton key={i} />)}
              </div>
            ) : liveByLeague.length > 0 ? (
              <div className="space-y-6">
                {liveByLeague.map((group) => (
                  <div key={group.sport}>
                    <div className="flex items-center gap-2 mb-3">
                      {group.league.image ? (
                        <img src={group.league.image} alt={group.league.name} className="w-5 h-5 rounded-sm object-contain" />
                      ) : (
                        <span className="text-base">{group.league.emoji}</span>
                      )}
                      <p className="text-sm font-semibold text-[#e6edf3]">{group.league.name}</p>
                      <span className="text-[10px] text-[#484f58] bg-[#21262d] px-1.5 py-0.5 rounded">{group.events.length}</span>
                    </div>
                    <div className="space-y-3">
                      {group.events.map((e, i) => <GameCard key={e.id} event={e} index={i} sport={group.sport} expanded={expandedId === e.id} onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)} onSelectBet={setSelectedBet} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-16 text-center">
                <p className="text-[#484f58]">No live games right now</p>
                <button onClick={() => setView("upcoming")} className="text-sm text-[#58a6ff] hover:underline mt-2">View upcoming</button>
              </div>
            )
          ) : eventsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <GameSkeleton key={i} />)}
            </div>
          ) : grouped.length > 0 ? (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.date}>
                  <p className="text-sm font-semibold text-[#e6edf3] mb-3">{formatDateHeader(group.events[0].gameStartTime)}</p>
                  <div className="space-y-3">
                    {group.events.map((e, i) => <GameCard key={e.id} event={e} index={i} sport={selectedSport} expanded={expandedId === e.id} onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)} onSelectBet={setSelectedBet} />)}
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
      </div>{/* end flex-1 main content */}

      {/* Sidebar Bet Slip */}
      {selectedBet && (
        <div className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 rounded-xl border border-[#21262d] bg-[#161b22] p-4 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-white">{selectedBet.eventTitle}</p>
              <button onClick={() => setSelectedBet(null)} className="text-[#484f58] hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <BetSlip {...selectedBet} />
          </div>
        </div>
      )}
      </div>{/* end flex container */}
    </div>
  );
}
