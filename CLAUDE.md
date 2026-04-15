@AGENTS.md

# PolyStream - Project Context

## What is this
A prediction market platform at **polystream.vercel.app** combining live news, AI swarm consensus, and paper trading on Polymarket data.

## Quick Start
- `npm run dev` - local dev server
- `npm run build` - production build
- `git push` - deploys to production (Vercel auto-deploys on push to master)
- `npx drizzle-kit push` - push schema changes to Neon DB

**Never run `npx vercel --prod` directly** — it uploads whatever's in the
current working directory, bypasses GitHub, and can overwrite the
GitHub-triggered deploy with stale code. Always commit + push instead.

## Tech Stack
- Next.js 16 (App Router), Tailwind CSS, shadcn/ui
- RainbowKit + wagmi (wallet auth), Web3Auth (Google login)
- Neon PostgreSQL (via Vercel Marketplace), Drizzle ORM
- OpenAI GPT-4o-mini (AI consensus + web search via Responses API)
- Polymarket Gamma API (market data) + CLOB API (real-time prices)
- YouTube Data API v3 (live stream discovery)

## Pages & Features

### News Page (/)
- 7 live streams: Al Jazeera, LiveNow FOX, ABC News, CBS News, DW News, The Young Turks (YouTube) + Alex Jones (Rumble)
- YouTube channels resolved via YouTube Data API v3 (`/api/youtube/live`)
- Rumble channels scraped from `rumble.com/c/{slug}/livestreams` + oEmbed (`/api/rumble/live`)
- STREAM_CHANNELS entries carry a `platform?: "youtube" | "rumble"` field (default: youtube)
- Auto-discovers live streams via YouTube Data API, cached 30min in DB
- **4x multi-view** mode to watch 4 channels simultaneously
- RSS news feed (BBC, NYT, NPR)
- Market ticker with category tabs

### AI Consensus (/ai)
- Top 10 markets by soonest end date, $50K+ volume, category diversity
- 5 AI personas debate across 3 rounds with live web search context
- Cached 5 hours in DB, live CLOB prices refresh every 15s
- Waits for fresh prices before rendering (no stale data)

### Super Swarm (/ai-beta)
- **Coming Soon** page — placeholder for future MiroFish integration
- MiroShark was tested locally (Ollama + Neo4j) but not production-ready
- Custom swarm engine was removed (OpenAI rate limit issues)

### Paper Trade (/trade)
- **Portfolio tab**: balance, positions with live P&L, close at live price
- **Tradable Markets tab**: BTC 5-min rapid trading + AI consensus markets
- BTC 5-min auto-closes on resolution, next market appears automatically
- Positions store clobTokenId for permanent price tracking
- "To win" Polymarket-style display

### Docs (/docs)
- Full documentation with sticky sidebar navigation

## Key API Routes
- `/api/polymarket/events` - Market data (9 tags × 8 events, CLOB enrichment, categorization)
- `/api/polymarket/btc5m` - BTC 5-min market with countdown
- `/api/polymarket/prices` - Direct CLOB price lookup
- `/api/trade` - Paper trade execution (stores clobTokenId, endDate, eventSlug)
- `/api/trade/auto-close` - Settles resolved market positions
- `/api/consensus` - 3-round AI debate with web search
- `/api/youtube/live` - Batch live stream discovery with DB cache
- `/api/airdrop`, `/api/user`, `/api/news`

## Database (Neon PostgreSQL)
Tables: users, positions, trades, airdrops, consensus_cache, youtube_stream_cache, referrals

## Environment Variables
- DATABASE_URL, OPENAI_API_KEY, YOUTUBE_API_KEY
- NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, NEXT_PUBLIC_WEB3AUTH_CLIENT_ID

## Important Notes
- Market discovery is self-healing — new markets auto-surface as old ones resolve
- Live prices: useLivePrices() hook fetches CLOB directly for displayed markets every 15s
- Owner wallet: 0xFbeEfB072F368803B33BA5c529f2F6762941b282
- OpenAI is Tier 1 (200K TPM, 10K RPD) — rate limits apply for heavy usage
- Groq API key also available (gsk_...) for local LLM work
- Ollama installed locally with qwen3:8b model (for future MiroShark work)

## Vercel
- Project: polystream (williamnuuh-7435s-projects) at polystream.vercel.app
- Wired to GitHub repo `thedopetoad/PolyNews`, auto-deploys on push to master
- Do NOT run `npx vercel --prod` directly — push to GitHub and let Vercel deploy

## Git
- User: toad <thedopetoad@gmail.com>
- Remote: https://github.com/thedopetoad/PolyNews (master branch = production)
- Always `git commit` + `git push` after code changes. The push IS the deploy.
