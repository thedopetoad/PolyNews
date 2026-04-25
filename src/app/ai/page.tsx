"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePositionLivePrices } from "@/hooks/use-live-prices";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { MiniPriceChart } from "@/components/mini-price-chart";
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
// Histogram bar chart (40 bins, simple SVG, no extra deps)
// --------------------------------------------------------------------------

function Histogram({ bins, mean, p5, p95 }: { bins: number[]; mean: number; p5: number; p95: number }) {
  const max = Math.max(...bins, 1);
  const width = 280;
  const height = 70;
  const binWidth = width / bins.length;
  return (
    <svg width={width} height={height} className="w-full">
      {bins.map((count, i) => {
        const h = Math.round((count / max) * (height - 12));
        const x = i * binWidth;
        return (
          <rect
            key={i}
            x={x}
            y={height - h - 4}
            width={binWidth - 1}
            height={h}
            fill="#58a6ff"
            opacity={0.55}
          />
        );
      })}
      {/* p5/p95 marker lines */}
      {[p5, p95].map((p, idx) => (
        <line
          key={idx}
          x1={(p / 100) * width}
          x2={(p / 100) * width}
          y1={4}
          y2={height - 4}
          stroke="#bf8700"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      ))}
      {/* mean marker line */}
      <line
        x1={(mean / 100) * width}
        x2={(mean / 100) * width}
        y1={2}
        y2={height - 2}
        stroke="#3fb950"
        strokeWidth={1.5}
      />
    </svg>
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
        <div className="bg-[#161b22] border border-[#21262d] rounded-md p-3">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">
            Bootstrap distribution (10K resamples)
          </p>
          <Histogram
            bins={detail.run.distributionHistogram}
            mean={detail.run.finalMean}
            p5={detail.run.distributionP5}
            p95={detail.run.distributionP95}
          />
          <div className="flex items-center justify-between mt-1 text-[10px] text-[#768390]">
            <span>
              <span className="text-[#3fb950]">|</span> mean {detail.run.finalMean.toFixed(1)}%
            </span>
            <span>
              <span className="text-[#bf8700]">|</span> 90% CI [{detail.run.distributionP5.toFixed(1)}%, {detail.run.distributionP95.toFixed(1)}%] (±{ciHalf.toFixed(1)})
            </span>
            <span>mode {detail.run.finalMode.toFixed(1)}%</span>
          </div>
        </div>
        {tokenId ? (
          <div className="bg-[#161b22] border border-[#21262d] rounded-md p-3">
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
