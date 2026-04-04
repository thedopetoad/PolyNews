"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { POLYMARKET_BASE_URL } from "@/lib/constants";

const TARGET_MARKETS = [
  { id: "us-forces-iran-april-2026", question: "US Forces enter Iran by April 30?", slug: "us-forces-iran", endDate: "2026-04-30" },
  { id: "wti-crude-oil-april-2026", question: "What will WTI Crude Oil (WTI) hit in April 2026?", slug: "wti-crude-oil-april-2026", endDate: "2026-04-30" },
  { id: "sp500-opens-up-down-april-6", question: "S&P 500 Opens Up or Down on April 6?", slug: "sp-500-opens-up-or-down-april-6", endDate: "2026-04-06" },
];

interface SwarmPrediction {
  id: string;
  consensus: number;
  calibratedConsensus: number;
  marketPrice: number;
  edge: number;
  edgeDirection: string;
  confidence: number;
  kellyScore: number;
  recommendation: string;
  agentCount: number;
  rounds: number;
  roundProgression?: number[];
  clusterAnalysis?: {
    bullCluster: { size: number; avgPrediction: number; topArgument: string };
    bearCluster: { size: number; avgPrediction: number; topArgument: string };
    undecided: { size: number; avgPrediction: number; topArgument: string };
  };
  consensusStability?: number;
  createdAt: string;
}

function MarketCard({ market, prediction }: { market: typeof TARGET_MARKETS[0]; prediction: SwarmPrediction | null }) {
  const edgeColor = prediction
    ? prediction.edge > 3 ? "text-[#3fb950]" : prediction.edge < -3 ? "text-[#f85149]" : "text-[#768390]"
    : "";

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <div className="p-5">
        <a
          href={`${POLYMARKET_BASE_URL}/event/${market.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-base font-semibold text-[#e6edf3] hover:text-[#58a6ff]"
        >
          {market.question}
        </a>
        <p className="text-[10px] text-[#484f58] mt-1">Ends {market.endDate} &middot; Polymarket</p>

        {prediction ? (
          <div className="mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Swarm Says</p>
                <p className="text-2xl font-bold text-[#58a6ff] tabular-nums">{prediction.consensus.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Market Price</p>
                <p className="text-2xl font-bold text-white tabular-nums">{prediction.marketPrice.toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Edge</p>
                <p className={cn("text-2xl font-bold tabular-nums", edgeColor)}>
                  {prediction.edge > 0 ? "+" : ""}{prediction.edge.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[#484f58] uppercase">Signal</p>
                <p className={cn(
                  "text-lg font-bold",
                  prediction.recommendation.includes("BUY YES") ? "text-[#3fb950]"
                    : prediction.recommendation.includes("BUY NO") ? "text-[#f85149]"
                      : "text-[#768390]"
                )}>
                  {prediction.recommendation}
                </p>
              </div>
            </div>

            {/* Round progression */}
            {prediction.roundProgression && (
              <div className="mt-4">
                <p className="text-[10px] text-[#484f58] uppercase mb-2">Consensus Trajectory</p>
                <div className="flex items-end gap-0.5 h-16">
                  {prediction.roundProgression.map((avg, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center">
                      <div
                        className={cn("w-full rounded-t", idx >= 8 ? "bg-[#58a6ff]" : idx >= 5 ? "bg-[#58a6ff]/60" : "bg-[#58a6ff]/30")}
                        style={{ height: `${Math.max(5, (avg / 100) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cluster analysis */}
            {prediction.clusterAnalysis && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="bg-[#238636]/10 rounded p-2 border border-[#238636]/20">
                  <p className="text-[10px] text-[#3fb950] font-semibold">Bull ({prediction.clusterAnalysis.bullCluster.size} agents)</p>
                  <p className="text-[10px] text-[#768390] mt-0.5 line-clamp-2">{prediction.clusterAnalysis.bullCluster.topArgument}</p>
                </div>
                <div className="bg-[#f85149]/10 rounded p-2 border border-[#f85149]/20">
                  <p className="text-[10px] text-[#f85149] font-semibold">Bear ({prediction.clusterAnalysis.bearCluster.size} agents)</p>
                  <p className="text-[10px] text-[#768390] mt-0.5 line-clamp-2">{prediction.clusterAnalysis.bearCluster.topArgument}</p>
                </div>
              </div>
            )}

            <p className="text-[10px] text-[#484f58] mt-3">
              {prediction.agentCount.toLocaleString()} agents &middot; {prediction.rounds} rounds &middot; Kelly: {prediction.kellyScore.toFixed(3)} &middot; {new Date(prediction.createdAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <div className="mt-4 py-6 text-center">
            <p className="text-sm text-[#484f58]">Awaiting swarm prediction...</p>
            <p className="text-[10px] text-[#484f58] mt-1">Admin will run the swarm shortly</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SuperSwarmPage() {
  const [predictions, setPredictions] = useState<Record<string, SwarmPrediction>>({});
  const [totalPredictions, setTotalPredictions] = useState(0);

  useEffect(() => {
    const fetchPredictions = async () => {
      let total = 0;
      const preds: Record<string, SwarmPrediction> = {};

      for (const market of TARGET_MARKETS) {
        try {
          const res = await fetch(`/api/swarm?marketId=${market.id}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.predictions?.length > 0) {
            const latest = data.predictions[0];
            let parsed: Partial<SwarmPrediction> = {};
            try { parsed = JSON.parse(latest.fullResult || "{}"); } catch {}
            preds[market.id] = {
              ...latest,
              roundProgression: parsed.roundProgression,
              clusterAnalysis: parsed.clusterAnalysis,
              consensusStability: parsed.consensusStability,
              calibratedConsensus: parsed.calibratedConsensus || latest.consensus,
            };
          }
          total += data.predictions?.length || 0;
        } catch {}
      }

      setPredictions(preds);
      setTotalPredictions(total);
    };

    fetchPredictions();
    const interval = setInterval(fetchPredictions, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-black bg-[#d29922] px-2 py-0.5 rounded">BETA</span>
          <h1 className="text-2xl font-bold text-white">Super Swarm Prediction</h1>
        </div>
        <p className="text-sm text-[#768390]">
          4,096 AI agents with 20 archetypes debate across 10 rounds of social simulation.
          GraphRAG knowledge graphs, persistent agent memory, and live calibration.
        </p>
      </div>

      {/* Learning banner */}
      <div className="rounded-lg border border-[#d29922]/20 bg-[#d29922]/5 px-4 py-3 mb-6">
        <p className="text-sm text-[#d29922]">
          Predictions improve over time as markets resolve and the calibration model learns from real outcomes.
          Currently trained on <strong>{totalPredictions}</strong> live prediction{totalPredictions !== 1 ? "s" : ""}.
        </p>
      </div>

      {/* Market cards */}
      <div className="space-y-4">
        {TARGET_MARKETS.map((market) => (
          <MarketCard key={market.id} market={market} prediction={predictions[market.id] || null} />
        ))}
      </div>
    </div>
  );
}
