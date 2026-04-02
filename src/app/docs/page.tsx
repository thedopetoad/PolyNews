"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SwarmDiagram } from "@/components/docs/swarm-diagram";
import { AIRDROP_AMOUNTS } from "@/lib/constants";

interface DocSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

const sections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: (
      <div className="space-y-3">
        <p>PolyStream combines live news with Polymarket prediction markets, AI consensus analysis, and paper trading.</p>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong className="text-[#e6edf3]">Connect your wallet</strong> using the button in the top right. Supports MetaMask, Coinbase Wallet, Phantom, WalletConnect, and Google.</li>
          <li><strong className="text-[#e6edf3]">Watch live news</strong> on the home page and see which prediction markets are related.</li>
          <li><strong className="text-[#e6edf3]">Check AI consensus</strong> for swarm intelligence predictions on each market.</li>
          <li><strong className="text-[#e6edf3]">Paper trade</strong> with virtual PST tokens to practice.</li>
        </ol>
      </div>
    ),
  },
  {
    id: "news-stream",
    title: "News Stream",
    content: (
      <div className="space-y-3">
        <p>The home page combines a live video feed with real-time headline analysis to surface relevant prediction markets.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">Live Stream</strong> &mdash; Multiple 24/7 news channels to choose from.</li>
          <li><strong className="text-[#e6edf3]">Headline Analysis</strong> &mdash; Keywords extracted from headlines are matched against active Polymarket markets.</li>
          <li><strong className="text-[#e6edf3]">Market Ticker</strong> &mdash; Matched markets scroll below the stream with live prices.</li>
        </ul>
        <p>A real-time audio transcription pipeline is planned for a future release.</p>
      </div>
    ),
  },
  {
    id: "ai-consensus",
    title: "AI Consensus",
    content: (
      <div className="space-y-4">
        <p>
          Imagine you have a really hard question, like &quot;Will it rain tomorrow?&quot; If you ask one person, they might guess wrong. But if you ask 5 very different experts &mdash; a weather scientist, a farmer, a pilot, a fisherman, and a data nerd &mdash; and combine their answers, you&apos;ll probably get a much better answer.
        </p>
        <p>
          That&apos;s exactly what our AI Swarm does, but for prediction markets. We ask 5 AI agents with totally different &quot;personalities&quot; to predict the outcome of each market, then combine their answers into one consensus prediction.
        </p>
        <SwarmDiagram />
      </div>
    ),
  },
  {
    id: "paper-trading",
    title: "Paper Trading",
    content: (
      <div className="space-y-3">
        <p>Practice prediction market trading without risk. All markets mirror live Polymarket data.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Browse markets and click Buy Yes or Buy No.</li>
          <li>Enter shares, review cost, and confirm.</li>
          <li>Track your positions and P&amp;L in the portfolio tab.</li>
        </ul>
        <p>PST (PolyStream Tokens) are virtual and have no real value.</p>
      </div>
    ),
  },
  {
    id: "airdrop",
    title: "Airdrop & Referral",
    content: (
      <div className="space-y-3">
        <p>Earn virtual PST tokens:</p>
        <div className="bg-[#0d1117] rounded-md border border-[#21262d] divide-y divide-[#21262d]">
          {[
            ["Signup Bonus", `+${AIRDROP_AMOUNTS.signup.toLocaleString()} PST`],
            ["Daily Login", `+${AIRDROP_AMOUNTS.daily} PST/day`],
            ["Weekly Active", `+${AIRDROP_AMOUNTS.weekly} PST/week`],
            ["Referral Signup", `+${AIRDROP_AMOUNTS.referralBonus.toLocaleString()} PST`],
            ["Referral First Trade", `+${AIRDROP_AMOUNTS.referralFirstTrade} PST`],
          ].map(([label, amount]) => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-[#adbac7]">{label}</span>
              <span className="text-[#3fb950] font-medium text-xs">{amount}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "builder-program",
    title: "Builder Program",
    content: (
      <div className="space-y-3">
        <p>PolyStream participates in Polymarket&apos;s Builder Program for third-party integration.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Markets link directly to Polymarket for real trading.</li>
          <li>Future: trade directly from PolyStream via the Builder API.</li>
          <li>All market data comes from Polymarket&apos;s Gamma API in real time.</li>
        </ul>
      </div>
    ),
  },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState(sections[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-100px 0px -60% 0px" }
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Documentation</h1>
        <p className="mt-1 text-sm text-[#768390]">Everything you need to know about PolyStream.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="hidden lg:block">
          <nav className="sticky top-20 space-y-0.5">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
                }}
                className={cn(
                  "block px-3 py-1.5 rounded-md text-sm transition-colors",
                  activeSection === s.id
                    ? "text-white bg-[#1c2128]"
                    : "text-[#768390] hover:text-[#adbac7]"
                )}
              >
                {s.title}
              </a>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-6">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="rounded-lg border border-[#21262d] bg-[#161b22] p-6"
            >
              <h2 className="text-base font-semibold text-white mb-3">{s.title}</h2>
              <div className="text-sm text-[#768390] leading-relaxed">{s.content}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
