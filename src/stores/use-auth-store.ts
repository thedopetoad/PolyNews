"use client";

import { create } from "zustand";

/**
 * Unified auth store that tracks the connected address
 * regardless of whether it came from wagmi (wallet) or Web3Auth (Google).
 */
interface AuthState {
  googleAddress: string | null;
  setGoogleAddress: (address: string | null) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  googleAddress: null,
  setGoogleAddress: (address) => set({ googleAddress: address }),
}));
