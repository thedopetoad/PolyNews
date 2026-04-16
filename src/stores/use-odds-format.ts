"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OddsFormat } from "@/lib/odds-format";

/**
 * User-selected odds format, persisted across sessions so "American" sticks
 * once a sports bettor picks it. Consumed everywhere odds are displayed
 * (game cards, bet slip outcome chips, order book, expanded-row spreads).
 *
 * Default "price" matches Polymarket's native cents display.
 */
interface OddsFormatState {
  format: OddsFormat;
  setFormat: (format: OddsFormat) => void;
  showSpreadsTotals: boolean;
  toggleSpreadsTotals: () => void;
}

export const useOddsFormat = create<OddsFormatState>()(
  persist(
    (set) => ({
      format: "price",
      setFormat: (format) => set({ format }),
      showSpreadsTotals: true,
      toggleSpreadsTotals: () => set((s) => ({ showSpreadsTotals: !s.showSpreadsTotals })),
    }),
    { name: "polystream-odds-format" },
  ),
);
