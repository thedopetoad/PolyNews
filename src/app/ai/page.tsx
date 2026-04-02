"use client";

import { useEffect, useState, useCallback } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { parseMarketPrices, PolymarketEvent, MarketWithPrices, formatPercentage, formatVolume } from "@/types/polymarket";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface AgentPrediction {
  agent: string;
  probability: number;
  confidence: number;
  reasoning: string;
}

interface ConsensusResult {
  consensus: number;
  confidence: number;
  spread: number;
  trend: "up" | "down" | "flat";
  agents: AgentPrediction[];
}

interface MarketConsensus {
  market: MarketWithPrices;
  result: ConsensusResult | null;
  loading: boolean;
  error: boolean;
}

export default function AIConsensusPage() {
  const { data: events, isLoading: marketsLoading } = usePolymarketEvents({ limit: "30" });
  const [marketConsensus, setMarketConsensus] = useState<MarketConsensus[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Get top 5 active markets by volume
  const topMarkets = (() => {
    if (!events) return [];
    const all = events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    );
    return all
      .filter((m) => m.yesPrice > 0.02 && m.yesPrice < 0.98) // skip resolved
      .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
      .slice(0, 5);
  })();

  const runConsensus = useCallback(async () => {
    if (topMarkets.length === 0) return;
    setRunning(true);
    setHasRun(true);

    // Initialize all as loading
    setMarketConsensus(
      topMarkets.map((m) => ({ market: m, result: null, loading: true, error: false }))
    );

    // Run all 5 in parallel
    const results = await Promise.all(
      topMarkets.map(async (market) => {
        try {
          const res = await fetch("/api/consensus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              marketQuestion: market.question,
              currentYesPrice: market.yesPrice,
            }),
          });
          if (!res.ok) throw new Error("Failed");
          const data: ConsensusResult = await res.json();
          return { market, result: data, loading: false, error: false };
        } catch {
          return { market, result: null, loading: false, error: true };
        }
      })
    );

    setMarketConsensus(results);
    setRunning(false);
  }, [topMarkets]);

  // Auto-run on first load when markets are available
  useEffect(() => {
    if (topMarkets.length > 0 && !hasRun && !running) {
      runConsensus();
    }
  }, [topMarkets.length, hasRun, running, runConsensus]);

  const trendIcon = (trend: string) =>
    trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "\u2014";
  const trendColor = (trend: string) =>
    trend === "up" ? "text-[#3fb950]" : trend === "down" ? "text-[#f85149]" : "text-[#484f58]";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">AI Swarm Consensus</h1>
        <p className="mt-1 text-sm text-[#768390] max-w-2xl">
          5 AI agents with distinct perspectives independently analyze the top Polymarket
          markets, then their predictions are aggregated into a weighted consensus.
          Inspired by the <a href="https://arxiv.org/abs/2411.11581" target="_blank" className="text-[#58a6ff] hover:underline">OASIS framework</a>.
        </p>
      </div>

      {/* Swarm viz */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden mb-6">
        <div className="px-4 py-2 border-b border-[#21262d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("w-1.5 h-1.5 rounded-full", running ? "bg-[#d29922] animate-pulse" : "bg-[#3fb950]")} />
            <span className="text-[11px] text-[#484f58]">
              {running ? "Agents deliberating..." : "Swarm Agent Network"}
            </span>
          </div>
          <button
            onClick={runConsensus}
            disabled={running || marketsLoading}
            className="text-[11px] text-[#58a6ff] hover:underline disabled:opacity-50"
          >
            {running ? "Running..." : "Re-run analysis"}
          </button>
        </div>
        <SwarmVisualization />
      </div>

      {/* Agent legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {["Market Analyst", "Political Strategist", "Contrarian Trader", "News Analyst", "Risk Assessor"].map((name) => (
          <span key={name} className="text-[10px] text-[#484f58] bg-[#1c2128] px-2 py-1 rounded border border-[#21262d]">
            {name}
          </span>
        ))}
      </div>

      {/* Results */}
      {marketsLoading ? (
        <p className="text-sm text-[#484f58] text-center py-16">Loading markets...</p>
      ) : marketConsensus.length === 0 && !running ? (
        <div className="text-center py-16">
          <p className="text-sm text-[#484f58]">Waiting for market data...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Column headers */}
          <div className="hidden sm:grid grid-cols-12 gap-4 px-4 text-[10px] text-[#484f58] uppercase tracking-wider">
            <div className="col-span-5">Market</div>
            <div className="col-span-2 text-center">Market Price</div>
            <div className="col-span-2 text-center">AI Consensus</div>
            <div className="col-span-1 text-center">Diff</div>
            <div className="col-span-2 text-center">Confidence</div>
          </div>

          {marketConsensus.map((mc, idx) => {
            const isExpanded = expandedAgent === mc.market.id;
            const diff = mc.result ? mc.result.consensus - mc.market.yesPrice * 100 : 0;

            return (
              <div key={mc.market.id} className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
                {/* Main row */}
                <div
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 p-4 items-center cursor-pointer hover:bg-[#1c2128] transition-colors"
                  onClick={() => setExpandedAgent(isExpanded ? null : mc.market.id)}
                >
                  {/* Market name */}
                  <div className="sm:col-span-5">
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] text-[#484f58] font-mono mt-0.5">#{idx + 1}</span>
                      <div>
                        <a
                          href={`${POLYMARKET_BASE_URL}/event/${mc.market.slug || mc.market.conditionId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-[#e6edf3] hover:text-[#58a6ff] font-medium leading-snug"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {mc.market.question}
                        </a>
                        <p className="text-[10px] text-[#484f58] mt-0.5">{formatVolume(mc.market.volume)} volume</p>
                      </div>
                    </div>
                  </div>

                  {/* Market price */}
                  <div className="sm:col-span-2 text-center">
                    <span className="text-lg font-bold text-[#e6edf3] tabular-nums">
                      {formatPercentage(mc.market.yesPrice)}
                    </span>
                    <p className="text-[10px] text-[#484f58]">Market</p>
                  </div>

                  {/* AI consensus */}
                  <div className="sm:col-span-2 text-center">
                    {mc.loading ? (
                      <span className="text-sm text-[#d29922] animate-pulse">Analyzing...</span>
                    ) : mc.error ? (
                      <span className="text-sm text-[#f85149]">Error</span>
                    ) : mc.result ? (
                      <>
                        <span className="text-lg font-bold text-[#58a6ff] tabular-nums">
                          {mc.result.consensus.toFixed(0)}%
                        </span>
                        <p className="text-[10px] text-[#484f58]">AI Swarm</p>
                      </>
                    ) : null}
                  </div>

                  {/* Diff */}
                  <div className="sm:col-span-1 text-center">
                    {mc.result && (
                      <span className={cn("text-sm font-bold tabular-nums", trendColor(mc.result.trend))}>
                        {trendIcon(mc.result.trend)} {Math.abs(diff).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* Confidence */}
                  <div className="sm:col-span-2">
                    {mc.result && (
                      <div>
                        <div className="h-1.5 bg-[#21262d] rounded-full">
                          <div
                            className="h-1.5 rounded-full bg-[#58a6ff] transition-all duration-500"
                            style={{ width: `${mc.result.confidence}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-[#484f58] text-center mt-0.5">
                          {mc.result.confidence}%
                          {mc.result.spread > 15 && " (split)"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded agent breakdown */}
                {isExpanded && mc.result && (
                  <div className="border-t border-[#21262d] bg-[#0d1117] p-4">
                    <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-3">Agent Breakdown</p>
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      {mc.result.agents.map((agent) => {
                        const agentDiff = agent.probability - mc.market.yesPrice * 100;
                        return (
                          <div key={agent.agent} className="rounded-md bg-[#161b22] border border-[#21262d] p-3">
                            <p className="text-[11px] text-[#adbac7] font-medium">{agent.agent}</p>
                            <p className="text-xl font-bold text-white tabular-nums mt-1">{agent.probability}%</p>
                            <p className={cn("text-[10px] font-medium", agentDiff > 0 ? "text-[#3fb950]" : agentDiff < 0 ? "text-[#f85149]" : "text-[#484f58]")}>
                              {agentDiff > 0 ? "+" : ""}{agentDiff.toFixed(0)}% vs market
                            </p>
                            <p className="text-[10px] text-[#484f58] mt-1.5 line-clamp-3">{agent.reasoning}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
