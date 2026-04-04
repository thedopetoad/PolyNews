"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";

const ADMIN_WALLET = "0xfbeefb072f368803b33ba5c529f2f6762941b282";

const TARGET_MARKETS = [
  { id: "us-forces-iran-april-2026", question: "US Forces enter Iran by April 30?" },
  { id: "wti-crude-oil-april-2026", question: "What will WTI Crude Oil (WTI) hit in April 2026?" },
  { id: "sp500-opens-up-down-april-6", question: "S&P 500 Opens Up or Down on April 6?" },
];

interface Prediction {
  id: string;
  marketId: string;
  marketQuestion: string;
  marketPrice: number;
  consensus: number;
  edge: number;
  confidence: number;
  kellyScore: number;
  recommendation: string;
  agentCount: number;
  resolvedOutcome: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface CalibrationData {
  bins: { range: string; predicted: number; actual: number; count: number; error: number }[];
  totalPredictions: number;
  resolvedPredictions: number;
  accuracy: number;
}

export default function AdminPage() {
  const { address, isConnected } = useUser();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [runningMarket, setRunningMarket] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState("");

  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_WALLET;

  // Fetch all predictions
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/swarm")
      .then((r) => r.json())
      .then((data) => setPredictions(data.predictions || []))
      .catch(() => {});
  }, [isAdmin]);

  // Fetch calibration
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/swarm/calibration")
      .then((r) => r.json())
      .then(setCalibration)
      .catch(() => {});
  }, [isAdmin]);

  const runSwarm = async (market: typeof TARGET_MARKETS[0]) => {
    setRunningMarket(market.id);
    setRunProgress("Fetching market price...");

    try {
      // Fetch live price from Polymarket
      const eventsRes = await fetch("/api/polymarket/events?limit=50");
      const events = await eventsRes.json();
      const allMarkets = events.flatMap((e: { markets?: { question?: string; outcomePrices?: string }[] }) => e.markets || []);
      const match = allMarkets.find((m: { question?: string }) =>
        m.question?.toLowerCase().includes(market.question.split(" ").slice(0, 3).join(" ").toLowerCase())
      );

      let price = 0.5;
      if (match?.outcomePrices) {
        price = parseFloat(JSON.parse(match.outcomePrices)[0]);
      }

      setRunProgress(`Price: ${(price * 100).toFixed(0)}%. Running 4,096 agents...`);

      const progressTimer = setInterval(() => {
        setRunProgress((prev) => {
          if (prev.includes("4,096")) return "Phase 1: Deep web research (5 searches)...";
          if (prev.includes("Phase 1")) return "Phase 2: Generating agents + loading memory...";
          if (prev.includes("Phase 2")) return "Phase 3: Rounds 1-2 (independent analysis)...";
          if (prev.includes("1-2")) return "Phase 3: Rounds 3-5 (social feed simulation)...";
          if (prev.includes("3-5")) return "Phase 3: Rounds 6-8 (cluster debate)...";
          if (prev.includes("6-8")) return "Phase 3: Rounds 9-10 (final calibration)...";
          if (prev.includes("9-10")) return "Phase 4: Aggregating + edge detection...";
          return prev;
        });
      }, 15000);

      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketQuestion: market.question,
          marketPrice: price,
          marketId: market.id,
          agentCount: 4096,
        }),
      });

      clearInterval(progressTimer);

      if (!res.ok) throw new Error("Swarm failed");

      const result = await res.json();
      setRunProgress(`Done! Consensus: ${result.consensus?.toFixed(1)}% | Edge: ${result.edge > 0 ? "+" : ""}${result.edge?.toFixed(1)}% | ${result.recommendation}`);

      // Refresh predictions
      const refreshRes = await fetch("/api/swarm");
      const refreshData = await refreshRes.json();
      setPredictions(refreshData.predictions || []);
    } catch (err) {
      setRunProgress(`Error: ${err instanceof Error ? err.message : "Failed"}`);
    } finally {
      setTimeout(() => {
        setRunningMarket(null);
        setRunProgress("");
      }, 10000);
    }
  };

  // Not admin
  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-[#768390]">Connect your wallet to access admin panel.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-[#f85149]">Access denied. Admin wallet required.</p>
      </div>
    );
  }

  // Calculate stats
  const resolved = predictions.filter((p) => p.resolvedOutcome !== null);
  const correct = resolved.filter((p) => {
    const predictedYes = p.consensus > 50;
    const actualYes = (p.resolvedOutcome || 0) > 50;
    return predictedYes === actualYes;
  });
  const hypotheticalPnL = predictions.reduce((sum, p) => {
    if (p.resolvedOutcome === null) return sum;
    const betYes = p.consensus > p.marketPrice;
    const won = betYes ? (p.resolvedOutcome || 0) > 50 : (p.resolvedOutcome || 0) <= 50;
    return sum + (won ? Math.abs(p.edge) : -Math.abs(p.edge));
  }, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-white mb-1">Admin Dashboard</h1>
      <p className="text-sm text-[#768390] mb-6">Super Swarm control panel</p>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
          <p className="text-[10px] text-[#484f58] uppercase">Total Predictions</p>
          <p className="text-2xl font-bold text-white">{predictions.length}</p>
        </div>
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
          <p className="text-[10px] text-[#484f58] uppercase">Resolved</p>
          <p className="text-2xl font-bold text-white">{resolved.length}</p>
        </div>
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
          <p className="text-[10px] text-[#484f58] uppercase">Accuracy</p>
          <p className="text-2xl font-bold text-[#3fb950]">
            {resolved.length > 0 ? `${((correct.length / resolved.length) * 100).toFixed(0)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
          <p className="text-[10px] text-[#484f58] uppercase">Hypothetical P&L</p>
          <p className={cn("text-2xl font-bold", hypotheticalPnL >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
            {hypotheticalPnL >= 0 ? "+" : ""}{hypotheticalPnL.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Run Controls */}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-3">Run Swarm</h2>
        <div className="space-y-2">
          {TARGET_MARKETS.map((market) => (
            <div key={market.id} className="flex items-center justify-between py-2">
              <span className="text-sm text-[#e6edf3]">{market.question}</span>
              <button
                onClick={() => runSwarm(market)}
                disabled={runningMarket !== null}
                className="px-4 py-1.5 rounded text-xs font-medium bg-[#d29922] hover:bg-[#d29922]/80 text-black transition-colors disabled:opacity-50"
              >
                {runningMarket === market.id ? "Running..." : "Run"}
              </button>
            </div>
          ))}
        </div>
        {runProgress && (
          <div className="mt-3 flex items-center gap-2">
            {runningMarket && <div className="w-3 h-3 border-2 border-[#d29922] border-t-transparent rounded-full animate-spin" />}
            <span className="text-xs text-[#d29922]">{runProgress}</span>
          </div>
        )}
      </div>

      {/* Calibration */}
      {calibration && calibration.bins.length > 0 && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">Live Calibration</h2>
          <p className="text-[11px] text-[#484f58] mb-3">
            {calibration.resolvedPredictions} resolved predictions &middot; {calibration.accuracy}% directional accuracy
          </p>
          <div className="space-y-1">
            {calibration.bins.map((bin) => (
              <div key={bin.range} className="flex items-center gap-2 text-xs">
                <span className="text-[#484f58] w-16">{bin.range}</span>
                <span className="text-[#adbac7] w-20">Predicted: {bin.predicted}%</span>
                <span className="text-[#adbac7] w-16">Actual: {bin.actual}%</span>
                <span className={cn("w-20", bin.error > 0 ? "text-[#3fb950]" : bin.error < 0 ? "text-[#f85149]" : "text-[#484f58]")}>
                  Error: {bin.error > 0 ? "+" : ""}{bin.error}%
                </span>
                <span className="text-[#484f58]">n={bin.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prediction History */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#21262d]">
          <h2 className="text-sm font-semibold text-white">Prediction History</h2>
        </div>
        {predictions.length === 0 ? (
          <p className="text-sm text-[#484f58] text-center py-8">No predictions yet. Run the swarm above.</p>
        ) : (
          <div className="divide-y divide-[#21262d]">
            {predictions.map((pred) => (
              <div key={pred.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] text-[#e6edf3] font-medium">{pred.marketQuestion}</p>
                    <p className="text-[10px] text-[#484f58] mt-0.5">
                      {new Date(pred.createdAt).toLocaleString()} &middot; {pred.agentCount} agents
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#58a6ff] tabular-nums">{pred.consensus.toFixed(1)}%</p>
                    <p className={cn(
                      "text-[11px] font-semibold tabular-nums",
                      pred.edge > 3 ? "text-[#3fb950]" : pred.edge < -3 ? "text-[#f85149]" : "text-[#484f58]"
                    )}>
                      {pred.edge > 0 ? "+" : ""}{pred.edge.toFixed(1)}% &middot; {pred.recommendation}
                    </p>
                  </div>
                </div>
                {pred.resolvedOutcome !== null && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded",
                      (pred.consensus > 50) === ((pred.resolvedOutcome || 0) > 50)
                        ? "bg-[#238636]/15 text-[#3fb950]"
                        : "bg-[#f85149]/10 text-[#f85149]"
                    )}>
                      {(pred.consensus > 50) === ((pred.resolvedOutcome || 0) > 50) ? "CORRECT" : "WRONG"}
                    </span>
                    <span className="text-[10px] text-[#484f58]">
                      Resolved: {pred.resolvedOutcome?.toFixed(0)}% | Predicted: {pred.consensus.toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
