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

### Airdrop (/airdrop)
Single gold-themed hub for the AIRDROP (paper) token — virality loop +
paper trading + leaderboards + earning. Tab state is synced to `?tab=`.

- **Leaderboard tab**: 3 cards side-by-side. All-Time (sum of grants
  with referral counts shown), Weekly Referrals (new signups this ISO
  week), Weekly Gainers (sum of grants in current week). Prize pills
  per card (🥇🥈🥉), admin-editable from /admin.
- **Portfolio tab**: AIRDROP balance card (net + available + in positions)
  and a hand-rolled SVG PnL chart reconstructed from the immutable
  ledger (grants + trades). Positions/History sub-tabs; positions
  expand inline to show price chart, Close button → confirm dialog
  → sells at live CLOB mid.
- **Trade tab**: reuses the TradableMarketsTab component exported from
  /trade/page.tsx (BTC 5-min + AI consensus + sports markets).
- **Earn tab**: daily claim (+100), referral card (5000 per friend),
  weekly goals (5 min news watch = 500, 5 paper trades = 500), one-time
  boosts (first real deposit = 2500, first sports trade = 1000).

Weekly goals reset Monday 00:00 UTC via `isoWeekKey()` (`src/lib/week.ts`).
News-watch progress comes from the `news_watch_heartbeats` table; the
News page pings `/api/airdrop/news-heartbeat` every 15s via the
`useNewsHeartbeat` hook, server dedupes by 15s bucket.

### Legacy /trade
Redirects to `/airdrop?tab=trade` (next.config.ts). `TradableMarketsTab`
still exported from /app/trade/page.tsx because /airdrop imports it —
architecturally weird but works; extraction to a neutral file is the
next refactor.

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
- `/api/news`, `/api/user`, `/api/user/referrals`

### Airdrop endpoints (all live at /api/airdrop/*)
- `/api/airdrop` (POST) — legacy: daily claim, signup claim, apply-referral
- `/api/airdrop/me` (GET) — full dashboard payload for the Earn tab
  (totals, weekly progress, one-time boost flags, daily claim status)
- `/api/airdrop/leaderboard?type=total|weeklyReferrals|weeklyGainers`
- `/api/airdrop/history` — PnL chart: balance reconstructed from ledger
- `/api/airdrop/claim-weekly` (POST) — weekly goal claim (news_watch |
  paper_trades). Idempotent via airdrops(userId, source, weekKey).
- `/api/airdrop/claim-one-time` (POST) — first_deposit | first_sports_trade.
  Atomic: only grants if the flag on `users` is still false.
- `/api/airdrop/news-heartbeat` (POST) — 15s bucket ping from the News page.
- `/api/admin/prizes` (GET/POST) — 9 leaderboard prize strings. Gated
  by requireAdmin(). `/api/settings/public` exposes them unauth.

## Database (Neon PostgreSQL)
Tables: users, positions, trades, airdrops, consensus_cache, youtube_stream_cache,
referrals, news_watch_heartbeats, settings

- `airdrops.week_key` — nullable ISO week ("2026-W16"). Forward-only
  queries mean old rows with NULL are fine. Weekly leaderboards and
  weekly-goal idempotency both use this.
- `news_watch_heartbeats (userId, bucket)` — unique index. 20 distinct
  15-second buckets in a single week = 5-minute news-watch goal complete.
- `settings` — key/value. Used for admin-editable leaderboard prize
  strings (keys: `airdrop_prize_total_{1,2,3}`, etc.).
- `users.first_deposit_bonus_paid` / `first_sports_trade_bonus_paid` —
  one-time boost flags. Claim endpoint uses atomic UPDATE WHERE flag=false.

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
- **Always cd into PolyNews/ before git commands.** The outer
  `C:/Users/happy/Desktop/PolyStream/` is a separate stale repo — an
  accidental commit there adds PolyNews as an embedded submodule and
  pollutes the working tree. If it happens: `git reset --mixed HEAD~1`
  in the outer dir, then commit from inside PolyNews.

## Admin
- Phantom Solana signature sign-in at /admin (pubkey hardcoded in
  `src/lib/admin-auth.ts`: 4HHN3zLhVuUcfXuw8MofXLARnQwLgzVhHdPDcBWBiEVT).
- Session = HMAC-signed HttpOnly cookie, 24h TTL. Phantom trust is
  re-checked on page load — revoking trust logs the admin out.
- Admin dashboard includes the **Leaderboard Prize Editor** — 9 free-form
  text fields for the 3 boards × 3 places. Empty field → leaderboard
  shows "TBD" pill. Set these after boss approves the giveaway budget.
