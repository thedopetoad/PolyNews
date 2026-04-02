"use client";

import { HeroSection } from "@/components/home/hero-section";
import { LiveStreamPlayer } from "@/components/home/live-stream-player";
import { NewsFeed } from "@/components/home/news-feed";
import { MarketTicker } from "@/components/home/market-ticker";

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
      <HeroSection />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LiveStreamPlayer />
        </div>
        <div className="lg:col-span-1">
          <NewsFeed />
        </div>
      </div>

      <div className="mt-8">
        <MarketTicker />
      </div>
    </div>
  );
}
