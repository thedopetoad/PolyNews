"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { usePositionLivePrices } from "@/hooks/use-live-prices";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { MiniPriceChart } from "@/components/mini-price-chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// Types from the consensus read endpoints
// --------------------------------------------------------------------------

interface RunSummary {
  id: string;
  marketQuestion: string;
  marketSlug: string | null;
  eventSlug: string | null;
  clobTokenIds: string | null;
  marketEndDate: string | null;
  runDate: string;
  yesPriceAtRun: number;
  finalMean: number;
  finalMode: number;
  distributionP5: number;
  distributionP95: number;
  distributionHistogram: number[];
  step3At: string;
  volume: string | null;
}

interface PredictionView {
  persona: string;
  personaName: string;
  shortLabel: string;
  round: number;
  probability: number;
  bullets: string[];
  webContext?: string;
}

interface RunDetail {
  run: RunSummary & { status: string; triggerSource: string };
  predictions: PredictionView[];
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function firstTokenId(json: string | null): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && typeof arr[0] === "string" ? arr[0] : "";
  } catch {
    return "";
  }
}

// --------------------------------------------------------------------------
// Histogram bar chart — bootstrap distribution, rendered via shadcn Chart
// (recharts under the hood). Mode bar highlighted in green, mean / 90%
// CI / market price as ReferenceLines. Native recharts hover gives a
// proper tooltip with the bin range + count.
// --------------------------------------------------------------------------

const histogramChartConfig = {
  count: {
    label: "Resamples",
    color: "#58a6ff",
  },
} satisfies ChartConfig;

