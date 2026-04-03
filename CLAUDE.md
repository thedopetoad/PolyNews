@AGENTS.md

# PolyStream - Project Context

## What is this
A prediction market platform at **polystream.vercel.app** combining live news, AI swarm consensus, and paper trading on Polymarket data.

## Quick Start
- `npm run dev` - local dev server
- `npm run build` - production build
- `npx vercel --yes --prod` - deploy to production
- `npm run db:push` - push schema changes to Neon DB

## Tech Stack
- Next.js 16 (App Router), Tailwind CSS, shadcn/ui
- RainbowKit + wagmi (wallet auth), Web3Auth (Google login)
- Neon PostgreSQL (via Vercel Marketplace), Drizzle ORM
- OpenAI GPT-4o-mini (AI swarm consensus)
- Polymarket Gamma API (market data) + CLOB API (real-time prices)

## Key Architecture
- `/api/polymarket/events` - Fetches markets, enriches with CLOB prices, categorizes, filters resolved
- `/api/consensus` - 3-round debate system (5 personas x 3 rounds = 15 calls), cached 5hrs in DB
- `/api/trade` - Paper trading with atomic SQL operations
- `/api/airdrop` - Daily/weekly token claims
- `useUser` hook - Unified auth (wagmi wallets + Web3Auth Google via Zustand auth store)

## Environment Variables (all set in Vercel + .env.local)
- DATABASE_URL - Neon PostgreSQL
- OPENAI_API_KEY - GPT-4o-mini for consensus
- NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
- NEXT_PUBLIC_WEB3AUTH_CLIENT_ID

## Remaining Issues
See TODO.md for the full list with details and root causes.

## Vercel
- Project: polystream (williamnuuh-7435s-projects)
- CLI is already authenticated
- `npx vercel --yes --prod` deploys immediately

## Git
- User: toad <thedopetoad@gmail.com>
- 28 commits on master branch
- Not yet pushed to GitHub (local only)
