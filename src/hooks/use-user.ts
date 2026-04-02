"use client";

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DbUser {
  id: string;
  displayName: string | null;
  authMethod: string;
  walletAddress: string | null;
  referralCode: string;
  referredBy: string | null;
  balance: number;
  createdAt: string;
  lastLoginAt: string;
  lastDailyAirdrop: string | null;
  lastWeeklyAirdrop: string | null;
  hasSignupAirdrop: boolean;
}

export interface DbPosition {
  id: string;
  userId: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  shares: number;
  avgPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface DbTrade {
  id: string;
  userId: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  side: string;
  shares: number;
  price: number;
  createdAt: string;
}

async function fetchOrCreateUser(address: string): Promise<DbUser> {
  // Try to get existing user
  const getRes = await fetch(`/api/user?id=${address}`);
  if (getRes.ok) return getRes.json();

  // Create new user
  const createRes = await fetch("/api/user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: address,
      authMethod: "wallet",
      walletAddress: address,
    }),
  });
  if (!createRes.ok) throw new Error("Failed to create user");
  return createRes.json();
}

async function fetchPositions(userId: string): Promise<DbPosition[]> {
  const res = await fetch(`/api/user/positions?userId=${userId}`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchTrades(userId: string): Promise<DbTrade[]> {
  const res = await fetch(`/api/user/trades?userId=${userId}`);
  if (!res.ok) return [];
  return res.json();
}

export function useUser() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();

  const userQuery = useQuery({
    queryKey: ["user", address],
    queryFn: () => fetchOrCreateUser(address!),
    enabled: !!address && isConnected,
    staleTime: 30_000,
  });

  const positionsQuery = useQuery({
    queryKey: ["positions", address],
    queryFn: () => fetchPositions(address!),
    enabled: !!address && isConnected,
    staleTime: 10_000,
  });

  const tradesQuery = useQuery({
    queryKey: ["trades", address],
    queryFn: () => fetchTrades(address!),
    enabled: !!address && isConnected,
    staleTime: 10_000,
  });

  const tradeMutation = useMutation({
    mutationFn: async (params: {
      marketId: string;
      marketQuestion: string;
      outcome: string;
      side: "buy" | "sell";
      shares: number;
      price: number;
    }) => {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: address, ...params }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Trade failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", address] });
      queryClient.invalidateQueries({ queryKey: ["positions", address] });
      queryClient.invalidateQueries({ queryKey: ["trades", address] });
    },
  });

  const airdropMutation = useMutation({
    mutationFn: async (type: "daily" | "weekly" | "signup") => {
      const res = await fetch("/api/airdrop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: address, type }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Airdrop claim failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", address] });
    },
  });

  return {
    user: userQuery.data || null,
    positions: positionsQuery.data || [],
    trades: tradesQuery.data || [],
    isConnected,
    isLoading: userQuery.isLoading,
    executeTrade: tradeMutation.mutateAsync,
    isTrading: tradeMutation.isPending,
    tradeError: tradeMutation.error?.message || null,
    claimAirdrop: airdropMutation.mutateAsync,
    isClaimingAirdrop: airdropMutation.isPending,
  };
}
