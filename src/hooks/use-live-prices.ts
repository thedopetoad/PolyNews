"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MarketWithPrices } from "@/types/polymarket";

/**
 * Fetches live CLOB prices for specific markets every 15 seconds.
 * Returns a map of marketId -> { yesPrice, noPrice }.
 * Use this for markets that may not get CLOB enrichment from the events API
 * (lower-volume markets that fall outside the top-100 enrichment cap).
 */
export function useLivePrices(markets: MarketWithPrices[]) {
  const [prices, setPrices] = useState<Record<string, { yesPrice: number; noPrice: number }>>({});
  const marketsRef = useRef(markets);
  marketsRef.current = markets;

  const fetchPrices = useCallback(async () => {
    const current = marketsRef.current;
    if (current.length === 0) return;

    const updates: Record<string, { yesPrice: number; noPrice: number }> = {};

    await Promise.all(
      current.map(async (market) => {
        if (!market.clobTokenIds) return;
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          if (!tokenIds[0]) return;
          const res = await fetch(`/api/polymarket/prices?token_id=${tokenIds[0]}`);
          if (!res.ok) return;
          const data = await res.json();
          const mid = parseFloat(data.mid);
          if (mid > 0 && mid < 1) {
            updates[market.id] = { yesPrice: mid, noPrice: 1 - mid };
          }
        } catch {}
      })
    );

    if (Object.keys(updates).length > 0) {
      setPrices((prev) => ({ ...prev, ...updates }));
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 15000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  // Return a function that gets the live price for a market, falling back to the market's own price
  const getPrice = useCallback(
    (market: MarketWithPrices) => {
      const live = prices[market.id];
      return live || { yesPrice: market.yesPrice, noPrice: market.noPrice };
    },
    [prices]
  );

  return { prices, getPrice };
}
