"use client";

import { useEffect, useState, useMemo } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { useLivePrices } from "@/hooks/use-live-prices";
import { PolymarketEvent, MarketWithPrices, formatPercentage, formatVolume } from "@/types/polymarket";
import { getTopConsensusMarkets } from "@/lib/market-filters";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { MiniPriceChart } from "@/components/mini-price-chart";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const countdown = useCountdown();

  const topMarkets = useMemo(() => events ? getTopConsensusMarkets(events as PolymarketEvent[]) : [], [events]);
  const { getPrice, ready: pricesReady } = useLivePrices(topMarkets);

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

      {/* Plexus stars as page background */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-30 overflow-hidden">
        <SwarmVisualization className="!h-full" shape="star" />
      </div>

      {/* Results */}
      {isLoading || !pricesReady ? (
        <p className="text-sm text-[#484f58] text-center py-16 relative z-10">Loading live prices...</p>
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
            const liveP = getPrice(mc.market);
            const liveYes = liveP.yesPrice;
            const diff = mc.result ? mc.result.consensus - liveYes * 100 : 0;
            const trendColor = diff > 3 ? "text-[#3fb950]" : diff < -3 ? "text-[#f85149]" : "text-[#484f58]";
            const marketUrl = `${POLYMARKET_BASE_URL}/event/${mc.market.eventSlug || mc.market.slug}`;
            const isExpanded = expandedId === mc.market.id;
            let tokenId = "";
            try { const ids = JSON.parse(mc.market.clobTokenIds || "[]"); tokenId = ids[0] || ""; } catch {}

            return (
              <div key={mc.market.id} className="border-b border-[#21262d] last:border-b-0 animate-fade-in-up" style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "backwards" }}>
                {/* Desktop */}
                <div
                  className="hidden sm:grid grid-cols-12 gap-2 px-4 py-4 items-center cursor-pointer hover:bg-[#1c2128]/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : mc.market.id)}
                >
                  <div className="col-span-5 flex items-start gap-2">
                    <svg className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0 mt-0.5", isExpanded && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <div>
                      <p className="text-[13px] text-[#e6edf3] hover:text-[#58a6ff] font-medium leading-snug">
                        {idx + 1}. {mc.market.question}
                      </p>
                      <p className="text-[10px] text-[#484f58] mt-0.5">
                        {formatVolume(mc.market.volume)} vol &middot; Ends {new Date(mc.market.endDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="text-lg font-bold text-[#e6edf3] tabular-nums">{formatPercentage(liveYes)}</span>
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
                <div
                  className="sm:hidden block px-4 py-3 hover:bg-[#1c2128] transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : mc.market.id)}
                >
                  <div className="flex items-start gap-2">
                    <svg className={cn("w-3 h-3 text-[#484f58] transition-transform flex-shrink-0 mt-0.5", isExpanded && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <p className="text-[13px] text-[#e6edf3] font-medium">{idx + 1}. {mc.market.question}</p>
                  </div>
                  <div className="flex items-center gap-4 mt-2 ml-5">
                    <div>
                      <span className="text-[10px] text-[#484f58]">Market</span>
                      <p className="text-sm font-bold text-[#e6edf3]">{formatPercentage(liveYes)}</p>
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
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 py-3 bg-[#0d1117] border-t border-[#21262d] space-y-3">
                    {tokenId ? (
                      <MiniPriceChart tokenId={tokenId} />
                    ) : (
                      <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">No price history</div>
                    )}
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <p className="text-[#484f58]">Volume</p>
                        <p className="text-[#e6edf3]">{formatVolume(mc.market.volume)}</p>
                      </div>
                      <div>
                        <p className="text-[#484f58]">End Date</p>
                        <p className="text-[#e6edf3]">{mc.market.endDate ? new Date(mc.market.endDate).toLocaleDateString() : "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-[#484f58]">AI Pick</p>
                        <p className="text-[#58a6ff]">{mc.result ? `${mc.result.consensus.toFixed(0)}%` : "N/A"}</p>
                      </div>
                    </div>
                    <a
                      href={marketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-[#58a6ff] hover:underline"
                    >
                      View on Polymarket
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[11px] text-[#484f58] mt-2 mb-0 relative z-10">
        Powered by 100,000 AI agents across 3 debate rounds.{" "}
        <Link href="/docs#ai-consensus" className="text-[#58a6ff] hover:underline">How does this work?</Link>
      </p>

      <div className="mt-8 rounded-lg border border-[#21262d] bg-[#161b22] p-6 text-center relative z-10">
        <h3 className="text-lg font-semibold text-white mb-1">Super Swarm</h3>
        <p className="text-sm text-[#768390] mb-3">Next-gen AI consensus with MiroFish integration</p>
        <Link href="/ai-beta" className="text-sm text-[#58a6ff] hover:underline">Coming Soon →</Link>
      </div>
    </div>
  );
}
