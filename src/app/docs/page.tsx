"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SwarmDiagram } from "@/components/docs/swarm-diagram";
import { ParticleBackground } from "@/components/ai/particle-background";
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
          <li><strong className="text-[#e6edf3]">Paper trade</strong> with virtual AIRDROP tokens to practice.</li>
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
        <h4 className="font-semibold text-[#e6edf3] mt-2">Live Stream</h4>
        <p>Watch 7 live news channels (Al Jazeera, FOX, ABC, CBS, DW News, The Young Turks, plus Alex Jones on Rumble) with a 4x multi-view mode.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Breaking News Feed</h4>
        <p>Headlines from 6 sources (BBC, NYT, Al Jazeera, Guardian, Sky News) plus OSINT intelligence from Telegram channels, updated every 5 minutes. Filter by source or category (Iran, Ukraine, Crypto, Finance, Politics, Tech).</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">AI-Powered Related Markets</h4>
        <p>Each headline is automatically matched to relevant Polymarket prediction markets using a 3-step AI pipeline:</p>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d] mt-2 mb-2">
          <div className="p-3">
            <p className="text-[#d29922] font-medium text-xs">Step 1: Keyword Extraction</p>
            <p className="text-xs mt-1">GPT-4o-mini reads each headline and extracts search keywords. &ldquo;Iran War Cease-Fire Tested&rdquo; becomes [&ldquo;iran&rdquo;, &ldquo;ceasefire&rdquo;, &ldquo;strait&rdquo;, &ldquo;hormuz&rdquo;].</p>
          </div>
          <div className="p-3">
            <p className="text-[#d29922] font-medium text-xs">Step 2: Market Search</p>
            <p className="text-xs mt-1">Those keywords are searched against 200+ active Polymarket events via the Gamma API. Only real, verified markets with active slugs are returned &mdash; no hallucinated URLs.</p>
          </div>
          <div className="p-3">
            <p className="text-[#d29922] font-medium text-xs">Step 3: AI Validation</p>
            <p className="text-xs mt-1">GPT validates each headline&ndash;market pair: &ldquo;Is this market actually about the same topic?&rdquo; Bad matches like &ldquo;Iran war&rdquo; &rarr; &ldquo;Iran FIFA World Cup&rdquo; are rejected.</p>
          </div>
        </div>
        <p>Headlines with matches show a gold <span className="text-[#d29922]">&#9733; See Related Markets</span> button. Click to expand and see up to 3 related markets with live Yes/No prices. Markets process incrementally &mdash; 3 headlines every 60 seconds, up to 20 total.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">AI Live Market Ticker</h4>
        <p>Below the stream, an AI-selected ticker shows the 8&ndash;10 Polymarket events most relevant to the current news cycle. Powered by GPT-4o-mini analyzing live stream titles and RSS headlines against 200+ active markets. Refreshes every 15 minutes.</p>
      </div>
    ),
  },
  {
    id: "ai-consensus",
    title: "AI Consensus",
    content: (
      <div className="space-y-4">
        <p>
          We select the <strong className="text-[#e6edf3]">top 10 prediction markets</strong> ending between 1 day and 3 months from now, filtered by volume (&ge;$50K), category diversity (max 4 per category, max 2 per topic), edge-price exclusion (drops anything below 5% or above 95%), and a quality blocklist (no Bigfoot, alien, rapture, etc.). Then 5 GPT-4o-mini personas debate each one across 3 rounds.
        </p>
        <h4 className="font-semibold text-[#e6edf3] mt-4">Our Implementation: 1 Web Search + 3-Round Debate</h4>
        <p>For each market we run a 4-step pipeline. All GPT calls use <code className="text-[#d29922] text-xs">gpt-4o-mini</code>.</p>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d] mt-3 mb-3">
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Step 0: Live Web Context</p>
            <p className="text-xs mt-1">Before the debate, we call OpenAI&apos;s Responses API with the <code className="text-[#d29922] text-[10px]">web_search_preview</code> tool to pull a 3&ndash;5 bullet summary of recent news, polls, or data relevant to the question. Capped at 800 chars and shared with every persona in the next 3 rounds.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Round 1: Independent Predictions</p>
            <p className="text-xs mt-1">5 personas (Market Analyst, Political Strategist, Contrarian, Risk Assessor, Historian) each see the question, the live YES price, and the web context, then independently return a probability + confidence + one-sentence reasoning. 5 parallel calls at temperature 0.8 &mdash; nobody sees anyone else&apos;s answer.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Round 2: The Debate</p>
            <p className="text-xs mt-1">All 5 personas now see the Round 1 average, the most bullish reasoning, and the most bearish reasoning, and decide whether to update or double down. 5 parallel calls at temperature 0.9.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Round 3: Final Calibrated Vote</p>
            <p className="text-xs mt-1">Personas see how much the consensus shifted between rounds (e.g. &ldquo;Pre-debate 65% &rarr; Post-debate 58%&rdquo;) and give one last calibrated answer. 5 parallel calls at temperature 0.7.</p>
          </div>
        </div>
        <h4 className="font-semibold text-[#e6edf3]">Aggregation</h4>
        <p>
          That&apos;s <strong className="text-[#e6edf3]">15 real GPT calls per market</strong>. The final number is a weighted average where every prediction is weighted by <strong className="text-[#e6edf3]">confidence &times; round number</strong>, so Round 3 votes count 3&times; heavier than Round 1. Reported confidence is then scaled down by 0.7 to reflect the small sample size. Each market costs roughly <strong className="text-[#e6edf3]">$0.01</strong> in API calls and results are cached in Postgres for 5 hours, so the swarm only re-runs about 5 times per day.
        </p>
        <h4 className="font-semibold text-[#e6edf3] mt-3">The 5 Personas</h4>
        <div className="flex flex-wrap gap-1 mt-1">
          {["Market Analyst", "Political Strategist", "Contrarian", "Risk Assessor", "Historian"].map((name) => (
            <span key={name} className="text-[10px] text-[#768390] bg-[#1c2128] px-2 py-0.5 rounded border border-[#21262d]">{name}</span>
          ))}
        </div>
        <h4 className="font-semibold text-[#e6edf3] mt-3">Why Debate Matters</h4>
        <p>
          Without debate you get 5 independent guesses averaged together. With debate the contrarian challenges the consensus, the risk assessor flags overconfidence, and the final number reflects deliberation rather than first instinct. The structure is loosely inspired by the <a href="https://arxiv.org/abs/2411.11581" target="_blank" className="text-[#58a6ff] hover:underline">OASIS framework</a> &mdash; OASIS itself simulates up to 1 million social-network agents, but our 5-persona setup trades that scale for cost and latency.
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
    id: "sports",
    title: "Sports Betting",
    content: (
      <div className="space-y-3">
        <p>Browse live and upcoming sports markets from Polymarket with real-time odds.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Supported Leagues</h4>
        <p>MLB, NBA, NFL, NHL, Premier League, La Liga, Bundesliga, Champions League, UFC, IPL, MLS, NCAAB &mdash; with more added regularly.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Game Cards</h4>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">Team rows</strong> &mdash; Each game shows both teams with abbreviation badges, moneyline odds, spread, and total columns.</li>
          <li><strong className="text-[#e6edf3]">Expandable</strong> &mdash; Click a game card to see price history chart, volume, and a link to the full game detail page.</li>
          <li><strong className="text-[#e6edf3]">Live detection</strong> &mdash; Games within 4 hours of their <code className="text-[#d29922] text-xs">gameStartTime</code> show a red LIVE badge.</li>
        </ul>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Game Detail Page</h4>
        <p>Click &ldquo;Game View&rdquo; on any game to see the full detail page with:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">ESPN live scoreboard</strong> &mdash; Team logos, abbreviations, records, and live score from ESPN&apos;s free API (refreshes every 30s).</li>
          <li><strong className="text-[#e6edf3]">All market types</strong> &mdash; Moneyline, Spread, Total (Over/Under), and Player Props from Polymarket.</li>
          <li><strong className="text-[#e6edf3]">Live odds</strong> &mdash; Enriched with CLOB midpoint prices for accuracy.</li>
        </ul>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Data Sources</h4>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d] mt-2">
          <div className="p-3">
            <p className="text-xs"><strong className="text-[#58a6ff]">Gamma API</strong> &mdash; <code className="text-[10px] text-[#768390]">gamma-api.polymarket.com/events?series_id=X</code> &mdash; market data, outcomes, prices, slugs.</p>
          </div>
          <div className="p-3">
            <p className="text-xs"><strong className="text-[#58a6ff]">CLOB API</strong> &mdash; <code className="text-[10px] text-[#768390]">clob.polymarket.com/midpoint?token_id=X</code> &mdash; real-time midpoint prices.</p>
          </div>
          <div className="p-3">
            <p className="text-xs"><strong className="text-[#58a6ff]">ESPN API</strong> &mdash; <code className="text-[10px] text-[#768390]">site.api.espn.com/apis/site/v2/sports/...</code> &mdash; live scores, team logos, records. Free, no key needed.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "architecture",
    title: "Technical Architecture",
    content: (
      <div className="space-y-3">
        <p>For team members working on the codebase. PolyStream is a Next.js 16 app deployed on Vercel with a Neon PostgreSQL database.</p>

        <h4 className="font-semibold text-[#e6edf3] mt-2">Stack</h4>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d]">
          {[
            ["Frontend", "Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui"],
            ["Auth", "RainbowKit + wagmi (wallets), Web3Auth (Google login)"],
            ["Database", "Neon PostgreSQL via Drizzle ORM"],
            ["AI", "OpenAI GPT-4o-mini (consensus, market matching, live market selection)"],
            ["Markets", "Polymarket Gamma API (events) + CLOB API (live prices)"],
            ["News", "RSS (BBC, NYT, Al Jazeera, Guardian, Sky News) + Telegram scraping"],
            ["Scores", "ESPN free API (live scores, team logos)"],
            ["Deploy", "Vercel (auto-deploys from GitHub on push to master)"],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-3 p-3 text-xs">
              <span className="text-[#58a6ff] font-medium w-20 flex-shrink-0">{label}</span>
              <span className="text-[#adbac7]">{value}</span>
            </div>
          ))}
        </div>

        <h4 className="font-semibold text-[#e6edf3] mt-2">Key API Routes</h4>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d]">
          {[
            ["/api/news", "GET — RSS + Telegram headlines, 5-min cache"],
            ["/api/news/markets", "POST — AI headline→market matching (cursor-based incremental). GET — cached results"],
            ["/api/markets/live", "GET — AI-selected markets matching live news, 15-min cache"],
            ["/api/polymarket/events", "GET — market data from Gamma API with CLOB enrichment"],
            ["/api/polymarket/prices", "GET — single CLOB midpoint price lookup"],
            ["/api/polymarket/price-history", "GET — historical price data for charts"],
            ["/api/sports/leagues", "GET — curated league list with ESPN logos"],
            ["/api/sports/events", "GET — games per league with parsed markets"],
            ["/api/sports/game", "GET — full game detail with ESPN scores + all markets"],
            ["/api/consensus", "POST — 3-round AI debate for a market question"],
            ["/api/trade", "POST — paper trade execution (buy/sell)"],
            ["/api/airdrop", "POST — daily AIRDROP claim"],
            ["/api/leaderboard", "GET — top 50 users by balance"],
            ["/api/admin", "GET/POST — admin dashboard (restricted to owner wallet)"],
            ["/api/user", "GET/POST/PATCH — user CRUD + display name"],
          ].map(([route, desc]) => (
            <div key={route} className="flex gap-3 p-2.5 text-xs">
              <code className="text-[#d29922] font-mono w-44 flex-shrink-0 text-[10px]">{route}</code>
              <span className="text-[#768390]">{desc}</span>
            </div>
          ))}
        </div>

        <h4 className="font-semibold text-[#e6edf3] mt-2">How Related Markets Work (for devs)</h4>
        <p className="text-xs text-[#768390]">The headline→market pipeline processes 3 headlines every 60 seconds using a cursor-based system:</p>
        <ol className="list-decimal pl-5 space-y-1 text-xs text-[#adbac7]">
          <li>Frontend POSTs all 15 headline titles to <code className="text-[#d29922]">/api/news/markets</code></li>
          <li>API loads cache from DB (<code className="text-[#d29922]">consensus_cache</code> table, key <code className="text-[#d29922]">news-mkt-v14</code>)</li>
          <li>Cursor advances: headlines[cursor..cursor+3] are the current batch</li>
          <li><strong className="text-[#e6edf3]">GPT extracts keywords</strong> from each headline (cheap text call, no web search)</li>
          <li><strong className="text-[#e6edf3]">Gamma API search</strong> with keywords across 200 events &mdash; returns REAL verified market slugs</li>
          <li><strong className="text-[#e6edf3]">GPT validates</strong> each headline↔market pair, rejects bad matches</li>
          <li>Results cached in DB with cursor position. Frontend polls every 60s to process next batch</li>
          <li>Cap: 20 headlines max. Each headline gets up to 3 markets.</li>
        </ol>

        <h4 className="font-semibold text-[#e6edf3] mt-2">Environment Variables</h4>
        <p className="text-xs text-[#768390]">Required in <code className="text-[#d29922]">.env.local</code> (get from team lead, never commit to git):</p>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] p-3 font-mono text-[10px] text-[#768390] space-y-0.5">
          <p>DATABASE_URL=postgresql://...</p>
          <p>OPENAI_API_KEY=sk-...</p>
          <p>YOUTUBE_API_KEY=AIza...</p>
          <p>NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...</p>
          <p>NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=...</p>
          <p>POLYMARKET_BUILDER_API_KEY=... (server-only, read by /api/polymarket/builder-headers)</p>
          <p>POLYMARKET_BUILDER_SECRET=...</p>
          <p>POLYMARKET_BUILDER_PASSPHRASE=...</p>
        </div>

        <h4 className="font-semibold text-[#e6edf3] mt-2">Team Workflow</h4>
        <ol className="list-decimal pl-5 space-y-1 text-xs text-[#adbac7]">
          <li><code className="text-[#d29922]">git clone</code> the repo, <code className="text-[#d29922]">npm install</code>, add <code className="text-[#d29922]">.env.local</code></li>
          <li><code className="text-[#d29922]">npm run dev</code> to test locally</li>
          <li><code className="text-[#d29922]">npm run build</code> to verify before pushing</li>
          <li><code className="text-[#d29922]">git push</code> to master &mdash; Vercel auto-deploys</li>
          <li>Schema changes: only the team lead runs <code className="text-[#d29922]">npx drizzle-kit push</code></li>
        </ol>
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
          <li>Future: trade directly from PolyStream via the Builder API (credentials stored in env vars, ready for integration).</li>
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
    <>
      <ParticleBackground opacity={0.3} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
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
    </>
  );
}
