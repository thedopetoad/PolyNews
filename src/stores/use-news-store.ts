"use client";

import { create } from "zustand";

export interface NewsHeadline {
  title: string;
  description: string;
  source: string;
  url: string;
  publishedAt: string;
  keywords: string[];
  categories: string[];
}

interface NewsState {
  headlines: NewsHeadline[];
  keywords: string[];
  isLoading: boolean;
  lastFetched: number | null;
  setHeadlines: (headlines: NewsHeadline[]) => void;
  setKeywords: (keywords: string[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useNewsStore = create<NewsState>()((set) => ({
  headlines: [],
  keywords: [],
  isLoading: false,
  lastFetched: null,

  setHeadlines: (headlines) =>
    set({ headlines, lastFetched: Date.now() }),
  setKeywords: (keywords) => set({ keywords }),
  setLoading: (isLoading) => set({ isLoading }),
}));
