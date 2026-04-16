"use client";

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/use-auth-store";

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
  clobTokenId: string | null;
  marketEndDate: string | null;
  eventSlug: string | null;
  tradeType?: string;      // "paper" (default) or "real"
  clobOrderId?: string | null;
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

function authHeaders(address: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${address}`,
  };
}

async function fetchOrCreateUser(address: string, authMethod: string = "wallet"): Promise<DbUser> {
  const getRes = await fetch(`/api/user?id=${address}`, {
    headers: { Authorization: `Bearer ${address}` },
  });
  if (getRes.ok) return getRes.json();

  const createRes = await fetch("/api/user", {
    method: "POST",
    headers: authHeaders(address),
    body: JSON.stringify({
      id: address,
      authMethod,
      walletAddress: address,
    }),
  });
  if (!createRes.ok) throw new Error("Failed to create user");
  return createRes.json();
}

async function fetchPositions(userId: string): Promise<DbPosition[]> {
  const res = await fetch(`/api/user/positions?userId=${userId}`, {
    headers: { Authorization: `Bearer ${userId}` },
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchTrades(userId: string): Promise<DbTrade[]> {
  const res = await fetch(`/api/user/trades?userId=${userId}`, {
    headers: { Authorization: `Bearer ${userId}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export function useUser() {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  const queryClient = useQueryClient();

  // Prefer Google (Magic) address when it's set — otherwise a wallet connected
  // for side tasks (e.g. Phantom inside the LI.FI deposit widget) would hijack
  // the primary identity via wagmi's active-account state. Explicit logout
  // clears googleAddress so the user can switch identities intentionally.
  const address = googleAddress || wagmiAddress;
  const isConnected = !!(googleAddress || wagmiConnected);
  const authMethod = googleAddress ? "google" : "wallet";

  const userQuery = useQuery({
    queryKey: ["user", address],
    queryFn: () => fetchOrCreateUser(address!, authMethod),
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
      clobTokenId?: string;
      marketEndDate?: string;
      eventSlug?: string;
    }) => {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: authHeaders(address!),
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

  const displayNameMutation = useMutation({
    mutationFn: async (displayName: string) => {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: authHeaders(address!),
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update name");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", address] });
    },
  });

  const airdropMutation = useMutation({
    mutationFn: async (type: "daily" | "signup") => {
      const res = await fetch("/api/airdrop", {
        method: "POST",
        headers: authHeaders(address!),
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
    address: address || null,
    executeTrade: tradeMutation.mutateAsync,
    isTrading: tradeMutation.isPending,
    tradeError: tradeMutation.error?.message || null,
    claimAirdrop: airdropMutation.mutateAsync,
    isClaimingAirdrop: airdropMutation.isPending,
    setDisplayName: displayNameMutation.mutateAsync,
    isSettingName: displayNameMutation.isPending,
  };
}
