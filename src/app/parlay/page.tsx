"use client";

/**
 * Custom Parlay Maker — UI prototype.
 *
 * Layout (desktop):
 *   ┌─── 200px ────┬────────────────────┬──── 360px ─────┐
 *   │  (placeholder │   YOUR PARLAY      │  POLYMARKET    │
 *   │   left col)   │   ────── 12.4× ────│  SEARCH        │
 *   │               │   [drop legs here] │  [draggable    │
 *   │               │                    │   results]     │
 *   └───────────────┴────────────────────┴────────────────┘
 *
 * No backend is touched in this PR. The search hits the existing
 * /api/polymarket/markets route (already a Gamma keyset wrapper) and
 * filters client-side. Drag-and-drop is HTML5 native — each result has
 * draggable + a "+" button so it also works on touch devices.
 *
 * Calculations:
 *   joint_prob       = ∏ outcome_price_i
 *   raw_multiplier   = 1 / joint_prob
 *   offered_multipl  = raw_multiplier × (1 − house_edge)        [12% for now]
 *   max_win          = stake × offered_multiplier
 *
 * If max_win exceeds the payout cap we show a Jupiter-style warning
 * and disable the (placeholder) place button — never silently cap.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, X, GripVertical, Plus, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { type MarketWithPrices, formatVolume } from "@/types/polymarket";

// --------------------------------------------------------------------------
// Tunables (will move to settings table when backend ships)
// --------------------------------------------------------------------------

const HOUSE_EDGE = 0.12;            // 12%
const MAX_PAYOUT_PER_SLIP = 500;    // AIRDROP / USDC — hardcoded for prototype
const MIN_LEGS = 2;
const MAX_LEGS = 8;

// --------------------------------------------------------------------------
// Animated multiplier — rAF-driven number counter with ease-out
// --------------------------------------------------------------------------

function useAnimatedNumber(target: number, duration = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = fromRef.current + (target - fromRef.current) * eased;
      setValue(next);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}

function AnimatedMultiplier({ value, dirty }: { value: number; dirty: boolean }) {
  const animated = useAnimatedNumber(Number.isFinite(value) ? value : 0, 500);
  return (
    <div className="text-center select-none">
      <p className="text-[10px] text-[#484f58] uppercase tracking-[0.2em] mb-1">Multiplier</p>
      <div
        className={cn(
          "inline-block transition-transform duration-300",
          dirty && "animate-[parlay-pop_500ms_ease-out]",
        )}
        style={{
          background: "linear-gradient(135deg, #d29922 0%, #f7b955 50%, #d29922 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          textShadow: dirty ? "0 0 30px rgba(247, 185, 85, 0.5)" : "none",
          filter: dirty ? "drop-shadow(0 0 12px rgba(247, 185, 85, 0.6))" : "none",
          transition: "filter 600ms ease-out, text-shadow 600ms ease-out",
        }}
      >
        <span className="text-6xl font-black tabular-nums tracking-tight">
          {animated.toFixed(2)}
        </span>
        <span className="text-3xl font-bold ml-0.5">×</span>
      </div>
      <style jsx>{`
        @keyframes parlay-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.18); }
          70% { transform: scale(0.97); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// --------------------------------------------------------------------------
// Types — local to this page
// --------------------------------------------------------------------------

interface ParlayLeg {
  /** Stable id — Polymarket market id. Doubles as the dedupe key. */
  id: string;
  market: MarketWithPrices;
  /** Which side of the market the user picked. */
  outcome: "Yes" | "No";
  /** Price of the chosen outcome at add time. Frozen for this prototype. */
  priceAtAdd: number;
}

// --------------------------------------------------------------------------
// Search panel (right column)
// --------------------------------------------------------------------------

interface SearchHit {
  id: string;
  question: string;
  slug: string;
  eventSlug: string;
  clobTokenIds: string;
  endDate: string;
  volume: string;
  yesPrice: number;
  noPrice: number;
}

