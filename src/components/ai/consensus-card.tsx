"use client";

import { MarketWithPrices, formatPercentage, formatVolume } from "@/types/polymarket";
import { POLYMARKET_BASE_URL } from "@/lib/constants";

interface ConsensusData {
  consensus: number;
  confidence: number;
  trend: "up" | "down" | "flat";
}

function generateConsensus(market: MarketWithPrices): ConsensusData {
  const variation = (Math.random() - 0.5) * 0.1;
  const consensus = Math.max(0.01, Math.min(0.99, market.yesPrice + variation));
  const confidence = 40 + Math.random() * 50;
  const trend = variation > 0.03 ? "up" : variation < -0.03 ? "down" : "flat";
  return { consensus, confidence, trend };
}

export function ConsensusCard({
  market,
  newsKeywords = [],
}: {
  market: MarketWithPrices;
  newsKeywords?: string[];
}) {
  const consensus = generateConsensus(market);
  const text = `${market.question} ${market.description || ""}`.toLowerCase();
  const isNewsRelated = newsKeywords.some((kw) => text.includes(kw));

  const trendColor = consensus.trend === "up" ? "text-[#3fb950]" : consensus.trend === "down" ? "text-[#f85149]" : "text-[#484f58]";
  const trendArrow = consensus.trend === "up" ? "\u2191" : consensus.trend === "down" ? "\u2193" : "\u2014";

  return (
    <a
      href={`${POLYMARKET_BASE_URL}/event/${market.slug || market.conditionId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-[#21262d] bg-[#161b22] p-4 hover:border-[#30363d] transition-colors"
    >
      <p className="text-[13px] font-medium text-[#e6edf3] leading-snug line-clamp-2 min-h-[2.5rem]">
        {market.question || market.groupItemTitle}
      </p>

      <div className="flex items-baseline gap-2 mt-3">
        <span className="text-2xl font-bold text-white tabular-nums">
          {formatPercentage(consensus.consensus)}
        </span>
        <span className="text-xs text-[#768390]">Yes</span>
        <span className={`text-xs font-medium ${trendColor}`}>{trendArrow}</span>
      </div>

      {/* Confidence bar */}
      <div className="mt-3">
        <div className="flex justify-between text-[10px] text-[#484f58] mb-1">
          <span>Confidence</span>
          <span>{consensus.confidence >= 70 ? "High" : consensus.confidence >= 45 ? "Medium" : "Low"}</span>
        </div>
        <div className="h-1 bg-[#21262d] rounded-full">
          <div
            className="h-1 rounded-full bg-[#58a6ff]"
            style={{ width: `${consensus.confidence}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px]">
        <span className="text-[#484f58]">
          Market: <span className="text-[#768390]">{formatPercentage(market.yesPrice)}</span>
          {" \u00b7 "}
          {formatVolume(market.volume)} Vol
        </span>
        {isNewsRelated && (
          <span className="text-[#d29922] bg-[#d29922]/10 px-1.5 py-0.5 rounded text-[10px]">
            In News
          </span>
        )}
      </div>
    </a>
  );
}