function Histogram({
  bins,
  mean,
  mode,
  p5,
  p95,
  marketPrice,
}: {
  bins: number[];
  mean: number;
  mode: number;
  p5: number;
  p95: number;
  marketPrice?: number; // 0-100, optional overlay
}) {
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  const binPctWidth = 100 / bins.length;
  const modeBinIdx = Math.min(
    bins.length - 1,
    Math.max(0, Math.floor(mode / binPctWidth)),
  );

  const chartData = bins.map((count, i) => ({
    bin: i * binPctWidth,
    binEnd: (i + 1) * binPctWidth,
    binLabel: `${(i * binPctWidth).toFixed(1)}–${((i + 1) * binPctWidth).toFixed(1)}%`,
    count,
    pct: ((count / total) * 100).toFixed(2),
    isMode: i === modeBinIdx,
  }));

  return (
    <ChartContainer
      config={histogramChartConfig}
      className="aspect-auto h-[140px] w-full"
    >
      <BarChart
        data={chartData}
        margin={{ top: 6, right: 6, bottom: 4, left: 6 }}
      >
        {/* X-axis with ticks at 0/25/50/75/100% */}
        <XAxis
          dataKey="bin"
          type="number"
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 9, fill: "#768390" }}
          tickLine={{ stroke: "#30363d" }}
          axisLine={{ stroke: "#30363d" }}
        />
        <YAxis hide domain={[0, "dataMax"]} />

        {/* 90% CI shaded band — drawn as a horizontal band via two
            ReferenceLines isn't ideal in recharts; use opacity on the
            bars within the range instead via Cell (below). The CI lines
            go on top as dashed markers. */}

        <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {chartData.map((d, i) => (
            <Cell
              key={i}
              fill={d.isMode ? "#3fb950" : "#58a6ff"}
              opacity={d.bin >= p5 && d.bin <= p95 ? 0.9 : 0.45}
            />
          ))}
        </Bar>

        {/* p5/p95 dashed CI lines */}
        <ReferenceLine
          x={p5}
          stroke="#bf8700"
          strokeDasharray="3 2"
          strokeWidth={1}
        />
        <ReferenceLine
          x={p95}
          stroke="#bf8700"
          strokeDasharray="3 2"
          strokeWidth={1}
        />

        {/* AI mean marker (green) */}
        <ReferenceLine
          x={mean}
          stroke="#3fb950"
          strokeWidth={1.5}
          label={{
            value: `AI ${mean.toFixed(1)}%`,
            position: "top",
            fill: "#3fb950",
            fontSize: 9,
            fontWeight: 600,
          }}
        />

        {/* Market price marker (purple) — only when sufficiently far
            from the mean to avoid overlapping labels */}
        {marketPrice != null && Math.abs(marketPrice - mean) > 6 && (
          <ReferenceLine
            x={marketPrice}
            stroke="#bc8cff"
            strokeWidth={1.5}
            label={{
              value: `Mkt ${marketPrice.toFixed(0)}%`,
              position: "top",
              fill: "#bc8cff",
              fontSize: 9,
              fontWeight: 600,
            }}
          />
        )}
        {marketPrice != null && Math.abs(marketPrice - mean) <= 6 && (
          <ReferenceLine x={marketPrice} stroke="#bc8cff" strokeWidth={1.5} />
        )}

        <ChartTooltip
          cursor={{ fill: "#1c2128", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(_value, _name, item) => {
                const d = item.payload as (typeof chartData)[number];
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#e6edf3] font-medium">
                      {d.binLabel}
                    </span>
                    <span className="text-[#768390]">
                      {d.count.toLocaleString()} resamples ({d.pct}%)
                      {d.isMode ? " · MODE" : ""}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
      </BarChart>
    </ChartContainer>
  );
}

// --------------------------------------------------------------------------
// Drill-down body for an expanded row
// --------------------------------------------------------------------------

function ExpandedRun({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/consensus/run/${runId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RunDetail;
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) return <p className="text-xs text-[#484f58] py-3">Loading personas…</p>;
  if (error) return <p className="text-xs text-[#f85149] py-3">Failed to load: {error}</p>;
  if (!detail) return null;

  const tokenId = firstTokenId(detail.run.clobTokenIds);
  const round1 = detail.predictions.filter((p) => p.round === 1);
  const round2 = detail.predictions.filter((p) => p.round === 2);
  const ciHalf = (detail.run.distributionP95 - detail.run.distributionP5) / 2;

  return (
    <div className="px-4 py-4 bg-[#0d1117] border-t border-[#21262d] space-y-4">
      {/* Top row: histogram + price chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="surface-card p-3">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">
            Bootstrap distribution (10K resamples)
          </p>
          <Histogram
            bins={detail.run.distributionHistogram}
            mean={detail.run.finalMean}
            mode={detail.run.finalMode}
            p5={detail.run.distributionP5}
            p95={detail.run.distributionP95}
            marketPrice={detail.run.yesPriceAtRun * 100}
          />
          <div className="flex items-center justify-between mt-1 text-[10px] text-[#768390]">
            <span>
              <span className="text-[#3fb950]">|</span> mean {detail.run.finalMean.toFixed(1)}%
            </span>
            <span>
              <span className="text-[#bc8cff]">|</span> mkt {(detail.run.yesPriceAtRun * 100).toFixed(0)}%
            </span>
            <span>
              <span className="text-[#bf8700]">|</span> 90% CI [{detail.run.distributionP5.toFixed(1)}%, {detail.run.distributionP95.toFixed(1)}%] (±{ciHalf.toFixed(1)})
            </span>
            <span><span className="text-[#3fb950]">▮</span> mode {detail.run.finalMode.toFixed(1)}%</span>
          </div>
          <p className="text-[9px] text-[#484f58] mt-1.5">
            Hover any bar to see how many of the 10K resamples landed in that 2.5% bin.
          </p>
        </div>
        {tokenId ? (
          <div className="surface-card p-3">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">
              Polymarket price history
            </p>
            <MiniPriceChart tokenId={tokenId} />
          </div>
        ) : (
          <div />
        )}
      </div>

      {/* Per-persona table */}
      <div>
        <p className="text-[11px] text-[#768390] mb-2">
          {round1.length} personas voted in round 1, {round2.length} in round 2 (re-assessing
          after seeing round 1). Click a row to read the bullets they extracted.
        </p>
        <div className="border border-[#21262d] rounded-md overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d] bg-[#161b22]">
            <div className="col-span-4">Persona</div>
            <div className="col-span-2 text-center">R1 %</div>
            <div className="col-span-2 text-center">R2 %</div>
            <div className="col-span-4">Round 2 reasoning (top bullet)</div>
          </div>
          {round1.map((p) => {
            const r2 = round2.find((q) => q.persona === p.persona);
            const r1Top = p.bullets[0] ?? "";
            const r2Top = r2?.bullets[0] ?? "";
            const shift = r2 ? r2.probability - p.probability : 0;
            return (
              <details key={p.persona} className="group border-b border-[#21262d] last:border-b-0">
                <summary className="grid grid-cols-12 gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-[#1c2128] transition-colors">
                  <div className="col-span-4 text-[#e6edf3] truncate">
                    {p.personaName}
                  </div>
                  <div className="col-span-2 text-center tabular-nums text-[#adbac7]">
                    {p.probability.toFixed(0)}%
                  </div>
                  <div className="col-span-2 text-center tabular-nums">
                    {r2 ? (
                      <>
                        <span className="text-[#e6edf3]">{r2.probability.toFixed(0)}%</span>
                        {Math.abs(shift) >= 1 && (
                          <span
                            className={cn(
                              "ml-1 text-[10px]",
                              shift > 0 ? "text-[#3fb950]" : "text-[#f85149]",
                            )}
                          >
                            {shift > 0 ? "+" : ""}{shift.toFixed(0)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[#484f58]">—</span>
                    )}
                  </div>
                  <div className="col-span-4 text-[11px] text-[#768390] truncate">
                    {r2Top || r1Top}
                  </div>
                </summary>
                <div className="px-3 py-3 bg-[#0d1117] border-t border-[#21262d] text-xs space-y-3">
                  <div>
                    <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Round 1 ({p.probability.toFixed(0)}%)</p>
                    <ul className="space-y-1 text-[#adbac7] list-disc list-inside">
                      {p.bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                    {p.webContext && (
                      <details className="mt-2">
                        <summary className="text-[10px] text-[#484f58] cursor-pointer hover:text-[#768390]">
                          Show web context the persona researched
                        </summary>
                        <pre className="text-[10px] text-[#768390] whitespace-pre-wrap mt-1 bg-[#161b22] border border-[#21262d] rounded p-2 max-h-40 overflow-auto">
                          {p.webContext}
                        </pre>
                      </details>
                    )}
                  </div>
                  {r2 && (
                    <div>
                      <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Round 2 ({r2.probability.toFixed(0)}%)</p>
                      <ul className="space-y-1 text-[#adbac7] list-disc list-inside">
                        {r2.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page
// --------------------------------------------------------------------------

export default function AIConsensusPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/consensus/latest")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { runs: RunSummary[] };
        if (!cancelled) setRuns(data.runs);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live CLOB midpoint per market — shows drift since the snapshot
  const priceTargets = useMemo(
    () =>
      runs
        .map((r) => ({
          id: r.id,
          tokenId: firstTokenId(r.clobTokenIds),
          fallbackYes: r.yesPriceAtRun,
          fallbackNo: 1 - r.yesPriceAtRun,
        }))
        .filter((t) => t.tokenId),
    [runs],
  );
  const { getPrice, ready: pricesReady } = usePositionLivePrices(priceTargets);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-4 relative min-h-screen">
      <div className="flex items-start justify-between mb-6 relative z-10">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Swarm Consensus</h1>
          <p className="mt-1 text-sm text-[#768390] max-w-xl">
            20 AI personas vote across 2 rounds with their own web research, then we
            bootstrap 10K resamples to get the headline number. Snapshot refreshes once
            a day at 06:30 UTC. <Link href="/docs#ai-consensus" className="text-[#58a6ff] hover:underline">How it works</Link>
          </p>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Latest snapshot</p>
          <p className="text-sm font-bold text-[#58a6ff] tabular-nums">
            {runs.length > 0 ? timeAgo(runs[0].step3At) : "—"}
          </p>
        </div>
      </div>

      {/* Plexus dots as page background */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-30 overflow-hidden">
        <SwarmVisualization className="!h-full" />
      </div>

      {loading ? (
        <p className="text-sm text-[#484f58] text-center py-16 relative z-10">
          Loading latest snapshot…
        </p>
      ) : error ? (
        <p className="text-sm text-[#f85149] text-center py-16 relative z-10">
          {error}
        </p>
      ) : runs.length === 0 ? (
        <div className="text-center py-16 relative z-10">
          <p className="text-sm text-[#768390]">No AI consensus snapshots yet.</p>
          <p className="text-xs text-[#484f58] mt-1">
            The first snapshot will run at 06:30 UTC tomorrow.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden relative z-10">
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[#21262d] text-[10px] text-[#484f58] uppercase tracking-wider">
            <div className="col-span-5">Market</div>
            <div className="col-span-2 text-center">Market</div>
            <div className="col-span-3 text-center">AI mean ± 90% CI</div>
            <div className="col-span-2 text-center">Diff</div>
          </div>

          {runs.map((run, idx) => {
            const live = pricesReady ? getPrice(run.id, run.yesPriceAtRun, 1 - run.yesPriceAtRun) : null;
            const liveYesPct = live ? live.yesPrice * 100 : run.yesPriceAtRun * 100;
            const diff = run.finalMean - liveYesPct;
            const trendColor =
              diff > 3 ? "text-[#3fb950]" : diff < -3 ? "text-[#f85149]" : "text-[#484f58]";
            const ciHalf = (run.distributionP95 - run.distributionP5) / 2;
            const isExpanded = expandedId === run.id;
            const marketUrl = `${POLYMARKET_BASE_URL}/event/${run.eventSlug || run.marketSlug}`;

            return (
              <div
                key={run.id}
                className="border-b border-[#21262d] last:border-b-0 animate-fade-in-up"
                style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "backwards" }}
              >
                {/* Desktop row */}
                <div
                  className="hidden sm:grid grid-cols-12 gap-2 px-4 py-4 items-center cursor-pointer hover:bg-[#1c2128]/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : run.id)}
                >
                  <div className="col-span-5 flex items-start gap-2">
                    <svg
                      className={cn(
                        "w-3 h-3 text-[#484f58] transition-transform flex-shrink-0 mt-0.5",
                        isExpanded && "rotate-90",
                      )}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div>
                      <p className="text-[13px] text-[#e6edf3] font-medium leading-snug">
                        {idx + 1}. {run.marketQuestion}
                      </p>
                      <p className="text-[10px] text-[#484f58] mt-0.5">
                        Snapshot {timeAgo(run.step3At)} &middot; mode {run.finalMode.toFixed(1)}%
                        {run.marketEndDate &&
                          ` · ends ${new Date(run.marketEndDate).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="text-lg font-bold text-[#e6edf3] tabular-nums">
                      {liveYesPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="col-span-3 text-center">
                    <span className="text-lg font-bold text-[#58a6ff] tabular-nums">
                      {run.finalMean.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-[#768390] ml-1 tabular-nums">
                      ±{ciHalf.toFixed(1)}
                    </span>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className={cn("text-sm font-semibold tabular-nums", trendColor)}>
                      {diff > 0 ? "+" : ""}
                      {diff.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Mobile row */}
                <div
                  className="sm:hidden block px-4 py-3 hover:bg-[#1c2128] transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : run.id)}
                >
                  <div className="flex items-start gap-2">
                    <svg
                      className={cn(
                        "w-3 h-3 text-[#484f58] transition-transform flex-shrink-0 mt-0.5",
                        isExpanded && "rotate-90",
                      )}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <p className="text-[13px] text-[#e6edf3] font-medium">
                      {idx + 1}. {run.marketQuestion}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 mt-2 ml-5">
                    <div>
                      <span className="text-[10px] text-[#484f58]">Market</span>
                      <p className="text-sm font-bold text-[#e6edf3] tabular-nums">
                        {liveYesPct.toFixed(0)}%
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#484f58]">AI</span>
                      <p className="text-sm font-bold text-[#58a6ff] tabular-nums">
                        {run.finalMean.toFixed(1)}% ±{ciHalf.toFixed(1)}
                      </p>
                    </div>
                    <span className={cn("text-xs font-semibold tabular-nums", trendColor)}>
                      {diff > 0 ? "+" : ""}
                      {diff.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Drill-down */}
                {isExpanded && (
                  <>
                    <ExpandedRun runId={run.id} />
                    <div className="px-4 py-2 bg-[#0d1117] border-t border-[#21262d]">
                      <a
                        href={marketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-[#58a6ff] hover:underline"
                      >
                        View on Polymarket
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[11px] text-[#484f58] mt-2 mb-0 relative z-10">
        20 personas &middot; 2 rounds with web research &middot; bootstrap 10K resamples
        for 90% confidence interval. <Link href="/docs#ai-consensus" className="text-[#58a6ff] hover:underline">Learn more</Link>
      </p>
    </div>
  );
}
