"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Fetches the user's position(s) from Polymarket's /positions data-api for
 * their proxy wallet. Returns a lookup map keyed by CLOB token id so the
 * bet slip can answer "how many shares do I hold of this outcome?" without
 * making one request per token.
 *
 * Cached 10s, refetched every 30s — aligned with portfolio refresh cadence.
 * Bet slip is interactive so a slight staleness is fine; the user can't
 * sell faster than the refetch anyway.
 */

interface ClobPosition {
  asset: string;        // CLOB token id
  size: number;         // shares held
  avgPrice: number;
  curPrice?: number;
  currentValue?: number;
  title?: string;
  outcome?: string;
}

export function useUserPosition(proxyAddress: string | undefined) {
  return useQuery<{ byTokenId: Record<string, ClobPosition> }>({
    queryKey: ["polymarket-positions-lookup", proxyAddress],
    queryFn: async () => {
      if (!proxyAddress) return { byTokenId: {} };
      const res = await fetch(`/api/polymarket/positions?user=${proxyAddress}`);
      if (!res.ok) return { byTokenId: {} };
      const data = await res.json();
      const positions: ClobPosition[] = data.positions || [];
      const byTokenId: Record<string, ClobPosition> = {};
      for (const p of positions) {
        if (p.asset) byTokenId[p.asset] = p;
      }
      return { byTokenId };
    },
    enabled: !!proxyAddress,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
