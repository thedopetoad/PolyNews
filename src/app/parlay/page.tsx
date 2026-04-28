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
import { Search, X, GripVertical, Plus, Sparkles, AlertTriangle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type MarketWithPrices, formatVolume } from "@/types/polymarket";

// --------------------------------------------------------------------------
// Tunables (will move to settings table when backend ships)
// --------------------------------------------------------------------------

const HOUSE_EDGE = 0.12;            // 12%
const MAX_PAYOUT_PER_SLIP = 500;    // AIRDROP / USDC — hardcoded for prototype
const MIN_LEGS = 2;
const MAX_LEGS = 8;

// --------------------------------------------------------------------------
// Counting multiplier — value interpolation, rendered as plain text.
//
// Previous attempts used per-digit overflow-hidden rollers (baseline
// alignment problems) and a complex two-state staggered hook (the rAF
// callback was getting cancelled before it could fire even once,
// likely due to React 19 + StrictMode + Next dev all fighting).
//
// This version:
//   • One interpolated value, single useState
//   • setInterval (~16ms = 60fps) instead of rAF — survives StrictMode
//     mount/cleanup churn way better; each interval iteration just
//     reads the closure values and updates state until elapsed >= duration
//   • Plain text rendering with tabular-nums + text-align:right so the
//     digits stay aligned regardless of width changes
//
// Sequencing the integer-then-decimal phases is done in render, by
// formatting the value differently based on elapsed time. Simpler than
// trying to coordinate two animation loops.
// --------------------------------------------------------------------------

const COUNT_DURATION_MS = 900;

function useCountTo(target: number, duration = COUNT_DURATION_MS): number {
  const [value, setValue] = useState(0);
  // Track the latest emitted value via ref so the next animation can
  // continue from where the previous one left off (whether it completed
  // or got interrupted by a fast follow-up target change).
  const valueRef = useRef(0);
  valueRef.current = value;

  useEffect(() => {
    const safe = Number.isFinite(target) && target > 0 ? target : 0;
    const from = valueRef.current;
    const t0 = performance.now();
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - t0;
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const next = from + (safe - from) * eased;
      setValue(next);
      if (p >= 1) {
        clearInterval(handle);
        setValue(safe); // snap to exact target
      }
    };

    // setInterval instead of rAF: rAF was getting cancelled by
    // StrictMode/Next-dev before its callback could even fire once.
    // 16ms ≈ 60fps which is plenty smooth for a single counting number.
    const handle = setInterval(tick, 16);
    tick(); // also fire one immediate tick so we don't wait 16ms for the first frame

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [target, duration]);

  return value;
}

/**
 * Compact display for runaway lottery multipliers. Folds anything ≥10K
 * into K/M/B so the chip stays readable. The animation operates on the
 * raw `target` value; once we cross the 10K threshold the displayed
 * format flips to the suffix variant.
 */
function compactSuffix(v: number): { divisor: number; suffix: string } {
  if (v >= 1_000_000_000) return { divisor: 1_000_000_000, suffix: "B" };
  if (v >= 1_000_000) return { divisor: 1_000_000, suffix: "M" };
  if (v >= 10_000) return { divisor: 1_000, suffix: "K" };
  return { divisor: 1, suffix: "" };
}

