"use client";

import { useEffect, useState, useCallback } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { parseMarketPrices, PolymarketEvent, MarketWithPrices, formatPercentage, formatVolume } from "@/types/polymarket";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const cycleLengthMs = 5 * 60 * 60 * 1000; // 5 hours
      const elapsed = now % cycleLengthMs;
      const remaining = cycleLengthMs - elapsed;

      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return timeLeft;
}

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
}

export default function AIConsensusPage() {
  const { data: events, isLoading: marketsLoading } = usePolymarketEvents({ limit: "30" });
  const [results, setResults] = useState<MarketConsensus[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Get top markets: long-term, high volume, not resolved
  const topMarkets = (() => {
    if (!events) return [];
    const all = events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    );
    return all
      .filter((m) => m.yesPrice > 0.05 && m.yesPrice < 0.95)
      .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
      .slice(0, 10);
  })();

  // Run consensus once on page load (simulates the daily batch result)
  useEffect(() => {
    if (topMarkets.length === 0 || results.length > 0 || running) return;

    const run = async () => {
      setRunning(true);
      setResults(topMarkets.map((m) => ({ market: m, result: null, loading: true })));

      const fetched = await Promise.all(
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
            if (!res.ok) throw new Error();
            const data: ConsensusResult = await res.json();
            return { market, result: data, loading: false };
          } catch {
            return { market, result: null, loading: false };
          }
        })
      );

      setResults(fetched);
      setRunning(false);
      setLastRun(new Date().toLocaleString());
    };

    run();
  }, [topMarkets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const countdown = useCountdown();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">AI Swarm Consensus</h1>
            <p className="mt-1 text-sm text-[#768390] max-w-xl">
              100,000 AI agents with 20 personas run 3 debate rounds on the top markets.
              Inspired by <a href="https://arxiv.org/abs/2411.11581" target="_blank" className="text-[#58a6ff] hover:underline">OASIS</a>.
            </p>
          </div>
          {/* Countdown */}
          <div className="text-right flex-shrink-0 ml-4">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Next swarm run</p>
            <p className="text-lg font-bold text-[#58a6ff] tabular-nums">{countdown}</p>
          </div>
        </div>

        {/* Debate round explainer */}
        <div className="flex gap-2 mt-4">
          {[
            { label: "Round 1", desc: "Independent predictions" },
            { label: "Round 2", desc: "Agents debate & update" },
            { label: "Round 3", desc: "Final calibrated vote" },
          ].map((r, i) => (
            <div key={r.label} className="flex items-center gap-2 text-[11px]">
              {i > 0 && <span className="text-[#21262d]">&rarr;</span>}
              <span className="bg-[#1c2128] border border-[#21262d] rounded px-2 py-1">
                <span className="text-[#58a6ff] font-medium">{r.label}:</span>{" "}
                <span className="text-[#768390]">{r.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Swarm visualization */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden mb-4">
        <div className="px-4 py-2 border-b border-[#21262d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("w-1.5 h-1.5 rounded-full", running ? "bg-[#d29922] animate-pulse" : "bg-[#3fb950]")} />
            <span className="text-[11px] text-[#484f58]">
              {running ? "300 API calls across 3 debate rounds..." : "Swarm Agent Network \u2014 100K agents"}
            </span>
          </div>
          {lastRun && (
            <span className="text-[10px] text-[#484f58]">Last run: {lastRun}</span>
          )}
        </div>
        <SwarmVisualization />
      </div>

      {/* Agent personas */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {["Market Analyst", "Political Strategist", "Contrarian", "News Analyst", "Risk Assessor", "Economist", "Geopolitical", "Tech Analyst", "Psychologist", "Statistician", "Historian", "Legal Scholar", "Sociologist", "Actuary", "VC", "Crypto Trader", "Military", "Climate", "Journalist", "Devil's Advocate"].map((name) => (
          <span key={name} className="text-[10px] text-[#484f58] bg-[#1c2128] px-2 py-0.5 rounded border border-[#21262d]">
            {name}
          </span>
        ))}
        <span className="text-[10px] text-[#58a6ff] bg-[#58a6ff]/10 px-2 py-0.5 rounded border border-[#58a6ff]/20">
          = 100,000 agents
        </span>
      </div>

      {/* Results table */}
      {marketsLoading || (results.length === 0 && !running) ? (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-16 text-center">
          <p className="text-sm text-[#484f58]">{marketsLoading ? "Loading markets..." : "Preparing analysis..."}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          {/* Header row */}
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[#21262d] text-[10px] text-[#484f58] uppercase tracking-wider">
            <div className="col-span-5">Market</div>
            <div className="col-span-2 text-center">Market</div>
            <div className="col-span-2 text-center">AI Swarm</div>
            <div className="col-span-1 text-center">Diff</div>
            <div className="col-span-2 text-center">Confidence</div>
          </div>

          {results.map((mc, idx) => {
            const isExpanded = expandedId === mc.market.id;
            const diff = mc.result ? mc.result.consensus - mc.market.yesPrice * 100 : 0;
            const trendColor = diff > 3 ? "text-[#3fb950]" : diff < -3 ? "text-[#f85149]" : "text-[#484f58]";

            return (
              <div key={mc.market.id} className={cn("border-b border-[#21262d] last:border-b-0", isExpanded && "bg-[#0d1117]/50")}>
                {/* Desktop row */}
                <div
                  className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3.5 items-center cursor-pointer hover:bg-[#1c2128]/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : mc.market.id)}
                >
                  <div className="col-span-5">
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] text-[#484f58] tabular-nums mt-0.5">{idx + 1}.</span>
                      <div>
                        <a
                          href={`${POLYMARKET_BASE_URL}/event/${mc.market.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-[#e6edf3] hover:text-[#58a6ff] font-medium leading-snug"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {mc.market.question}
                        </a>
                        <p className="text-[10px] text-[#484f58]">{formatVolume(mc.market.volume)} vol</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="text-base font-bold text-[#e6edf3] tabular-nums">{formatPercentage(mc.market.yesPrice)}</span>
                  </div>
                  <div className="col-span-2 text-center">
                    {mc.loading ? (
                      <span className="text-xs text-[#d29922] animate-pulse">...</span>
                    ) : mc.result ? (
                      <span className="text-base font-bold text-[#58a6ff] tabular-nums">{mc.result.consensus.toFixed(0)}%</span>
                    ) : (
                      <span className="text-xs text-[#f85149]">Error</span>
                    )}
                  </div>
                  <div className="col-span-1 text-center">
                    {mc.result && (
                      <span className={cn("text-xs font-semibold tabular-nums", trendColor)}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="col-span-2">
                    {mc.result && (
                      <div className="h-1.5 bg-[#21262d] rounded-full">
                        <div className="h-1.5 rounded-full bg-[#58a6ff] transition-all duration-700" style={{ width: `${mc.result.confidence}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Mobile card */}
                <div
                  className="sm:hidden px-4 py-3 cursor-pointer hover:bg-[#1c2128]/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : mc.market.id)}
                >
                  <p className="text-[13px] text-[#e6edf3] font-medium leading-snug">
                    {idx + 1}. {mc.market.question}
                  </p>
                  <div className="flex items-center gap-4 mt-2">
                    <div>
                      <span className="text-[10px] text-[#484f58]">Market</span>
                      <p className="text-sm font-bold text-[#e6edf3] tabular-nums">{formatPercentage(mc.market.yesPrice)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#484f58]">AI Swarm</span>
                      {mc.loading ? (
                        <p className="text-sm text-[#d29922] animate-pulse">...</p>
                      ) : mc.result ? (
                        <p className="text-sm font-bold text-[#58a6ff] tabular-nums">{mc.result.consensus.toFixed(0)}%</p>
                      ) : (
                        <p className="text-sm text-[#f85149]">Error</p>
                      )}
                    </div>
                    {mc.result && (
                      <span className={cn("text-xs font-semibold tabular-nums", trendColor)}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                      </span>
                    )}
                    <span className="text-[10px] text-[#484f58] ml-auto">{formatVolume(mc.market.volume)}</span>
                  </div>
                </div>

                {/* Agent breakdown */}
                {isExpanded && mc.result && (
                  <div className="px-4 pb-4 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      {mc.result.agents.map((agent) => {
                        const agentDiff = agent.probability - mc.market.yesPrice * 100;
                        return (
                          <div key={agent.agent} className="rounded-md bg-[#161b22] border border-[#21262d] p-3">
                            <p className="text-[10px] text-[#768390] font-medium">{agent.agent}</p>
                            <p className="text-lg font-bold text-white tabular-nums mt-0.5">{agent.probability}%</p>
                            <p className={cn("text-[10px]", agentDiff > 0 ? "text-[#3fb950]" : agentDiff < 0 ? "text-[#f85149]" : "text-[#484f58]")}>
                              {agentDiff > 0 ? "+" : ""}{agentDiff.toFixed(0)}% vs market
                            </p>
                            <p className="text-[10px] text-[#484f58] mt-1 line-clamp-2">{agent.reasoning}</p>
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
