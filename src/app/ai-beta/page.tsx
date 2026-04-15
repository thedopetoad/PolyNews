"use client";

import Link from "next/link";
import { ParticleBackground } from "@/components/ai/particle-background";

export default function SuperSwarmPage() {
  return (
    <>
      <ParticleBackground shape="hexagon" opacity={0.3} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10">
      <div className="text-center space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="text-[10px] font-bold text-black bg-[#d29922] px-2 py-0.5 rounded">COMING SOON</span>
          <h1 className="text-3xl font-bold text-white">Super Swarm Prediction</h1>
        </div>

        <p className="text-[#768390] text-base max-w-xl mx-auto leading-relaxed">
          We are building a next-generation prediction engine powered by{" "}
          <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">MiroFish</a>
          {" "}swarm intelligence technology.
        </p>

        <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-8 text-left max-w-lg mx-auto space-y-4">
          <h3 className="text-sm font-semibold text-white">How it will work</h3>
          <div className="space-y-3 text-sm text-[#768390]">
            <div className="flex gap-3">
              <span className="text-[#d29922] font-bold flex-shrink-0">01</span>
              <p><strong className="text-[#e6edf3]">Knowledge Graph</strong> — Upload research documents and automatically extract entities, relationships, and context into a structured knowledge graph.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[#d29922] font-bold flex-shrink-0">02</span>
              <p><strong className="text-[#e6edf3]">Agent Generation</strong> — Hundreds of AI agents with unique personalities, backgrounds, and reasoning styles are created from the knowledge graph.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[#d29922] font-bold flex-shrink-0">03</span>
              <p><strong className="text-[#e6edf3]">Social Simulation</strong> — Agents interact on simulated Twitter, Reddit, and prediction markets — posting, arguing, forming opinions, and trading over dozens of rounds.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-[#d29922] font-bold flex-shrink-0">04</span>
              <p><strong className="text-[#e6edf3]">Prediction Report</strong> — A final analytical report synthesizes the simulation, citing what agents said, how opinions shifted, and where the edge lies vs Polymarket odds.</p>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-[#484f58]">
          Powered by MiroFish/MiroShark open-source swarm intelligence engine with local LLM inference.
        </p>

        <Link href="/ai" className="inline-block text-sm text-[#58a6ff] hover:underline">
          View current AI Consensus predictions
        </Link>
      </div>
      </div>
    </>
  );
}
