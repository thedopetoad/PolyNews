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
paper trading + leaderboards + earning. Tab state is local useState
with URL sync (router.replace on click + useEffect on param change).

- **Leaderboard tab**: 3 cards in order *Weekly Referrals | All-Time |
  Biggest Gainers*. All-Time is bragging-rights only (no cash prize,
  no pills). Weekly cards show 🥇🥈🥉 prize pills rendered as `$N`
  from numeric settings values (empty/0/unparsable → "TBD"). Rank
  computation: All-Time = users.balance + sum(open paper position
  value at entry price), so leaderboard matches the Portfolio card
  number exactly.
- **Portfolio tab**: balance card (full-width 2-col: totals left,
  referral call-out right with code + copy + friend count) + Positions
  / History sub-tabs. Positions expand inline to show price chart,
  Close button → confirm dialog → sells at live CLOB mid. PnL chart
  was removed per product call.
- **Trade tab**: reuses the TradableMarketsTab component exported from
  /trade/page.tsx (BTC 5-min + AI consensus + sports markets).
- **Earn tab**: Referral card up top (virality primary), then a grid
  of circular-progress tiles — Daily claim, Watch 5min news, 5 paper
  trades, First real deposit, First sports bet. No top total banner
  (it duplicated Portfolio tab).

Week semantics diverge intentionally:
- **Weekly GOALS** (news watch, paper trades) reset Mon 00:00 UTC via
  `isoWeekKey()`. Unchanged from the original design.
- **Weekly LEADERBOARDS** (Referrals, Biggest Gainers) reset Mon 17:00
  UTC (= 9am PST / 10am PDT) via `prizeWeekKey()` — matches the
  leaderboard-payout cron cadence.

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
- `/api/airdrop` (POST) — legacy: daily claim, signup claim (dead —
  auto-granted at /api/user POST now), apply-referral
- `/api/airdrop/me` (GET) — dashboard payload for the Earn tab +
  Portfolio card referral count. totalAirdrop = net worth (balance +
  positions at entry price), totalGranted = sum of airdrops ledger
- `/api/airdrop/leaderboard?type=total|weeklyReferrals|weeklyGainers`
  — total ranks by net worth, weekly branches filter by
  `createdAt >= prizeWeekStart` (not the ISO airdrops.weekKey)
- `/api/airdrop/claim-weekly` (POST) — weekly goal claim (news_watch |
  paper_trades). Idempotent via airdrops(userId, source, weekKey).
- `/api/airdrop/claim-one-time` (POST) — first_deposit | first_sports_trade.
  Atomic: only grants if the flag on `users` is still false.
- `/api/airdrop/news-heartbeat` (POST) — 15s bucket ping from News page.

### Payout endpoints + cron
- `/api/cron/weekly-snapshot` (GET) — Vercel Cron hits this Mon 17:00 UTC.
  REQUIRES `CRON_SECRET` env var; 503 if unset, 401 on wrong secret.
  Shared logic lives in `src/lib/airdrop-snapshot.ts`.
- `/api/admin/snapshot-now` (POST) — admin-triggered snapshot, calls
  the same shared lib directly (no HTTP loop). Gated by Phantom
  session cookie.
- `/api/admin/payouts` (GET) — list all prize_payouts rows, newest
  week first, joined with display name. Read-only (mark-paid was
  removed — admin tracks sends externally).
- `/api/admin/prizes` (GET/POST) — 6 numeric prize amounts (2 weekly
  boards × 3 places). All-Time has no prize. Empty or ≤0 renders TBD.
- `/api/settings/public` (GET) — public read of the 6 prize amounts
  for the leaderboard UI pills. Cached 60s.

### Vercel Cron
`vercel.json` configures `0 17 * * 1` → `/api/cron/weekly-snapshot`.
Cron drift up to 59 minutes is tolerated by shifting the reference
point back 1 hour when computing the just-ended prize week.

## Database (Neon PostgreSQL)
Tables: users, positions, trades, airdrops, consensus_cache, youtube_stream_cache,
referrals, news_watch_heartbeats, settings, prize_payouts

- `airdrops.week_key` — ISO-week string. Used ONLY for weekly-goal
  idempotency (`claim-weekly` enforces unique source+weekKey per user).
  Leaderboards now filter by `createdAt` timestamp instead, using
  `prizeWeekStart()` (Mon 17:00 UTC) for the boundary.
