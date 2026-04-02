"use client";

import { useState } from "react";
import { MarketWithPrices, formatPercentage, formatVolume } from "@/types/polymarket";
import { POLYMARKET_BASE_URL } from "@/lib/constants";

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

export function ConsensusCard({
  market,
  newsKeywords = [],
}: {
  market: MarketWithPrices;
  newsKeywords?: string[];
}) {
  const [result, setResult] = useState<ConsensusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAgents, setShowAgents] = useState(false);

  const text = `${market.question} ${market.description || ""}`.toLowerCase();
  const isNewsRelated = newsKeywords.some((kw) => text.includes(kw));

  const fetchConsensus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketQuestion: market.question,
          currentYesPrice: market.yesPrice,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const trendColor = result?.trend === "up" ? "text-[#3fb950]" : result?.trend === "down" ? "text-[#f85149]" : "text-[#484f58]";
  const trendArrow = result?.trend === "up" ? "\u2191" : result?.trend === "down" ? "\u2193" : "\u2014";

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <a
          href={`${POLYMARKET_BASE_URL}/event/${market.eventSlug || market.slug || market.conditionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-medium text-[#e6edf3] leading-snug line-clamp-2 min-h-[2.5rem] hover:text-[#58a6ff] transition-colors"
        >
          {market.question || market.groupItemTitle}
        </a>
        {isNewsRelated && (
          <span className="flex-shrink-0 text-[#d29922] bg-[#d29922]/10 px-1.5 py-0.5 rounded text-[10px]">
            News
          </span>
        )}
      </div>

      {/* Market price */}
      <div className="flex items-center gap-3 mt-2 text-xs text-[#484f58]">
        <span>Market: <span className="text-[#3fb950]">Yes {formatPercentage(market.yesPrice)}</span></span>
        <span>{formatVolume(market.volume)} Vol</span>
      </div>

      {/* Consensus result or button */}
      {result ? (
        <div className="mt-3 space-y-2">
          {/* Consensus number */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white tabular-nums">
              {result.consensus.toFixed(0)}%
            </span>
            <span className="text-xs text-[#768390]">AI Yes</span>
            <span className={`text-xs font-medium ${trendColor}`}>{trendArrow}</span>
          </div>

          {/* Confidence bar */}
          <div>
            <div className="flex justify-between text-[10px] text-[#484f58] mb-1">
              <span>Confidence</span>
              <span>{result.confidence}%{result.spread > 15 ? " (agents disagree)" : ""}</span>
            </div>
            <div className="h-1 bg-[#21262d] rounded-full">
              <div
                className="h-1 rounded-full bg-[#58a6ff] transition-all duration-500"
                style={{ width: `${result.confidence}%` }}
              />
            </div>
          </div>

          {/* Agent breakdown toggle */}
          <button
            onClick={() => setShowAgents(!showAgents)}
            className="text-[11px] text-[#58a6ff] hover:underline"
          >
            {showAgents ? "Hide" : "Show"} agent breakdown ({result.agents.length} agents)
          </button>

          {showAgents && (
            <div className="space-y-1.5 mt-1">
              {result.agents.map((agent) => (
                <div key={agent.agent} className="bg-[#0d1117] rounded p-2 border border-[#21262d]">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#adbac7] font-medium">{agent.agent}</span>
                    <span className="text-white tabular-nums">{agent.probability}%</span>
                  </div>
                  <p className="text-[10px] text-[#484f58] mt-1 line-clamp-2">
                    {agent.reasoning}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={fetchConsensus}
          disabled={loading}
          className="mt-3 w-full py-2 rounded-md text-xs font-medium bg-[#58a6ff]/10 text-[#58a6ff] hover:bg-[#58a6ff]/20 transition-colors disabled:opacity-50"
        >
          {loading ? "Running 5 agents..." : "Get AI Consensus"}
        </button>
      )}
    </div>
  );
}
