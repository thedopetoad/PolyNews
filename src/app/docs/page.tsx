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
          We select the <strong className="text-[#e6edf3]">top 10 prediction markets</strong> ending between 1 day and 3 months from now, filtered by volume (&ge;$50K), category diversity (max 4 per category, max 2 per topic), edge-price exclusion (drops anything below 5% or above 95%), and a quality blocklist (no Bigfoot, alien, rapture, etc.). Then <strong className="text-[#e6edf3]">20 GPT-4o-mini personas</strong> each research and vote on every market across 2 rounds, and we aggregate the 40 votes per market via statistical bootstrap.
        </p>
        <p>
          The whole pipeline runs <strong className="text-[#e6edf3]">once a day</strong> via Vercel cron at 06:00, 06:15, and 06:30 UTC (one cron per step). Results are written to Postgres and the /ai page reads from there, so opening the page is instant. The admin can also trigger a fresh run manually from <code className="text-[#d29922] text-xs">/admin</code>.
        </p>
        <h4 className="font-semibold text-[#e6edf3] mt-4">Our Implementation: 20 personas, 2 rounds, 1 bootstrap</h4>
        <p>For each market we run a 3-step pipeline. Each step is its own Vercel function so we never hit the 60-second timeout. All GPT calls use <code className="text-[#d29922] text-xs">gpt-4o-mini</code>.</p>
        <div className="bg-[#0d1117] rounded-lg border border-[#21262d] divide-y divide-[#21262d] mt-3 mb-3">
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Step 1 (06:00 UTC) — Persona-Styled Research + Vote</p>
            <p className="text-xs mt-1">All 20 personas run in parallel. Each one calls OpenAI&apos;s Responses API with the <code className="text-[#d29922] text-[10px]">web_search_preview</code> tool, but with <strong className="text-[#e6edf3]">a search-style hint matched to its perspective</strong>: the Historian searches for past analogues, the INTP Logician searches for verified primary-source data, the ESFP Performer searches for media buzz, etc. The persona then writes a probability + 3-5 bullet points based on what it found. Bullets and the underlying web context are saved to <code className="text-[#d29922] text-[10px]">consensus_persona_predictions</code>. ~20 web searches + ~20 chat completions.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Step 2 (06:15 UTC) — Re-Assess</p>
            <p className="text-xs mt-1">A separate cron picks up runs that finished step 1. The same 20 personas now see <strong className="text-[#e6edf3]">all 20 round-1 probabilities and bullets from the DB</strong> and re-vote. No new web search — they reason off the round-1 dataset and decide whether to hold firm or update. Another 20 rows saved.</p>
          </div>
          <div className="p-3">
            <p className="text-[#58a6ff] font-medium text-xs">Step 3 (06:30 UTC) — Bootstrap Aggregation</p>
            <p className="text-xs mt-1">No AI calls. We pull the 40 probabilities (rounds 1+2) and run <strong className="text-[#e6edf3]">10,000 bootstrap resamples</strong> — each resample picks 40 values with replacement from the 40 originals and computes a mean. The distribution of those 10,000 means gives us the headline number plus its uncertainty. Pure JS, runs in &lt;100ms per market.</p>
          </div>
        </div>
        <h4 className="font-semibold text-[#e6edf3]">What we report</h4>
        <p>
          From the bootstrap distribution we surface three numbers per market:
        </p>
        <ul className="list-disc pl-5 text-xs space-y-1">
          <li><strong className="text-[#e6edf3]">Mean</strong> — the average of the 10,000 bootstrapped means. This is the headline probability.</li>
          <li><strong className="text-[#e6edf3]">90% confidence interval</strong> — the 5th and 95th percentile of the distribution. Shown as <code className="text-[#d29922] text-[10px]">±X</code> next to the mean. A tight band means the personas agreed; a wide band means they disagreed.</li>
          <li><strong className="text-[#e6edf3]">Mode</strong> — the most-common bucket in the distribution. Statistically should be near the mean (the bootstrap distribution is approximately normal); we show it as a sanity check.</li>
        </ul>
        <p>Cost is roughly <strong className="text-[#e6edf3]">$0.50 per market</strong> (web search dominates), about $5 per daily run. The admin can also force a manual run that wipes today&apos;s snapshot and re-computes.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-3">The 20 Personas</h4>
        <p className="text-xs">5 originals plus 15 MBTI-inspired archetypes. Each one has a distinct reasoning style AND a distinct web-search style:</p>
        <div className="flex flex-wrap gap-1 mt-2">
          {["Market Analyst", "Political Strategist", "Contrarian", "Risk Assessor", "Historian", "INTJ — Architect", "ENTP — Challenger", "INTP — Logician", "ENTJ — Commander", "INFJ — Advocate", "INFP — Mediator", "ENFP — Campaigner", "ENFJ — Protagonist", "ISTJ — Logistician", "ISFJ — Defender", "ESTJ — Executive", "ESFJ — Consul", "ISTP — Virtuoso", "ESTP — Entrepreneur", "ESFP — Performer"].map((name) => (
            <span key={name} className="text-[10px] text-[#768390] bg-[#1c2128] px-2 py-0.5 rounded border border-[#21262d]">{name}</span>
          ))}
        </div>
        <h4 className="font-semibold text-[#e6edf3] mt-3">Why this design</h4>
        <p>
          The persona-styled web search is the most important piece. The same question searched by a Historian and an ESFP Performer surfaces fundamentally different sources, which feeds genuine diversity into round 1. Round 2 lets each persona react to what the others found without piling on. Bootstrap aggregation then gives us a real confidence interval instead of a fake-precise single number — when the 20 personas disagree, the band widens and you can see it. Fail-soft: if a persona&apos;s web search times out we drop just that persona; the run continues if at least 15 of 20 succeed.
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
        <p>Practice prediction market trading without risk using live Polymarket data. Lives at <code className="text-[#d29922] text-xs">/airdrop?tab=trade</code> and <code className="text-[#d29922] text-xs">/airdrop?tab=portfolio</code>.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Trade Tab</h4>
        <p className="text-xs">Two sections, both pulling live odds from the Polymarket CLOB:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">AI Swarm Consensus Markets</strong> &mdash; The latest snapshot of markets from the daily consensus pipeline (up to 10 — fewer if today&apos;s filter only matched a smaller set). Each row shows the AI&apos;s mean prediction next to live Yes/No prices and the volume from the catalog.</li>
          <li><strong className="text-[#e6edf3]">Live Sports Markets</strong> &mdash; Every live or starting-soon (within 24h) sports moneyline. Pulled from <code className="text-[#d29922] text-[10px]">/api/sports/events</code> across all enabled leagues.</li>
        </ul>
        <h4 className="font-semibold text-[#e6edf3] mt-2">Portfolio Tab</h4>
        <p className="text-xs">Shows your AIRDROP balance, daily claim, and all open paper positions with live P&amp;L. Closed positions stay hidden across reloads. Buy-in price is frozen at trade time so PnL = (current CLOB midpoint &minus; buy-in price) &times; shares.</p>
        <h4 className="font-semibold text-[#e6edf3] mt-2">How Trading Works</h4>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-[#e6edf3]">Buy:</strong> Select a market, choose Yes or No, enter shares. You buy in at the current live CLOB midpoint. Your buy-in price + the market&apos;s clobTokenId are stored on the position row so it survives even if the market falls off the trade list later.</li>
          <li><strong className="text-[#e6edf3]">Close:</strong> In the Portfolio tab, click Close on any position. The system checks the live Polymarket odds and calculates your P&amp;L based on the price change since your buy-in.</li>
        </ul>
        <p>AIRDROP tokens are virtual and have no real value. Prices update every few seconds from the Polymarket CLOB API.</p>
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
            ["/api/cron/consensus-step1", "GET (cron 06:00 UTC) — picks top 10 markets, 20 personas each do persona-styled web search + initial vote"],
            ["/api/cron/consensus-step2", "GET (cron 06:15 UTC) — same 20 personas re-vote after seeing all round-1 outputs"],
            ["/api/cron/consensus-step3", "GET (cron 06:30 UTC) — bootstrap 10K resamples → mean / mode / 90% CI / histogram. Also prunes old run rows."],
            ["/api/admin/consensus-run-now", "POST — admin-triggered manual run of all 3 steps inline (Phantom-auth)"],
            ["/api/consensus/latest", "GET — latest finished run per market (used by /ai page + airdrop trade tab)"],
            ["/api/consensus/run/[id]", "GET — drill-down for one run with all 20 persona predictions + bullets"],
            ["/api/consensus", "POST — DEPRECATED v1 on-demand 5-persona endpoint, kept for rollback"],
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
