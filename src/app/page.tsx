"use client";

import { HeroSection } from "@/components/home/hero-section";
import { LiveStreamPlayer } from "@/components/home/live-stream-player";
import { NewsFeed } from "@/components/home/news-feed";
import { MarketTicker } from "@/components/home/market-ticker";
import { SwarmVisualization } from "@/components/ai/swarm-visualization";

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 relative overflow-x-clip">
      {/* Plexus background */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-40">
        <SwarmVisualization className="h-screen" />
      </div>
      <div className="relative z-10">
      <HeroSection />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LiveStreamPlayer />
        </div>
        <div className="lg:col-span-1 relative">
          <div className="lg:absolute lg:inset-0">
            <NewsFeed className="h-full" />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <MarketTicker />
      </div>
      </div>
    </div>
  );
}