function CountingMultiplier({ value, dirty }: { value: number; dirty: boolean }) {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  const { divisor, suffix } = compactSuffix(safe);
  const scaledTarget = safe / divisor;
  const animated = useCountTo(scaledTarget);
  // K/M/B uses 1 decimal place; raw uses 2.
  const display = suffix ? animated.toFixed(1) : animated.toFixed(2);
  const [intPart, decPart = ""] = display.split(".");

  return (
    <div className="text-center select-none relative">
      <p className="text-[10px] text-[#484f58] uppercase tracking-[0.25em] mb-3">
        Multiplier
      </p>
      <div
        className={cn(
          "inline-block relative",
          dirty && "animate-[parlay-pop_700ms_cubic-bezier(0.34,1.56,0.64,1)]",
        )}
        style={{
          color: "#f7b955",
          // Tight glow — digits stay readable, no bloom merge.
          filter: dirty
            ? "drop-shadow(0 0 14px rgba(247, 185, 85, 0.65)) drop-shadow(0 0 3px rgba(247, 185, 85, 0.85))"
            : "drop-shadow(0 0 4px rgba(210, 153, 34, 0.3))",
          transition: "filter 700ms cubic-bezier(0.34, 1.4, 0.64, 1)",
        }}
      >
        {/* Each piece is its own span inside an inline-flex aligned by
            BASELINE. With items-baseline, the period (its own span)
            shares the digit spans' baseline by definition — no font
            quirks, no inline-block baseline tricks. The decimal becomes
            slightly smaller / lighter so the integer reads as the
            primary number — also fixes the "period floating" look at
            heavy weights, since the eye now expects the decimal to be
            visually subordinate. */}
        <span
          className="inline-flex items-baseline tracking-tight"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <span className="text-7xl font-black">{intPart}</span>
          {decPart && (
            <>
              <span
                className="text-6xl font-black mx-0.5"
                aria-hidden="true"
                style={{ position: "relative", top: "-0.02em" }}
              >
                .
              </span>
              <span className="text-6xl font-bold opacity-85">{decPart}</span>
            </>
          )}
          {suffix && (
            <span className="text-6xl font-black ml-1.5">{suffix}</span>
          )}
          <span
            className="text-4xl font-bold ml-2 opacity-50"
            style={{ position: "relative", top: "-0.5em" }}
          >
            ×
          </span>
        </span>
      </div>

      {/* Sparkle burst — 6 particles radiating outward in a star pattern */}
      {dirty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {[0, 60, 120, 180, 240, 300].map((rot, i) => (
            <span
              key={`${rot}-${i}`}
              className="absolute w-1.5 h-1.5 rounded-full bg-[#f7b955]"
              style={{
                animation: `parlay-spark-${rot} 900ms cubic-bezier(0.34, 1.4, 0.64, 1) forwards`,
                animationDelay: `${i * 35}ms`,
                boxShadow: "0 0 12px rgba(247, 185, 85, 0.9)",
              }}
            />
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes parlay-pop {
          0% { transform: scale(1); }
          25% { transform: scale(1.12); }
          55% { transform: scale(0.97); }
          80% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        ${[0, 60, 120, 180, 240, 300]
          .map(
            (rot) => `
          @keyframes parlay-spark-${rot} {
            0%   { transform: rotate(${rot}deg) translateX(0)     scale(0); opacity: 0; }
            20%  { transform: rotate(${rot}deg) translateX(40px)  scale(1); opacity: 1; }
            100% { transform: rotate(${rot}deg) translateX(110px) scale(0); opacity: 0; }
          }
        `,
          )
          .join("\n")}
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
    <aside className="relative bg-[#161b22] rounded-2xl ring-1 ring-white/[0.06] overflow-hidden flex flex-col h-full">
      {/* Top edge highlight — the subtle "lit from above" feel */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

      <div className="px-4 py-3.5 border-b border-white/[0.05]">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold text-[#adbac7] uppercase tracking-[0.16em]">
            Polymarket
          </h2>
          {data && (
            <span className="text-[10px] text-[#484f58] tabular-nums">
              {hits.length} markets
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58] pointer-events-none z-10" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all open markets…"
            className="h-9 rounded-xl bg-[#0d1117] border-white/[0.08] pl-9 pr-8 text-xs text-white placeholder:text-[#484f58] focus-visible:border-[#d29922]/50 focus-visible:ring-[#d29922]/15"
          />
          {isFetching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
              <span className="w-1 h-1 rounded-full bg-[#d29922] animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-[#d29922] animate-pulse [animation-delay:120ms]" />
              <span className="w-1 h-1 rounded-full bg-[#d29922] animate-pulse [animation-delay:240ms]" />
            </div>
          )}
        </div>
        <p className="text-[9px] text-[#484f58] mt-2 flex items-center gap-1">
          Drag onto the slip — or click
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-md bg-[#21262d] text-[#768390]">
            <Plus className="w-2 h-2" strokeWidth={3} />
          </span>
        </p>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <p className="text-xs text-[#484f58] text-center py-8">Loading markets…</p>
        ) : error ? (
          <p className="text-xs text-[#f85149] text-center py-8">Search failed</p>
        ) : hits.length === 0 ? (
          <p className="text-xs text-[#484f58] text-center py-8">
            {showingFor
              ? <>No markets match &ldquo;{showingFor}&rdquo;</>
              : "No markets returned"}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {hits.map((h) => {
              const taken = selectedIds.has(h.id);
              const market = hitToMarket(h);
              return (
                <li
                  key={h.id}
                  draggable={!taken}
                  onDragStart={(e) => !taken && handleDragStart(e, market)}
                  className={cn(
                    "group flex items-start gap-2.5 px-4 py-2.5 transition-all duration-150",
                    taken
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-grab active:cursor-grabbing hover:bg-white/[0.02] hover:translate-x-0.5",
                  )}
                >
                  <GripVertical className="w-3 h-3 text-[#30363d] mt-1 flex-shrink-0 group-hover:text-[#768390] transition-colors" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] text-[#e6edf3] line-clamp-2 leading-snug font-medium">
                      {h.question}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                      <span className="text-[#3fb950] tabular-nums font-medium">
                        Y {(h.yesPrice * 100).toFixed(0)}%
                      </span>
                      <span className="text-[#f85149] tabular-nums font-medium">
                        N {(h.noPrice * 100).toFixed(0)}%
                      </span>
                      <span className="text-[#484f58] ml-auto tabular-nums">
                        {formatVolume(h.volume)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => !taken && onAdd(market)}
                    disabled={taken}
                    className={cn(
                      "flex-shrink-0 mt-0.5 transition-all",
                      !taken && "hover:bg-[#d29922]/15 hover:text-[#d29922] hover:scale-110",
                    )}
                    title={taken ? "Already in parlay" : "Add to parlay"}
                  >
                    {taken ? <span className="text-[#3fb950]">✓</span> : <Plus />}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
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
  const accent = leg.outcome === "Yes" ? "#3fb950" : "#f85149";
  return (
    <div
      className={cn(
        "relative bg-[#0d1117] rounded-xl ring-1 ring-white/[0.06] p-3 flex items-start gap-2.5 transition-all hover:ring-white/[0.1] group",
        isNew && "animate-[leg-in_500ms_cubic-bezier(0.34,1.56,0.64,1)]",
      )}
      style={{ boxShadow: `inset 3px 0 0 0 ${accent}40` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-[#e6edf3] leading-snug line-clamp-2 font-medium">
          {leg.market.question}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onToggleOutcome}
            className={cn(
              "inline-flex items-center justify-center text-[10px] font-bold px-2.5 py-1 rounded-full transition-all hover:scale-105 active:scale-95",
              leg.outcome === "Yes"
                ? "bg-[#3fb950]/15 text-[#3fb950] ring-1 ring-[#3fb950]/30 hover:bg-[#3fb950]/25"
                : "bg-[#f85149]/15 text-[#f85149] ring-1 ring-[#f85149]/30 hover:bg-[#f85149]/25",
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
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="flex-shrink-0 opacity-50 group-hover:opacity-100 hover:bg-[#f85149]/10 hover:text-[#f85149] transition-all"
        title="Remove"
      >
        <X />
      </Button>
      <style jsx>{`
        @keyframes leg-in {
          0% { transform: translateX(28px) scale(0.92); opacity: 0; }
          55% { transform: translateX(-3px) scale(1.02); opacity: 1; }
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
  const [dirty, setDirty] = useState(false);

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

  // Whenever legs change, fire the gold-glow pulse for ~900ms then
  // settle back to the calm state. pulseKey just helps gate the very
  // first render (no glow on initial mount).
  useEffect(() => {
    setPulseKey((k) => k + 1);
    if (legs.length === 0) {
      setDirty(false);
      return;
    }
    setDirty(true);
    const t = setTimeout(() => setDirty(false), 900);
    return () => clearTimeout(t);
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
        "relative bg-[#161b22] rounded-2xl ring-1 p-6 flex flex-col h-full transition-all duration-300",
        dragOver
          ? "ring-[#d29922]/60 bg-gradient-to-b from-[#d29922]/[0.05] via-[#161b22] to-[#161b22] shadow-[0_0_60px_rgba(210,153,34,0.18)]"
          : "ring-white/[0.06]",
      )}
    >
      {/* Top edge highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d29922]/30 to-transparent pointer-events-none" />

      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#d29922]" />
          Your Parlay
        </h2>
        <Badge
          variant="ghost"
          className={cn(
            "text-[10px] tabular-nums transition-colors",
            legs.length === 0 ? "text-[#484f58]" : "text-[#adbac7]",
          )}
        >
          {legs.length} / {MAX_LEGS} legs
        </Badge>
      </div>

      {/* Multiplier — the focal point */}
      <div className="my-6 py-4">
        <CountingMultiplier value={multiplier} dirty={dirty && pulseKey > 1} />
        <div className="flex items-center justify-center gap-3 mt-4">
          <Badge variant="ghost" className="text-[10px] tabular-nums text-[#768390] hover:bg-transparent">
            <span className="text-[#484f58] mr-1">prob</span>
            {legs.length === 0 ? "—" : `${(jointProb * 100).toFixed(2)}%`}
          </Badge>
          <Separator orientation="vertical" className="h-3 bg-[#21262d]" />
          <Badge variant="ghost" className="text-[10px] tabular-nums text-[#768390] hover:bg-transparent">
            <span className="text-[#484f58] mr-1">edge</span>
            {(HOUSE_EDGE * 100).toFixed(0)}%
          </Badge>
        </div>
      </div>

      {/* Drop zone / legs list */}
      <div className="flex-1 min-h-0 -mx-1">
        {legs.length === 0 ? (
          <div
            className={cn(
              "relative h-full min-h-[200px] rounded-xl flex flex-col items-center justify-center gap-3 transition-all duration-300 mx-1",
              dragOver
                ? "bg-[#d29922]/[0.06] text-[#f7b955]"
                : "text-[#484f58]",
            )}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect width='100%25' height='100%25' fill='none' stroke='" +
                (dragOver ? "%23d29922" : "%2330363d") +
                "' stroke-width='2' stroke-dasharray='8 6' stroke-dashoffset='0' rx='12' ry='12'/%3E%3C/svg%3E\")",
            }}
          >
            <Sparkles
              className={cn(
                "w-8 h-8 transition-transform",
                dragOver && "scale-125 animate-pulse",
              )}
            />
            <p className="text-sm font-semibold">
              {dragOver ? "Drop to add leg" : "Drag markets here"}
            </p>
            <p className="text-[10px] text-[#484f58]">
              Minimum {MIN_LEGS} legs · multiplier compounds
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full px-1">
            <div className="space-y-2 pr-1">
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
          </ScrollArea>
        )}
      </div>

      {/* Stake + payout summary */}
      <div className="mt-5 pt-5 border-t border-white/[0.05] space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-[#768390] flex-shrink-0 w-12">Stake</label>
          <Input
            type="number"
            min={1}
            value={stake}
            onChange={(e) => onStakeChange(Math.max(0, Number(e.target.value) || 0))}
            className="h-9 rounded-xl bg-[#0d1117] border-white/[0.08] text-sm text-white tabular-nums focus-visible:border-[#d29922]/50 focus-visible:ring-[#d29922]/15"
          />
          <span className="text-[10px] text-[#484f58] uppercase tracking-wider w-14">
            AIRDROP
          </span>
        </div>

        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-[#768390] uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Max win
          </span>
          <span
            className={cn(
              "text-base font-bold tabular-nums transition-colors",
              capped
                ? "text-[#f85149]"
                : legs.length === 0
                ? "text-[#484f58]"
                : "text-[#3fb950]",
            )}
          >
            {legs.length === 0
              ? "—"
              : `${maxWin.toLocaleString(undefined, { maximumFractionDigits: 0 })} AIRDROP`}
          </span>
        </div>

        {capped && (
          <div className="flex items-start gap-2 text-[10px] text-[#f85149] bg-[#f85149]/[0.06] ring-1 ring-[#f85149]/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="leading-snug">
              Max win exceeds the {MAX_PAYOUT_PER_SLIP} AIRDROP cap. Reduce stake
              or remove a leg — we don&apos;t silently cap.
            </span>
          </div>
        )}

        <Button
          disabled={tooFew || tooMany || capped || stake <= 0}
          className={cn(
            "w-full h-11 rounded-xl text-sm font-bold transition-all",
            "bg-gradient-to-r from-[#d29922] via-[#f7b955] to-[#d29922] text-[#0d1117]",
            "hover:brightness-110 hover:shadow-[0_0_24px_rgba(247,185,85,0.35)]",
            "active:scale-[0.98]",
            "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none",
          )}
          title="Backend not wired up yet — UI prototype"
        >
          {tooFew
            ? `Add ${MIN_LEGS - legs.length} more leg${MIN_LEGS - legs.length === 1 ? "" : "s"}`
            : tooMany
            ? `Max ${MAX_LEGS} legs`
            : capped
            ? "Reduce stake to continue"
            : "Place Parlay (coming soon)"}
        </Button>
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
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] relative overflow-hidden">
      {/* Soft radial accent in the background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background:
            "radial-gradient(800px 400px at 50% -10%, rgba(210, 153, 34, 0.12), transparent 70%)",
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        <div className="mb-7">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-6 rounded-full bg-gradient-to-b from-[#d29922] to-[#f7b955]" />
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Custom Parlay Maker
            </h1>
            <Badge
              variant="outline"
              className="ml-1 text-[9px] uppercase tracking-wider border-[#d29922]/30 text-[#d29922]/80 bg-[#d29922]/[0.06]"
            >
              Beta
            </Badge>
          </div>
          <p className="text-sm text-[#768390] max-w-xl ml-3">
            Drag any Polymarket market into your slip. Odds compound across legs &mdash;
            all legs must hit to win.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_380px] gap-5 lg:h-[calc(100vh-200px)]">
          {/* Left: reserved placeholder */}
          <div className="hidden lg:flex relative bg-[#161b22] rounded-2xl ring-1 ring-white/[0.06] p-4 items-start justify-center overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
            <p className="text-[10px] text-[#484f58] uppercase tracking-[0.2em] mt-2">
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
