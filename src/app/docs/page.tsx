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
          We select the <strong className="text-[#e6edf3]">top 10 prediction markets</strong> ending in 1&ndash;8 weeks, filtered by volume (&ge;$100K), category diversity (max 3 per category), and quality (no joke/meme markets). Then 100,000 AI agents debate each one.
        </p>
        <p>
          The <a href="https://arxiv.org/abs/2411.11581" target="_blank" className="text-[#58a6ff] hover:underline">OASIS research paper</a> showed this works with up to <strong className="text-[#e6edf3]">1 million AI agents</strong> simulating social interactions to predict outcomes.
        </p>
        <h4 className="font-semibold text-[#e6edf3] mt-4">Our Implementation: 3-Round Debate System</h4>
        <p>We run a full inter-agent debate across 3 rounds, just like the OASIS model recommends:</p>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d] mt-3 mb-3">
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Round 1: Independent Predictions</p>
            <p className="text-xs mt-1">20 agent personas (Market Analyst, Economist, Contrarian, Historian, Devil&apos;s Advocate, and 15 more) each predict independently at 5 different &quot;creativity&quot; temperatures. That&apos;s <strong className="text-[#e6edf3]">100 real GPT-4o-mini predictions</strong> with zero groupthink &mdash; nobody sees anyone else&apos;s answer.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Round 2: The Debate</p>
            <p className="text-xs mt-1">All 100 agents now see a summary of Round 1: the average prediction, the strongest bull argument, and the strongest bear argument. Each agent can change their mind or double down. This is where the magic happens &mdash; contrarians challenge the consensus, risk assessors flag overconfidence, and the debate shifts the average. Another <strong className="text-[#e6edf3]">100 predictions</strong>.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Round 3: Final Calibrated Vote</p>
            <p className="text-xs mt-1">Agents see how the debate shifted the consensus (e.g. &quot;Pre-debate: 65% &rarr; Post-debate: 58%&quot;) and give their final, most calibrated prediction. Round 3 votes are weighted 3x heavier than Round 1 in the final consensus. Another <strong className="text-[#e6edf3]">100 predictions</strong>.</p>
          </div>
        </div>
        <h4 className="font-semibold text-[#e6edf3]">Scaling: 300 &rarr; 100,000</h4>
        <p>
          The 300 real predictions are bootstrapped (resampled with statistical noise) to simulate <strong className="text-[#e6edf3]">100,000 agents</strong>. This gives the consensus statistical validity without costing $50 per run. Each market costs about $0.05 in API calls. Results are cached in our database for 5 hours, so the swarm only runs ~5 times per day.
        </p>
        <h4 className="font-semibold text-[#e6edf3] mt-3">The 20 Agent Personas</h4>
        <div className="flex flex-wrap gap-1 mt-1">
          {["Market Analyst", "Political Strategist", "Contrarian", "News Analyst", "Risk Assessor", "Economist", "Geopolitical Expert", "Tech Analyst", "Behavioral Psychologist", "Statistician", "Historian", "Legal Scholar", "Sociologist", "Insurance Actuary", "Venture Capitalist", "Crypto Trader", "Military Strategist", "Climate Scientist", "Investigative Journalist", "Devil's Advocate"].map((name) => (
            <span key={name} className="text-[10px] text-[#768390] bg-[#1c2128] px-2 py-0.5 rounded border border-[#21262d]">{name}</span>
          ))}
        </div>
        <h4 className="font-semibold text-[#e6edf3] mt-3">Why Debate Matters</h4>
        <p>
          Without debate, you get 100 independent guesses averaged together. With debate, you get something closer to how real humans reach consensus &mdash; arguments are challenged, overconfidence gets checked, and the final number reflects genuine deliberation. The OASIS paper showed that this inter-agent interaction produces emergent social phenomena (group polarization, herd effects, information cascades) that mirror real human behavior.
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
        <p>Practice prediction market trading without risk using live Polymarket data.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Two-Tab Design</h4>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">Portfolio Tab</strong> &mdash; Shows your AIRDROP balance, daily claim, and all open positions with live P&amp;L calculated from current Polymarket odds.</li>
          <li><strong className="text-[#e6edf3]">Tradable Markets Tab</strong> &mdash; 15 curated markets: 10 from AI Swarm Consensus picks + 5 top sports markets ending soon.</li>
        </ul>
        <h4 className="font-semibold text-[#e6edf3] mt-2">How Trading Works</h4>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">Buy:</strong> Select a market, choose Yes or No, enter shares. You buy in at the current live Polymarket odds. Your buy-in price is stored in the database.</li>
          <li><strong className="text-[#e6edf3]">Close:</strong> In the Portfolio tab, click Close on any position. The system checks the live Polymarket odds and calculates your P&amp;L based on the price change since your buy-in.</li>
        </ul>
        <p>AIRDROP tokens are virtual and have no real value. Prices update every 60 seconds from the Polymarket CLOB API.</p>
      </div>
    ),
  },
  {
    id: "airdrop",
    title: "Airdrop & Referral",
    content: (
      <div className="space-y-3">
        <p>Earn virtual AIRDROP tokens:</p>
        <div className="bg-[#0d1117] rounded-md border border-[#21262d] divide-y divide-[#21262d]">
          {[
            ["Signup Bonus", `+${AIRDROP_AMOUNTS.signup.toLocaleString()} AIRDROP`],
            ["Daily Login", `+${AIRDROP_AMOUNTS.daily} AIRDROP/day`],
            ["Referral Signup", `+${AIRDROP_AMOUNTS.referralBonus.toLocaleString()} AIRDROP`],
            ["Referral First Trade", `+${AIRDROP_AMOUNTS.referralFirstTrade} AIRDROP`],
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
