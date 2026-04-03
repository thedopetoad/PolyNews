"use client";

import { useQuery } from "@tanstack/react-query";
import { PolymarketEvent, PolymarketMarket } from "@/types/polymarket";

async function fetchEvents(params?: Record<string, string>): Promise<PolymarketEvent[]> {
  const searchParams = new URLSearchParams({
    active: "true",
    limit: "50",
    ...params,
  });
  const res = await fetch(`/api/polymarket/events?${searchParams}`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}

async function fetchMarkets(params?: Record<string, string>): Promise<PolymarketMarket[]> {
  const searchParams = new URLSearchParams({
    active: "true",
    limit: "50",
    ...params,
  });
  const res = await fetch(`/api/polymarket/markets?${searchParams}`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  return res.json();
}

export function usePolymarketEvents(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["polymarket-events", params],
    queryFn: () => fetchEvents(params),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function usePolymarketMarkets(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["polymarket-markets", params],
    queryFn: () => fetchMarkets(params),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
