"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import Link from "next/link";

// The target market for beta testing
const TARGET_MARKET = {
  question: "Will Ken Paxton win the 2026 Texas Republican Primary?",
  marketId: "paxton-texas-primary-2026",
  eventSlug: "2026-texas-republican-primary",
  clobTokenId: "", // Will be populated from events API
  endDate: "2026-05-26",
};

interface ClusterInfo {
  size: number;
  avgPrediction: number;
  topArgument: string;
}

interface SwarmResult {
  consensus: number;
  marketPrice: number;
  edge: number;
  edgeDirection: "undervalued" | "overvalued" | "neutral";
  confidence: number;
  kellyScore: number;
  recommendation: string;
  agentCount: number;
  rounds: number;
  clusterAnalysis: {
    bullCluster: ClusterInfo;
    bearCluster: ClusterInfo;
    undecided: ClusterInfo;
  };
  calibratedConsensus: number;
  calibrationAdjustment: number;
  historicalBias: string;
  roundProgression: number[];
  consensusStability: number;
  webContext: string;
  predictionId?: string;
}

interface HistoricalPrediction {
  id: string;
  consensus: number;
  marketPrice: number;
  edge: number;
  recommendation: string;
  agentCount: number;
  createdAt: string;
}

export default function AIBetaPage() {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [result, setResult] = useState<SwarmResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [history, setHistory] = useState<HistoricalPrediction[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch live Polymarket price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch("/api/polymarket/events?limit=50");
        if (!res.ok) return;
        const events = await res.json();
        const market = events.flatMap((e: { markets?: { question?: string; outcomePrices?: string }[] }) => e.markets || [])
          .find((m: { question?: string }) => m.question?.includes("Ken Paxton") && m.question?.includes("Texas Republican Primary"));
        if (market?.outcomePrices) {
          const prices = JSON.parse(market.outcomePrices);
          setLivePrice(parseFloat(prices[0]));
        }
      } catch {}
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch historical predictions
  useEffect(() => {
    fetch("/api/swarm?marketId=" + TARGET_MARKET.marketId)
      .then((r) => r.json())
      .then((data) => setHistory(data.predictions || []))
      .catch(() => {});
  }, [result]);

  const runSwarm = async () => {
    if (!livePrice) return;
    setRunning(true);
    setError(null);
    setProgress("Phase 1: Deep knowledge gathering (5 web searches)...");

    try {
      // Estimate progress updates
      const progressTimer = setInterval(() => {
        setProgress((prev) => {
          if (prev.includes("Phase 1")) return "Phase 2: Generating 200 diverse agents...";
          if (prev.includes("Phase 2")) return "Phase 3: Social simulation — Rounds 1-2 (independent analysis)...";
          if (prev.includes("Rounds 1-2")) return "Phase 3: Social simulation — Rounds 3-5 (information sharing)...";
          if (prev.includes("Rounds 3-5")) return "Phase 3: Social simulation — Rounds 6-8 (cluster formation)...";
          if (prev.includes("Rounds 6-8")) return "Phase 3: Social simulation — Rounds 9-10 (final calibration)...";
          if (prev.includes("Rounds 9-10")) return "Phase 4: Aggregating 2,000 predictions + calculating edge...";
          return prev;
        });
      }, 12000);

      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketQuestion: TARGET_MARKET.question,
          marketPrice: livePrice,
          marketId: TARGET_MARKET.marketId,
          agentCount: 200,
        }),
      });

      clearInterval(progressTimer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Swarm failed");
      }

      setResult(await res.json());
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setProgress("");
    } finally {
      setRunning(false);
    }
  };

  const edgeColor = result
    ? result.edge > 3 ? "text-[#3fb950]" : result.edge < -3 ? "text-[#f85149]" : "text-[#768390]"
    : "";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-black bg-[#d29922] px-2 py-0.5 rounded">BETA</span>
          <h1 className="text-2xl font-bold text-white">Super Swarm Prediction</h1>
        </div>
        <p className="text-sm text-[#768390]">
          200 AI agents with 20 unique archetypes debate across 10 rounds of social simulation.
          Deep web research, cluster formation, and Kelly criterion edge detection.{" "}
          <Link href="/ai" className="text-[#58a6ff] hover:underline">Standard consensus</Link>
        </p>
      </div>

      {/* Market Card */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <a
              href={`${POLYMARKET_BASE_URL}/event/${TARGET_MARKET.eventSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-[#e6edf3] hover:text-[#58a6ff]"
            >
              {TARGET_MARKET.question}
            </a>
            <p className="text-[11px] text-[#484f58] mt-1">Ends {TARGET_MARKET.endDate} &middot; Polymarket</p>
          </div>
          <div className="text-right flex-shrink-0 ml-4">
            <p className="text-[10px] text-[#484f58] uppercase">Live Polymarket</p>
            <p className="text-3xl font-bold text-white tabular-nums">
              {livePrice !== null ? `${(livePrice * 100).toFixed(0)}%` : "..."}
            </p>
          </div>
        </div>

        {/* Run button */}
        <div className="mt-4">
          {running ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-[#d29922] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-[#d29922]">{progress}</span>
              </div>
              <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
                <div className="h-full bg-[#d29922] rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
            </div>
          ) : (
            <button
              onClick={runSwarm}
              disabled={!livePrice}
              className="px-4 py-2.5 rounded-lg bg-[#d29922] hover:bg-[#d29922]/80 text-black font-semibold text-sm transition-colors disabled:opacity-50"
            >
              Run Super Swarm (200 agents, 10 rounds)
            </button>
          )}
          {error && <p className="text-xs text-[#f85149] mt-2">{error}</p>}
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Main result card */}
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Raw Swarm</p>
                <p className="text-xl font-bold text-[#768390] tabular-nums">{result.consensus.toFixed(1)}%</p>
                <p className="text-[10px] text-[#484f58] uppercase mt-2">Calibrated</p>
                <p className="text-3xl font-bold text-[#58a6ff] tabular-nums">{result.calibratedConsensus.toFixed(1)}%</p>
                <p className="text-[10px] text-[#484f58]">{result.calibrationAdjustment > 0 ? "+" : ""}{result.calibrationAdjustment.toFixed(1)}% adj</p>
              </div>
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Edge vs Market</p>
                <p className={cn("text-3xl font-bold tabular-nums", edgeColor)}>
                  {result.edge > 0 ? "+" : ""}{result.edge.toFixed(1)}%
                </p>
                <p className="text-[11px] text-[#484f58]">{result.edgeDirection}</p>
                <p className="text-[10px] text-[#484f58] mt-1">{result.historicalBias}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Kelly Score</p>
                <p className="text-2xl font-bold text-white tabular-nums">{result.kellyScore.toFixed(3)}</p>
                <p className="text-[10px] text-[#484f58] mt-1">Confidence: {result.confidence}%</p>
              </div>
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Recommendation</p>
                <p className={cn(
                  "text-lg font-bold",
                  result.recommendation.includes("BUY YES") ? "text-[#3fb950]"
                    : result.recommendation.includes("BUY NO") ? "text-[#f85149]"
                      : "text-[#768390]"
                )}>
                  {result.recommendation}
                </p>
                <p className="text-[10px] text-[#484f58] mt-1">Based on 13,868 historical markets</p>
              </div>
            </div>
          </div>

          {/* Round progression */}
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Consensus Trajectory (10 Rounds)</h3>
            <div className="flex items-end gap-1 h-32">
              {result.roundProgression.map((avg, idx) => {
                const height = Math.max(5, (avg / 100) * 100);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] text-[#768390] tabular-nums">{avg}%</span>
                    <div
                      className={cn(
                        "w-full rounded-t",
                        idx >= 8 ? "bg-[#58a6ff]" : idx >= 5 ? "bg-[#58a6ff]/60" : idx >= 2 ? "bg-[#58a6ff]/40" : "bg-[#58a6ff]/25"
                      )}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[8px] text-[#484f58]">R{idx + 1}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-[#484f58]">
              <span>Independent</span>
              <span>Info Sharing</span>
              <span>Clusters</span>
              <span>Final</span>
            </div>
            <p className="text-[11px] text-[#484f58] mt-2">
              Stability: {(result.consensusStability * 100).toFixed(0)}% &middot; {result.agentCount} agents &middot; {result.rounds} rounds
            </p>
          </div>

          {/* Cluster analysis */}
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Cluster Analysis</h3>
            <div className="space-y-3">
              <div className="bg-[#238636]/10 rounded-lg p-3 border border-[#238636]/20">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-[#3fb950]">Bull Cluster</span>
                  <span className="text-xs text-[#3fb950] tabular-nums">{result.clusterAnalysis.bullCluster.size} agents &middot; avg {result.clusterAnalysis.bullCluster.avgPrediction}%</span>
                </div>
                <p className="text-[12px] text-[#adbac7]">{result.clusterAnalysis.bullCluster.topArgument}</p>
              </div>
              <div className="bg-[#f85149]/10 rounded-lg p-3 border border-[#f85149]/20">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-[#f85149]">Bear Cluster</span>
                  <span className="text-xs text-[#f85149] tabular-nums">{result.clusterAnalysis.bearCluster.size} agents &middot; avg {result.clusterAnalysis.bearCluster.avgPrediction}%</span>
                </div>
                <p className="text-[12px] text-[#adbac7]">{result.clusterAnalysis.bearCluster.topArgument}</p>
              </div>
              {result.clusterAnalysis.undecided.size > 0 && (
                <div className="bg-[#21262d] rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-[#768390]">Undecided</span>
                    <span className="text-xs text-[#768390] tabular-nums">{result.clusterAnalysis.undecided.size} agents</span>
                  </div>
                  <p className="text-[12px] text-[#adbac7]">{result.clusterAnalysis.undecided.topArgument}</p>
                </div>
              )}
            </div>
          </div>

          {/* Web context */}
          <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5">
            <h3 className="text-sm font-semibold text-white mb-2">Knowledge Brief (Web Research)</h3>
            <pre className="text-[11px] text-[#768390] whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {result.webContext}
            </pre>
          </div>
        </div>
      )}

      {/* Historical runs */}
      {history.length > 0 && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden mt-6">
          <div className="px-4 py-2.5 border-b border-[#21262d]">
            <h3 className="text-sm font-semibold text-white">Historical Predictions</h3>
          </div>
          <div className="divide-y divide-[#21262d]">
            {history.map((pred) => (
              <div key={pred.id} className="px-4 py-3 flex items-center justify-between text-xs">
                <span className="text-[#484f58]">{new Date(pred.createdAt).toLocaleString()}</span>
                <span className="text-[#adbac7] tabular-nums">Market: {pred.marketPrice.toFixed(0)}%</span>
                <span className="text-[#58a6ff] tabular-nums font-semibold">Swarm: {pred.consensus.toFixed(1)}%</span>
                <span className={cn(
                  "tabular-nums font-semibold",
                  pred.edge > 3 ? "text-[#3fb950]" : pred.edge < -3 ? "text-[#f85149]" : "text-[#768390]"
                )}>
                  {pred.edge > 0 ? "+" : ""}{pred.edge.toFixed(1)}%
                </span>
                <span className={cn(
                  "font-medium",
                  pred.recommendation.includes("BUY") ? "text-[#d29922]" : "text-[#484f58]"
                )}>
                  {pred.recommendation}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
