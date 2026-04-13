"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Unified auth store that tracks the connected address
 * regardless of whether it came from wagmi (wallet) or Web3Auth (Google).
 * Persisted to localStorage so sessions survive page refresh.
 */
interface AuthState {
  googleAddress: string | null;
  setGoogleAddress: (address: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      googleAddress: null,
      setGoogleAddress: (address) => set({ googleAddress: address }),
    }),
    { name: "polystream-auth" }
  )
);
