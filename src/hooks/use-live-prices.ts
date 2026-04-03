"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MarketWithPrices } from "@/types/polymarket";

interface PriceTarget {
  id: string;
  tokenId: string;
  fallbackYes: number;
  fallbackNo: number;
}

/**
 * Fetches live CLOB prices for specific markets every 15 seconds.
 * Returns a map of marketId -> { yesPrice, noPrice }.
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

  const getPrice = useCallback(
    (market: MarketWithPrices) => {
      const live = prices[market.id];
      return live || { yesPrice: market.yesPrice, noPrice: market.noPrice };
    },
    [prices]
  );

  return { prices, getPrice };
}

/**
 * Fetches live CLOB prices using stored clobTokenIds from positions.
 * Works even if the market is no longer in the events API.
 */
export function usePositionLivePrices(targets: PriceTarget[]) {
  const [prices, setPrices] = useState<Record<string, { yesPrice: number; noPrice: number }>>({});
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const fetchPrices = useCallback(async () => {
    const current = targetsRef.current;
    if (current.length === 0) return;

    const updates: Record<string, { yesPrice: number; noPrice: number }> = {};

    await Promise.all(
      current.map(async (t) => {
        if (!t.tokenId) return;
        try {
          const res = await fetch(`/api/polymarket/prices?token_id=${t.tokenId}`);
          if (!res.ok) return;
          const data = await res.json();
          const mid = parseFloat(data.mid);
          if (mid > 0 && mid < 1) {
            updates[t.id] = { yesPrice: mid, noPrice: 1 - mid };
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

  const getPrice = useCallback(
    (id: string, fallbackYes: number, fallbackNo: number) => {
      const live = prices[id];
      return live || { yesPrice: fallbackYes, noPrice: fallbackNo };
    },
    [prices]
  );

  return { prices, getPrice };
}
