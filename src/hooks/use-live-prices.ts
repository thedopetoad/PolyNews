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
 * `ready` is false until the first fetch completes.
 */
export function useLivePrices(markets: MarketWithPrices[]) {
  const [prices, setPrices] = useState<Record<string, { yesPrice: number; noPrice: number }>>({});
  const [ready, setReady] = useState(false);
  const marketIds = markets.map((m) => m.id).join(",");

  const fetchPrices = useCallback(async (mkts: MarketWithPrices[]) => {
    if (mkts.length === 0) return;

    const updates: Record<string, { yesPrice: number; noPrice: number }> = {};

    await Promise.all(
      mkts.map(async (market) => {
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
    setReady(true);
  }, []);

  // Re-fetch immediately when markets change, and poll every 15s
  useEffect(() => {
    if (markets.length === 0) return;
    setReady(false);
    fetchPrices(markets);
    const interval = setInterval(() => fetchPrices(markets), 5000);
    return () => clearInterval(interval);
  }, [marketIds, fetchPrices]); // eslint-disable-line react-hooks/exhaustive-deps

  const getPrice = useCallback(
    (market: MarketWithPrices) => {
      const live = prices[market.id];
      return live || { yesPrice: market.yesPrice, noPrice: market.noPrice };
    },
    [prices]
  );

  return { prices, getPrice, ready };
}

/**
 * Fetches live CLOB prices using stored clobTokenIds from positions.
 * Works even if the market is no longer in the events API.
 */
export function usePositionLivePrices(targets: PriceTarget[]) {
  const [prices, setPrices] = useState<Record<string, { yesPrice: number; noPrice: number }>>({});
  const [ready, setReady] = useState(false);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const fetchPrices = useCallback(async () => {
    const current = targetsRef.current;
    if (current.length === 0) { setReady(true); return; }

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
    setReady(true);
  }, []);

  useEffect(() => {
    setReady(false);
    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const getPrice = useCallback(
    (id: string, fallbackYes: number, fallbackNo: number) => {
      const live = prices[id];
      return live || { yesPrice: fallbackYes, noPrice: fallbackNo };
    },
    [prices]
  );

  return { prices, getPrice, ready };
}
