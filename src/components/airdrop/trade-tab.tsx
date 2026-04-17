"use client";

import { useMemo } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket";
import { parseMarketPrices, PolymarketEvent } from "@/types/polymarket";
import { TradableMarketsTab } from "@/app/trade/page";

// Thin wrapper around TradableMarketsTab that supplies the event/market
// data the shared component expects. Same data shape the /trade page
// uses — filter out markets whose mid-price is saturated (>0.99 or
// <0.01) since those aren't fun to trade.
//
// Phase 9 drops the /trade page and this import will move to a
// neutral component file, but for now re-exporting from page.tsx
// keeps the diff contained.
export function AirdropTradeTab() {
  const { data: events, isLoading } = usePolymarketEvents({ limit: "50" });

  const allMarkets = useMemo(() => {
    if (!events) return [];
    return (events as PolymarketEvent[])
      .flatMap((e) => (e.markets || []).map((m) => parseMarketPrices(m)))
      .filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  }, [events]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[#d4a843]/20 bg-[#161b22] p-10 text-center">
        <p className="text-xs text-[#768390]">Loading markets…</p>
      </div>
    );
  }

  return <TradableMarketsTab allMarkets={allMarkets} events={(events || []) as PolymarketEvent[]} onBought={() => {}} />;
}
