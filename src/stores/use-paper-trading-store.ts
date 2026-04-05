"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Position, Trade, AirdropRecord } from "@/types/trading";
import { STARTING_BALANCE, AIRDROP_AMOUNTS } from "@/lib/constants";

interface PaperTradingState {
  balance: number;
  positions: Position[];
  tradeHistory: Trade[];
  airdrops: AirdropRecord[];
  lastDailyAirdrop: string | null;
  lastWeeklyAirdrop: string | null;
  hasSignupAirdrop: boolean;
  referralCode: string;

  buyShares: (
    marketId: string,
    marketQuestion: string,
    outcome: string,
    shares: number,
    price: number
  ) => boolean;
  sellShares: (
    marketId: string,
    outcome: string,
    shares: number,
    price: number
  ) => boolean;
  claimDailyAirdrop: () => boolean;
  claimWeeklyAirdrop: () => boolean;
  claimSignupAirdrop: () => boolean;
  resetPortfolio: () => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function generateReferralCode(): string {
  return "PS-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

export const usePaperTradingStore = create<PaperTradingState>()(
  persist(
    (set, get) => ({
      balance: STARTING_BALANCE,
      positions: [],
      tradeHistory: [],
      airdrops: [],
      lastDailyAirdrop: null,
      lastWeeklyAirdrop: null,
      hasSignupAirdrop: false,
      referralCode: generateReferralCode(),

      buyShares: (marketId, marketQuestion, outcome, shares, price) => {
        const cost = shares * price;
        if (cost > get().balance) return false;

        const existingIdx = get().positions.findIndex(
          (p) => p.marketId === marketId && p.outcome === outcome
        );

        set((state) => {
          const newPositions = [...state.positions];
          if (existingIdx >= 0) {
            const existing = newPositions[existingIdx];
            const totalShares = existing.shares + shares;
            const totalCost =
              existing.shares * existing.avgPrice + shares * price;
            newPositions[existingIdx] = {
              ...existing,
              shares: totalShares,
              avgPrice: totalCost / totalShares,
            };
          } else {
            newPositions.push({
              marketId,
              marketQuestion,
              outcome,
              shares,
              avgPrice: price,
              timestamp: Date.now(),
            });
          }

          return {
            balance: state.balance - cost,
            positions: newPositions,
            tradeHistory: [
              {
                id: generateId(),
                marketId,
                marketQuestion,
                outcome,
                side: "buy",
                shares,
                price,
                timestamp: Date.now(),
              },
              ...state.tradeHistory,
            ],
          };
        });
        return true;
      },

      sellShares: (marketId, outcome, shares, price) => {
        const posIdx = get().positions.findIndex(
          (p) => p.marketId === marketId && p.outcome === outcome
        );
        if (posIdx < 0) return false;
        const pos = get().positions[posIdx];
        if (shares > pos.shares) return false;

        set((state) => {
          const newPositions = [...state.positions];
          if (shares === pos.shares) {
            newPositions.splice(posIdx, 1);
          } else {
            newPositions[posIdx] = {
              ...pos,
              shares: pos.shares - shares,
            };
          }

          return {
            balance: state.balance + shares * price,
            positions: newPositions,
            tradeHistory: [
              {
                id: generateId(),
                marketId,
                marketQuestion: pos.marketQuestion,
                outcome,
                side: "sell",
                shares,
                price,
                timestamp: Date.now(),
              },
              ...state.tradeHistory,
            ],
          };
        });
        return true;
      },

      claimDailyAirdrop: () => {
        const today = new Date().toDateString();
        if (get().lastDailyAirdrop === today) return false;

        set((state) => ({
          balance: state.balance + AIRDROP_AMOUNTS.daily,
          lastDailyAirdrop: today,
          airdrops: [
            {
              id: generateId(),
              source: "daily",
              amount: AIRDROP_AMOUNTS.daily,
              timestamp: Date.now(),
            },
            ...state.airdrops,
          ],
        }));
        return true;
      },

      claimWeeklyAirdrop: () => {
        return false; // Weekly airdrop removed
      },

      claimSignupAirdrop: () => {
        if (get().hasSignupAirdrop) return false;

        set((state) => ({
          balance: state.balance + AIRDROP_AMOUNTS.signup,
          hasSignupAirdrop: true,
          airdrops: [
            {
              id: generateId(),
              source: "signup",
              amount: AIRDROP_AMOUNTS.signup,
              timestamp: Date.now(),
            },
            ...state.airdrops,
          ],
        }));
        return true;
      },

      resetPortfolio: () =>
        set({
          balance: STARTING_BALANCE,
          positions: [],
          tradeHistory: [],
          airdrops: [],
          lastDailyAirdrop: null,
          lastWeeklyAirdrop: null,
          hasSignupAirdrop: false,
        }),
    }),
    { name: "polystream-paper-trading" }
  )
);