- `news_watch_heartbeats (userId, bucket)` — unique index. 20 distinct
  15-second buckets in a single week = 5-minute news-watch goal complete.
- `settings` — key/value. Numeric prize amounts (keys:
  `airdrop_prize_weeklyRef_{1,2,3}` and `airdrop_prize_weeklyGain_{1,2,3}`).
- `prize_payouts` — per-winner snapshot. (weekKey, leaderboard, place)
  unique. UI reads this on /admin; cron writes it each Monday.
  `status/txHash/paidAt/paidBy` columns exist but are unused —
  mark-paid flow was removed. Keep for potential audit.
- `users.first_deposit_bonus_paid` / `first_sports_trade_bonus_paid` —
  one-time boost flags. Claim endpoint uses atomic UPDATE WHERE flag=false.

## Virality loop (IMPORTANT)
New user signup (`/api/user` POST) auto-grants:
1. `users.balance = STARTING_BALANCE` (1000 AIRDROP — this IS the signup bonus,
   not an additional one).
2. `hasSignupAirdrop: true` on insert so legacy `/api/airdrop` signup path
   can't double-credit.
3. If `referredBy` was passed: referrer gets +5000 AIRDROP credited to
   balance, airdrops ledger row, and a `referrals` table row.

Previous bug: the legacy `/api/airdrop` POST signup handler had the
referrer-payout logic, but NO UI in production called it. Referrers
silently earned $0 until commit a03548c moved the payout into /api/user
POST directly. A one-shot backfill paid out the 5 referral pairs that
had slipped through.

## Environment Variables
- DATABASE_URL, OPENAI_API_KEY, YOUTUBE_API_KEY
- NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, NEXT_PUBLIC_WEB3AUTH_CLIENT_ID
- **CRON_SECRET** — required for the Monday payout cron. If unset,
  `/api/cron/weekly-snapshot` returns 503 and no automated snapshots
  happen. Admin can still trigger via "Snapshot now" button on /admin.

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

### Staging / production split
- **master** → production (`polystream.vercel.app`)
- **staging** → preview (`polystream-git-staging-williamnuuh-7435s-projects.vercel.app`)
- Vercel auto-deploys EVERY branch push to its own URL. The staging
  branch URL is stable (always points at staging's HEAD), unlike the
  per-commit hash URLs.
- Vercel `crons` only run on the production branch, so staging won't
  trigger the Monday leaderboard snapshot.
- **Same Neon DB on both right now.** Test users created on staging
  WILL show up in production's leaderboard. If that becomes an issue,
  use Neon's branching to spin up a staging DB and override
  `DATABASE_URL` in Vercel's "Preview" environment scope.

### Recommended workflow for non-trivial fixes
1. `git checkout staging && git merge master` — sync staging with prod
2. Edit + commit + `git push` (still on staging)
3. Visit the staging URL, verify the fix
4. `git checkout master && git merge staging && git push` — promote to prod

### Hotfixes
For small, low-risk changes (typo, copy tweak), pushing straight to
master is still fine. Reserve the staging dance for things that touch
auth, payouts, or the trade flow.

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

Admin dashboard cards:
1. **Stats grid** — users / airdrops / trades / suspicious.
2. **Prize editor** — 6 numeric prize amounts (2 weekly boards ×
   3 places). All-Time has no prize. Numbers render as $N pills on
   leaderboard. Empty or 0 → TBD.
3. **Leaderboard Payouts** — collapsible cards grouped by week.
   Latest week auto-expands. Per row: winner name, EOA, proxy address
   (copy button), amount. Per week: "Copy manifest" button dumps a
   boss-friendly text block. Mark-paid flow was removed — admin
   tracks USDC.e sends externally.
4. **Snapshot now** button — triggers the snapshot logic manually
   via Phantom auth (no dependency on CRON_SECRET).
5. Airdrop Breakdown, suspicious accounts, etc. (pre-existing).

Payout workflow (custody-free):
- Monday 17:00 UTC cron OR admin clicks "Snapshot now" → rows inserted
  into prize_payouts with pending status.
- Admin clicks "Copy manifest" for the relevant week, pastes to boss.
- Boss sends USDC.e from his own wallet to each proxy address.
- We never hold user funds. No private keys in env.