function MarketSearch({
  onAdd,
  selectedIds,
}: {
  onAdd: (m: MarketWithPrices) => void;
  selectedIds: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // 250ms debounce on the input so we don't hammer the DB on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Server-side ILIKE against markets_catalog (~5000 active markets).
  // keepPreviousData prevents the list from flashing empty between
  // keystrokes while the new request is in flight.
  const { data, isFetching, error } = useQuery({
    queryKey: ["parlay-market-search", debouncedQuery],
    queryFn: async () => {
      const url = `/api/polymarket/search?q=${encodeURIComponent(debouncedQuery)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { q: string; count: number; hits: SearchHit[] };
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const hits = useMemo(
    () =>
      (data?.hits ?? [])
        // Only filter truly resolved markets (price exactly 0 or 1).
        // Long-shot markets (0.1%, 99%, etc.) stay visible — the
        // user might want them, and the payout cap protects us.
        .filter((m) => m.yesPrice > 0 && m.yesPrice < 1)
        .filter((m) => m.question),
    [data],
  );

  // Convert a search hit into the MarketWithPrices shape the parlay
  // card consumes. Most fields are unused by the card; we just need
  // id, question, clobTokenIds, yes/no price, and volume.
  const hitToMarket = (h: SearchHit): MarketWithPrices => ({
    id: h.id,
    question: h.question,
    slug: h.slug,
    eventSlug: h.eventSlug,
    clobTokenIds: h.clobTokenIds,
    endDate: h.endDate,
    volume: h.volume,
    yesPrice: h.yesPrice,
    noPrice: h.noPrice,
    parsedOutcomes: ["Yes", "No"],
    outcomes: '["Yes","No"]',
    outcomePrices: JSON.stringify([h.yesPrice, h.noPrice]),
    volume24hr: "0",
    liquidity: "0",
    conditionId: "",
    active: true,
    closed: false,
    marketMakerAddress: "",
    image: "",
    icon: "",
    description: "",
    groupItemTitle: "",
    enableOrderBook: true,
  });

  const handleDragStart = (e: React.DragEvent, market: MarketWithPrices) => {
    e.dataTransfer.setData("application/x-parlay-market", JSON.stringify(market));
    e.dataTransfer.effectAllowed = "copy";
  };

  const isLoading = isFetching && !data;
  const showingFor = data?.q ?? "";

  return (
    <aside className="bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-[#21262d]">
        <h2 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">
          Polymarket Search
        </h2>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all open Polymarket markets…"
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-7 py-1.5 text-xs text-white placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff]"
          />
          {isFetching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#58a6ff] animate-pulse" />
          )}
        </div>
        <p className="text-[9px] text-[#484f58] mt-1.5">
          Drag markets onto the parlay card &mdash; or click <Plus className="inline w-2.5 h-2.5" />
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-xs text-[#484f58] text-center py-6">Loading markets…</p>
        ) : error ? (
          <p className="text-xs text-[#f85149] text-center py-6">Search failed</p>
        ) : hits.length === 0 ? (
          <p className="text-xs text-[#484f58] text-center py-6">
            {showingFor
              ? <>No markets match &ldquo;{showingFor}&rdquo;</>
              : "No markets returned"}
          </p>
        ) : (
          <ul className="divide-y divide-[#21262d]">
            {hits.map((h) => {
              const taken = selectedIds.has(h.id);
              const market = hitToMarket(h);
              return (
                <li
                  key={h.id}
                  draggable={!taken}
                  onDragStart={(e) => !taken && handleDragStart(e, market)}
                  className={cn(
                    "group flex items-start gap-2 px-3 py-2 transition-colors",
                    taken
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-grab active:cursor-grabbing hover:bg-[#1c2128]",
                  )}
                >
                  <GripVertical className="w-3 h-3 text-[#484f58] mt-0.5 flex-shrink-0 group-hover:text-[#768390] transition-colors" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-[#e6edf3] line-clamp-2 leading-snug">
                      {h.question}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      <span className="text-[#3fb950] tabular-nums">
                        Y {(h.yesPrice * 100).toFixed(0)}%
                      </span>
                      <span className="text-[#f85149] tabular-nums">
                        N {(h.noPrice * 100).toFixed(0)}%
                      </span>
                      <span className="text-[#484f58] ml-auto">
                        {formatVolume(h.volume)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => !taken && onAdd(market)}
                    disabled={taken}
                    className={cn(
                      "flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center transition-colors",
                      taken
                        ? "bg-[#21262d] text-[#484f58]"
                        : "bg-[#21262d] text-[#768390] hover:bg-[#d29922]/20 hover:text-[#d29922]",
                    )}
                    title={taken ? "Already in parlay" : "Add to parlay"}
                  >
                    {taken ? (
                      <span className="text-[10px]">✓</span>
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// --------------------------------------------------------------------------
// Parlay card (middle column)
// --------------------------------------------------------------------------

function LegRow({
  leg,
  onToggleOutcome,
  onRemove,
  isNew,
}: {
  leg: ParlayLeg;
  onToggleOutcome: () => void;
  onRemove: () => void;
  isNew: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-[#0d1117] border border-[#21262d] rounded-md p-2.5 flex items-start gap-2 transition-all",
        isNew && "animate-[leg-in_400ms_cubic-bezier(0.34,1.56,0.64,1)]",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-[#e6edf3] leading-snug line-clamp-2">
          {leg.market.question}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={onToggleOutcome}
            className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded border transition-all hover:scale-105",
              leg.outcome === "Yes"
                ? "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/30"
                : "bg-[#f85149]/15 text-[#f85149] border-[#f85149]/30",
            )}
            title="Click to flip side"
          >
            {leg.outcome.toUpperCase()}
          </button>
          <span className="text-[10px] text-[#768390] tabular-nums">
            @ {(leg.priceAtAdd * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="flex-shrink-0 w-5 h-5 rounded text-[#484f58] hover:text-[#f85149] hover:bg-[#f85149]/10 flex items-center justify-center transition-colors"
        title="Remove"
      >
        <X className="w-3 h-3" />
      </button>
      <style jsx>{`
        @keyframes leg-in {
          0% { transform: translateX(20px) scale(0.9); opacity: 0; }
          60% { transform: translateX(-2px) scale(1.02); opacity: 1; }
          100% { transform: translateX(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function ParlayCard({
  legs,
  newestLegId,
  onAdd,
  onRemove,
  onToggleOutcome,
  stake,
  onStakeChange,
}: {
  legs: ParlayLeg[];
  newestLegId: string | null;
  onAdd: (m: MarketWithPrices) => void;
  onRemove: (id: string) => void;
  onToggleOutcome: (id: string) => void;
  stake: number;
  onStakeChange: (s: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);

  // Recompute pricing whenever legs change.
  const { jointProb, multiplier, maxWin, capped } = useMemo(() => {
    if (legs.length === 0) {
      return { jointProb: 1, multiplier: 0, maxWin: 0, capped: false };
    }
    const p = legs.reduce(
      (acc, l) => acc * (l.outcome === "Yes" ? l.priceAtAdd : 1 - l.priceAtAdd),
      1,
    );
    const raw = p > 0 ? 1 / p : 0;
    const offered = raw * (1 - HOUSE_EDGE);
    const win = stake * offered;
    return {
      jointProb: p,
      multiplier: offered,
      maxWin: win,
      capped: win > MAX_PAYOUT_PER_SLIP,
    };
  }, [legs, stake]);

  // Bump pulseKey whenever legs change → triggers the gold-glow pulse.
  useEffect(() => {
    setPulseKey((k) => k + 1);
  }, [legs.length]);

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-parlay-market")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData("application/x-parlay-market");
    if (!raw) return;
    try {
      const market = JSON.parse(raw) as MarketWithPrices;
      onAdd(market);
    } catch {
      // ignore malformed payload
    }
  };

  const tooFew = legs.length < MIN_LEGS;
  const tooMany = legs.length >= MAX_LEGS;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative bg-[#161b22] border rounded-lg p-5 flex flex-col h-full transition-all duration-200",
        dragOver
          ? "border-[#d29922]/70 bg-[#d29922]/[0.04] shadow-[0_0_40px_rgba(210,153,34,0.15)]"
          : "border-[#21262d]",
      )}
    >
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#d29922]" />
          Your Parlay
        </h2>
        <span className="text-[10px] text-[#484f58] tabular-nums">
          {legs.length} / {MAX_LEGS} legs
        </span>
      </div>

      {/* Multiplier */}
      <div className="my-4">
        <AnimatedMultiplier
          key={pulseKey}
          value={multiplier}
          dirty={pulseKey > 1 && legs.length > 0}
        />
        <div className="flex justify-center gap-4 mt-2 text-[10px] text-[#768390]">
          <span>
            Joint prob:{" "}
            <span className="text-[#adbac7] tabular-nums">
              {legs.length === 0 ? "—" : `${(jointProb * 100).toFixed(2)}%`}
            </span>
          </span>
          <span>
            House edge:{" "}
            <span className="text-[#adbac7] tabular-nums">{(HOUSE_EDGE * 100).toFixed(0)}%</span>
          </span>
        </div>
      </div>

      {/* Drop zone / legs list */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {legs.length === 0 ? (
          <div
            className={cn(
              "h-full min-h-[180px] border-2 border-dashed rounded-md flex flex-col items-center justify-center gap-2 transition-colors",
              dragOver
                ? "border-[#d29922]/60 text-[#d29922]"
                : "border-[#30363d] text-[#484f58]",
            )}
          >
            <Sparkles className="w-6 h-6" />
            <p className="text-xs font-medium">
              {dragOver ? "Drop to add leg" : "Drag markets here to build your parlay"}
            </p>
            <p className="text-[10px]">Minimum {MIN_LEGS} legs</p>
          </div>
        ) : (
          <div className="space-y-2">
            {legs.map((leg) => (
              <LegRow
                key={leg.id}
                leg={leg}
                onToggleOutcome={() => onToggleOutcome(leg.id)}
                onRemove={() => onRemove(leg.id)}
                isNew={leg.id === newestLegId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stake + payout summary */}
      <div className="mt-4 pt-4 border-t border-[#21262d] space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-[#768390] flex-shrink-0">Stake</label>
          <input
            type="number"
            min={1}
            value={stake}
            onChange={(e) => onStakeChange(Math.max(0, Number(e.target.value) || 0))}
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-white tabular-nums focus:outline-none focus:border-[#d29922]"
          />
          <span className="text-[10px] text-[#484f58]">AIRDROP</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#768390]">Max win</span>
          <span
            className={cn(
              "font-bold tabular-nums",
              capped ? "text-[#f85149]" : "text-[#3fb950]",
            )}
          >
            {legs.length === 0
              ? "—"
              : `${maxWin.toLocaleString(undefined, { maximumFractionDigits: 0 })} AIRDROP`}
          </span>
        </div>

        {capped && (
          <div className="flex items-start gap-1.5 text-[10px] text-[#f85149] bg-[#f85149]/5 border border-[#f85149]/20 rounded px-2 py-1.5">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>
              Max win exceeds the {MAX_PAYOUT_PER_SLIP} cap. Reduce stake or remove a leg —
              we won&apos;t accept slips that could exceed our payout cap (transparent
              limit; no silent capping).
            </span>
          </div>
        )}

        <button
          disabled={tooFew || tooMany || capped || stake <= 0}
          className="w-full mt-1 px-3 py-2 rounded-md text-xs font-bold bg-gradient-to-r from-[#d29922] to-[#f7b955] text-[#0d1117] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          title="Backend not wired up yet — UI prototype"
        >
          {tooFew
            ? `Add ${MIN_LEGS - legs.length} more leg${MIN_LEGS - legs.length === 1 ? "" : "s"}`
            : tooMany
            ? `Max ${MAX_LEGS} legs`
            : capped
            ? "Reduce stake to continue"
            : "Place Parlay (coming soon)"}
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page
// --------------------------------------------------------------------------

export default function ParlayPage() {
  const [legs, setLegs] = useState<ParlayLeg[]>([]);
  const [newestLegId, setNewestLegId] = useState<string | null>(null);
  const [stake, setStake] = useState(10);

  const selectedIds = useMemo(() => new Set(legs.map((l) => l.id)), [legs]);

  const addLeg = (market: MarketWithPrices) => {
    if (selectedIds.has(market.id)) return; // dedupe
    if (legs.length >= MAX_LEGS) return;
    const leg: ParlayLeg = {
      id: market.id,
      market,
      outcome: "Yes",
      priceAtAdd: market.yesPrice,
    };
    setLegs((prev) => [...prev, leg]);
    setNewestLegId(market.id);
    // Clear "new" tag after the entry animation finishes.
    setTimeout(() => setNewestLegId((id) => (id === market.id ? null : id)), 600);
  };

  const removeLeg = (id: string) => setLegs((prev) => prev.filter((l) => l.id !== id));

  const toggleOutcome = (id: string) =>
    setLegs((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              outcome: l.outcome === "Yes" ? "No" : "Yes",
              // Binary market: flipping side means new chosen-outcome
              // price is the complement of the previous chosen price.
              priceAtAdd: 1 - l.priceAtAdd,
            }
          : l,
      ),
    );

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#d29922]" />
            Custom Parlay Maker
          </h1>
          <p className="text-xs text-[#768390] mt-1">
            Drag any Polymarket market into your slip. Multiplier compounds across all
            legs &mdash; all legs must hit to win.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_360px] gap-4 lg:h-[calc(100vh-180px)]">
          {/* Left: placeholder */}
          <div className="hidden lg:flex bg-[#161b22] border border-[#21262d] rounded-lg p-4 items-start justify-center">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider mt-2">
              Reserved
            </p>
          </div>

          {/* Middle: parlay card */}
          <ParlayCard
            legs={legs}
            newestLegId={newestLegId}
            onAdd={addLeg}
            onRemove={removeLeg}
            onToggleOutcome={toggleOutcome}
            stake={stake}
            onStakeChange={setStake}
          />

          {/* Right: market search */}
          <MarketSearch onAdd={addLeg} selectedIds={selectedIds} />
        </div>
      </div>
    </div>
  );
}
