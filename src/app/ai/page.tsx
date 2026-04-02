"use client";

import { useMemo, useState } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { useNewsStore } from "@/stores/use-news-store";
import { parseMarketPrices, PolymarketEvent, MarketWithPrices } from "@/types/polymarket";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";
import { ConsensusCard } from "@/components/ai/consensus-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "news" | "confidence";

export default function AIConsensusPage() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "40" });
  const keywords = useNewsStore((s) => s.keywords);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const allMarkets = useMemo(() => {
    if (!events) return [];
    return events.flatMap((e: PolymarketEvent) =>
      (e.markets || []).map((m) => parseMarketPrices(m))
    );
  }, [events]);

  const filteredMarkets = useMemo(() => {
    let markets = allMarkets;

    if (search) {
      const q = search.toLowerCase();
      markets = markets.filter(
        (m) => m.question?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)
      );
    }

    if (activeTab === "news") {
      markets = markets.filter((m: MarketWithPrices) => {
        const text = `${m.question} ${m.description || ""}`.toLowerCase();
        return keywords.some((kw: string) => text.includes(kw));
      });
    }

    markets.sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"));

    if (activeTab === "confidence") {
      markets.sort((a, b) => Math.abs(b.yesPrice - 0.5) - Math.abs(a.yesPrice - 0.5));
    }

    return markets.slice(0, 24);
  }, [allMarkets, search, activeTab, keywords]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "news", label: "In News" },
    { key: "confidence", label: "High Confidence" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">AI Consensus</h1>
        <p className="mt-1 text-sm text-[#768390] max-w-xl">
          Multi-agent swarm analysis inspired by OASIS research. Each market is evaluated by independent AI agents, then aggregated into a consensus prediction.
        </p>
      </div>

      {/* Swarm viz */}
      <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden mb-6">
        <div className="px-4 py-2 border-b border-[#21262d] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
          <span className="text-[11px] text-[#484f58]">Swarm Agent Network</span>
        </div>
        <SwarmVisualization />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5">
        <div className="flex gap-0.5 bg-[#161b22] rounded-lg border border-[#21262d] p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-[#1c2128] text-white"
                  : "text-[#768390] hover:text-[#adbac7]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Input
          placeholder="Search markets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs max-w-xs bg-[#161b22] border-[#21262d] text-[#e6edf3] placeholder:text-[#484f58]"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-[#484f58] text-center py-16">Running swarm analysis...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredMarkets.map((market) => (
            <ConsensusCard key={market.id} market={market} newsKeywords={keywords} />
          ))}
          {filteredMarkets.length === 0 && (
            <p className="col-span-full text-sm text-[#484f58] text-center py-16">No markets found</p>
          )}
        </div>
      )}
    </div>
  );
}
