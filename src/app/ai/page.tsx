"use client";

import { useEffect, useState } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { PolymarketEvent, MarketWithPrices, formatPercentage, formatVolume } from "@/types/polymarket";
import { getTopConsensusMarkets } from "@/lib/market-filters";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import Link from "next/link";

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    const interval = setInterval(() => {
      const ms = 5 * 60 * 60 * 1000;
      const remaining = ms - (Date.now() % ms);
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  return timeLeft;
}

interface ConsensusResult {
  consensus: number;
  confidence: number;
  trend: string;
  debateShift: number;
  round1Avg: number;
  round3Avg: number;
}

interface MarketConsensus {
  market: MarketWithPrices;
  result: ConsensusResult | null;
  loading: boolean;
}

export default function AIConsensusPage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "50" });
  const [results, setResults] = useState<MarketConsensus[]>([]);
  const [running, setRunning] = useState(false);
  const countdown = useCountdown();

  const topMarkets = events ? getTopConsensusMarkets(events as PolymarketEvent[]) : [];

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
              body: JSON.stringify({ marketQuestion: market.question, currentYesPrice: market.yesPrice }),
            });
            if (!res.ok) throw new Error();
            return { market, result: await res.json() as ConsensusResult, loading: false };
          } catch {
            return { market, result: null, loading: false };
          }
        })
      );
      setResults(fetched);
      setRunning(false);
    };
    run();
  }, [topMarkets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-4 relative min-h-screen">
      <div className="flex items-start justify-between mb-6 relative z-10">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Swarm Consensus</h1>
          <p className="mt-1 text-sm text-[#768390] max-w-xl">
            Top 10 markets ending in 1-8 weeks, filtered by volume and category diversity. 100,000 AI agents debate each across 3 rounds.{" "}
            <Link href="/docs#ai-consensus" className="text-[#58a6ff] hover:underline">Learn how it works</Link>
          </p>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Next run</p>
          <p className="text-lg font-bold text-[#58a6ff] tabular-nums">{countdown}</p>
        </div>
      </div>

      {/* Plexus dots as page background */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-30 overflow-hidden">
        <SwarmVisualization className="!h-full" />
      </div>

      {/* Results */}
      {isLoading ? (
        <p className="text-sm text-[#484f58] text-center py-16 relative z-10">Loading markets...</p>
      ) : (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden relative z-10">
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[#21262d] text-[10px] text-[#484f58] uppercase tracking-wider">
            <div className="col-span-5">Market</div>
            <div className="col-span-2 text-center">Market</div>
            <div className="col-span-3 text-center">AI Swarm Says</div>
            <div className="col-span-2 text-center">Diff</div>
          </div>

          {results.length === 0 && !running && (
            <p className="text-sm text-[#484f58] text-center py-12">No qualifying markets found</p>
          )}

          {results.map((mc, idx) => {
            const diff = mc.result ? mc.result.consensus - mc.market.yesPrice * 100 : 0;
            const trendColor = diff > 3 ? "text-[#3fb950]" : diff < -3 ? "text-[#f85149]" : "text-[#484f58]";
            const marketUrl = `${POLYMARKET_BASE_URL}/event/${mc.market.eventSlug || mc.market.slug}`;

            return (
              <div key={mc.market.id} className="border-b border-[#21262d] last:border-b-0">
                {/* Desktop */}
                <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-4 items-center">
                  <div className="col-span-5">
                    <a
                      href={marketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-[#e6edf3] hover:text-[#58a6ff] font-medium leading-snug"
                    >
                      {idx + 1}. {mc.market.question}
                    </a>
                    <p className="text-[10px] text-[#484f58] mt-0.5">
                      {formatVolume(mc.market.volume)} vol &middot; Ends {new Date(mc.market.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="text-lg font-bold text-[#e6edf3] tabular-nums">{formatPercentage(mc.market.yesPrice)}</span>
                  </div>
                  <div className="col-span-3 text-center">
                    {mc.loading ? (
                      <span className="text-sm text-[#d29922] animate-pulse">Debating...</span>
                    ) : mc.result ? (
                      <span className="text-lg font-bold text-[#58a6ff] tabular-nums">{mc.result.consensus.toFixed(0)}%</span>
                    ) : (
                      <span className="text-sm text-[#f85149]">Failed</span>
                    )}
                  </div>
                  <div className="col-span-2 text-center">
                    {mc.result && (
                      <span className={cn("text-sm font-semibold tabular-nums", trendColor)}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile */}
                <a
                  href={marketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sm:hidden block px-4 py-3 hover:bg-[#1c2128] transition-colors"
                >
                  <p className="text-[13px] text-[#e6edf3] font-medium">{idx + 1}. {mc.market.question}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <div>
                      <span className="text-[10px] text-[#484f58]">Market</span>
                      <p className="text-sm font-bold text-[#e6edf3]">{formatPercentage(mc.market.yesPrice)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#484f58]">AI Swarm</span>
                      {mc.loading ? (
                        <p className="text-sm text-[#d29922]">...</p>
                      ) : mc.result ? (
                        <p className="text-sm font-bold text-[#58a6ff]">{mc.result.consensus.toFixed(0)}%</p>
                      ) : (
                        <p className="text-sm text-[#f85149]">Failed</p>
                      )}
                    </div>
                    {mc.result && (
                      <span className={cn("text-xs font-semibold", trendColor)}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </a>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[11px] text-[#484f58] mt-2 mb-0 relative z-10">
        Powered by 100,000 AI agents across 3 debate rounds.{" "}
        <Link href="/docs#ai-consensus" className="text-[#58a6ff] hover:underline">How does this work?</Link>
      </p>
    </div>
  );
}
