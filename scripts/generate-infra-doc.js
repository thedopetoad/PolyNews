// Generates docs/infrastructure.docx — the end-to-end stack writeup.
// Run with: node scripts/generate-infra-doc.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, LevelFormat, BorderStyle, WidthType,
  ShadingType, PageOrientation, PageBreak,
} = require("docx");

// ── helpers ──────────────────────────────────────────────────────────
const FONT = "Arial";
const MONO = "Consolas";

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, ...opts })],
    spacing: { after: 120 },
  });
}

function pInline(runs, opts = {}) {
  return new Paragraph({ children: runs, spacing: { after: 120 }, ...opts });
}

function r(text, opts = {}) {
  return new TextRun({ text, font: FONT, ...opts });
}
function code(text, opts = {}) {
  return new TextRun({ text, font: MONO, size: 20, ...opts });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: FONT })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: FONT })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: FONT })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    children: [new TextRun({ text, font: FONT })],
  });
}
function bulletInline(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    children: runs,
  });
}

function preBlock(text) {
  // ASCII diagram / code block — render each line as a separate
  // monospace paragraph so spacing is preserved.
  return text.split("\n").map(line =>
    new Paragraph({
      children: [new TextRun({ text: line || " ", font: MONO, size: 18 })],
      spacing: { after: 0 },
    })
  );
}

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function tableCell(text, opts = {}) {
  const { bold = false, fill, width, align } = opts;
  return new TableCell({
    borders: BORDERS,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, font: FONT, size: 20, bold })],
    })],
  });
}

function tableCellRich(runs, opts = {}) {
  const { fill, width } = opts;
  return new TableCell({
    borders: BORDERS,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: runs })],
  });
}

// Two-col table (e.g., Concept | Description)
function twoColTable(rows, colW = [3000, 6360]) {
  const sum = colW[0] + colW[1];
  return new Table({
    width: { size: sum, type: WidthType.DXA },
    columnWidths: colW,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableCell(rows.header[0], { bold: true, fill: "1F2937", width: colW[0] }),
          tableCell(rows.header[1], { bold: true, fill: "1F2937", width: colW[1] }),
        ].map((c, i) => {
          // White text on dark bg
          c.options = c.options || {};
          return c;
        }),
      }),
      ...rows.body.map((row, idx) =>
        new TableRow({
          children: [
            tableCell(row[0], { width: colW[0], fill: idx % 2 === 0 ? "F3F4F6" : undefined, bold: true }),
            tableCell(row[1], { width: colW[1], fill: idx % 2 === 0 ? "F3F4F6" : undefined }),
          ],
        })
      ),
    ],
  });
}

// Three-col table
function threeColTable(rows, colW = [2200, 4000, 3160]) {
  return new Table({
    width: { size: colW[0] + colW[1] + colW[2], type: WidthType.DXA },
    columnWidths: colW,
    rows: [
      new TableRow({
        tableHeader: true,
        children: rows.header.map((h, i) =>
          tableCell(h, { bold: true, fill: "1F2937", width: colW[i] })
        ),
      }),
      ...rows.body.map((row, idx) =>
        new TableRow({
          children: row.map((cell, i) =>
            tableCell(cell, { width: colW[i], fill: idx % 2 === 0 ? "F3F4F6" : undefined, bold: i === 0 })
          ),
        })
      ),
    ],
  });
}

// ── content ──────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);

const overview = `
                          ┌──────────────────────────────────┐
                          │        USER'S BROWSER            │
                          │   Next.js client (React)         │
                          │   RainbowKit + Magic SDK + viem  │
                          └────────────────┬─────────────────┘
                                           │
                          ┌────────────────┼────────────────┐
                          ▼                                 ▼
              ┌──────────────────────┐          ┌─────────────────────┐
              │   POLYGON CHAIN      │          │   VERCEL EDGE/SSR   │
              │  CTF, NegRiskAdapter │ ◀──────▶ │   Next.js + APIs    │
              │  USDC.e, Relay Hub   │          │   Middleware, Cron  │
              └──────────────────────┘          └──────────┬──────────┘
                                                           │
                                ┌──────────────────────────┼──────────────────────────┐
                                ▼                          ▼                          ▼
                       ┌─────────────────┐      ┌────────────────────┐      ┌─────────────────┐
                       │  NEON POSTGRES  │      │  POLYMARKET APIs   │      │ EXTERNAL APIs   │
                       │  10 tables      │      │  CLOB, data, gamma │      │ OpenAI, YouTube │
                       │  (Drizzle ORM)  │      │  Relayer, Bridge   │      │ Rumble, RSS     │
                       └─────────────────┘      └────────────────────┘      └─────────────────┘
`.trimEnd();

const moneyFlow = `
External wallet (any chain)
        │
        │  1. Bridge or direct USDC.e on Polygon
        ▼
USER'S POLYMARKET PROXY  (CREATE2 from EOA)
        │
        │  2. Sign trade order
        ▼
Polymarket CLOB ────── matches with counterparty ────── settles on-chain
        │                                                        │
        │  3. Outcome tokens minted/transferred                   │  Fees → builder = us
        ▼                                                         │
USER'S PROXY  (now holds outcome shares)                         │
        │                                                         │
        │  4a. Sell back to CLOB           4b. Market resolved → Redeem
        ▼                                       ▼
Proxy gets USDC.e back          Proxy gets winnings via CTF or NegRiskAdapter
        │
        │  5. Withdraw via gasless relay
        ▼
External wallet (Polygon, Ethereum, Base, or Solana via bridge)
`.trimEnd();

const children = [
  // ── Title ──────────────────────────────────────────────────────────
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: "PolyStream Infrastructure", font: FONT, size: 52, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
    children: [new TextRun({ text: `End-to-end architecture · ${today}`, font: FONT, size: 22, color: "6B7280" })],
  }),

  // ── Bird's-eye view ────────────────────────────────────────────────
  h1("Bird's-eye view"),
  ...preBlock(overview),
  p(""),

  // ── Layer 1: Frontend ──────────────────────────────────────────────
  h1("Layer 1 — Frontend (browser)"),
  pInline([
    r("Framework: ", { bold: true }),
    r("Next.js 16 with the App Router. Mix of React Server Components for cheap initial render and Client Components for anything with state, wallet hooks, or React Query."),
  ]),
  h3("State management"),
  bulletInline([r("React Query", { bold: true }), r(" — server-data caching, background refetch, optimistic updates. Used for everything that hits an API.")]),
  bulletInline([r("Zustand stores", { bold: true }), r(" (use-auth-store, use-news-store) — small bits of cross-component state.")]),
  bulletInline([r("localStorage", { bold: true }), r(" — closed-positions ledger, pending trades, pending bridges (each with TTLs).")]),
  bulletInline([r("sessionStorage", { bold: true }), r(" — login return-path, fallback referral code (cookie is primary).")]),
  h3("Wallet stack"),
  bulletInline([r("RainbowKit + Wagmi", { bold: true }), r(" — MetaMask, Phantom, Coinbase, WalletConnect. Standard EVM wallet flows.")]),
  bulletInline([r("Magic SDK ", { bold: true }), code("@magic-ext/oauth2"), r(" — Google login. User signs in with Google, Magic generates a Polygon wallet for them deterministically. We treat the Magic-generated address as their EOA — same downstream code path as MetaMask users.")]),
  bulletInline([r("viem", { bold: true }), r(" — low-level chain interactions, encoding calldata, reading contracts.")]),
  h3("Trading SDK"),
  bulletInline([code("@polymarket/builder-relayer-client"), r(" — submits gasless transactions through Polymarket's relay hub (USDC.e transfers, position redemptions).")]),
  bulletInline([code("@polymarket/builder-signing-sdk"), r(" — HMAC-signed builder headers; the secret stays server-side at "), code("/api/polymarket/builder-headers"), r(".")]),

  // ── Layer 2: Server ────────────────────────────────────────────────
  h1("Layer 2 — Server (Vercel)"),
  pInline([
    r("Hosting: ", { bold: true }),
    r("Vercel Pro tier ($20/mo). Project "),
    code("polystream"),
    r(" in org "),
    code("williamnuuh-7435s-projects"),
    r(". Auto-deploys on push to "),
    code("master"),
    r(" of GitHub repo "),
    code("thedopetoad/PolyNews"),
    r("."),
  ]),
  pInline([
    r("Runtime: ", { bold: true }),
    r("mix of Edge functions (low-latency, 1MB bundle limit, no Node APIs) and Serverless functions (full Node, slower cold starts). Anything touching Drizzle/Neon runs serverless."),
  ]),
  h3("Middleware (src/middleware.ts) — runs before every request"),
  bullet("Sets security headers (CSP, HSTS, X-Frame-Options, etc.)"),
  bullet("Rate-limits API calls (60/min general, 10/min for /api/airdrop + /api/trade)"),
  bulletInline([r("First-touch referral cookie", { bold: true }), r(" — captures "), code("?ref=…"), r(" from URL into a 30-day SameSite=Lax cookie that survives Google OAuth round-trips.")]),
  h3("Cron"),
  pInline([
    r("Vercel's built-in scheduler. "),
    code("0 17 * * 1"),
    r(" calls "),
    code("/api/cron/weekly-snapshot"),
    r(" to write that week's leaderboard winners into "),
    code("prize_payouts"),
    r(". Gated by a "),
    code("CRON_SECRET"),
    r(" env var."),
  ]),
  h3("Logs"),
  pInline([
    r("3-day retention on Pro tier. Observability lines tagged with greppable prefixes: "),
    code("[signup]"),
    r(", "),
    code("[redeem]"),
    r(", "),
    code("[backfill-ref]"),
    r(", "),
    code("[apply-referral]"),
    r(", "),
    code("[referral-deposit]"),
    r("."),
  ]),

  // ── Layer 3: Database ──────────────────────────────────────────────
  h1("Layer 3 — Database (Neon Postgres)"),
  pInline([
    r("Provider: ", { bold: true }),
    r("Neon, serverless Postgres on AWS via Vercel Marketplace. Drizzle ORM for queries + schema management."),
  ]),
  h3("Tables"),
  twoColTable({
    header: ["Table", "Purpose"],
    body: [
      ["users", "One row per account. EOA address as PK. Holds AIRDROP balance, displayName, email, referredBy code, signup IP, daily streak, one-time-boost flags."],
      ["positions", "Paper-trade positions on the AIRDROP token. Real trades aren't here — they live on Polymarket's data-api."],
      ["trades", "Paper-trade execution history."],
      ["airdrops", "Ledger of every AIRDROP grant (signup, daily, referral, weekly goal, etc)."],
      ["referrals", "(referrer_id, referred_id) pairs. UNIQUE on referred_id — the database-level lock that prevents double-paying referral bonuses. Has source (signup_link / oauth_backfill / apply_code) and referralDepositBonusPaid flags."],
      ["news_watch_heartbeats", "15-second buckets pinged from the News page. 20 distinct buckets in a week = 5-min news goal complete."],
      ["youtube_stream_cache", "Resolved live-stream IDs cached 30 min to stay under YouTube API quota."],
      ["consensus_cache", "AI-debate output cached 5 hours per market."],
      ["settings", "Key/value store. Currently holds the 6 prize-amount values for the leaderboard pills."],
      ["prize_payouts", "Weekly leaderboard winner snapshots. (weekKey, leaderboard, place) unique."],
    ],
  }),
  p(""),
  pInline([
    r("Schema migrations: ", { bold: true }),
    code("npx drizzle-kit push"),
    r(" reads "),
    code("schema.ts"),
    r(", diffs against the live DB, prints the SQL it'll run, and applies on confirm. No migration files — Drizzle infers from the schema directly."),
  ]),

  // ── Layer 4: Polygon ───────────────────────────────────────────────
  new Paragraph({ children: [new PageBreak()] }),
  h1("Layer 4 — Polygon blockchain"),
  pInline([
    r("Why Polygon: ", { bold: true }),
    r("Polymarket lives on Polygon. Every real bet, every cash-out, every redemption is a Polygon transaction."),
  ]),
  h3("Contracts we touch"),
  threeColTable({
    header: ["Contract", "Address", "Purpose"],
    body: [
      ["USDC.e", "0x2791Bca1...A84174", "Bridged USDC. Polymarket's collateral token."],
      ["CTF (Conditional Tokens)", "0x4D97DCd9...076045", "ERC-1155 holding outcome shares. Where redeem happens for binary markets."],
      ["CTF Exchange", "0x4bFb41d5...8B8982E", "Where binary-market trades match."],
      ["NegRisk CTF Exchange", "0xC5d563A3...220f80a", "Same but for NegRisk (multi-outcome) markets."],
      ["NegRisk Adapter", "0xd91E80cF...0DA35296", "Where NegRisk redemption + position prep happens."],
      ["Polymarket Relay Hub", "0xD216153c...172F494", "Gasless tx submission. We sign, hub pays gas, fee taken from user's USDC.e."],
    ],
  }),
  p(""),
  pInline([
    r("Wallet derivation (CREATE2 proxy): ", { bold: true }),
    r("Every EOA (whether MetaMask or Magic-generated) has a deterministic Polymarket proxy wallet derived via "),
    code("getCreate2Address"),
    r(" from the EOA. Funds live in the proxy. Trades execute from the proxy. The user signs from their EOA but transactions move funds in/out of the proxy."),
  ]),
  h3("RPC endpoints"),
  bulletInline([code("drpc.org"), r(" — primary, CORS-friendly, used by wagmi + Magic + most reads")]),
  bulletInline([code("polygon-pokt.nodies.app"), r(" — used for "), code("eth_getLogs"), r(" (drpc free tier caps too low)")]),
  bulletInline([code("Alchemy"), r(" — used for "), code("waitForTransactionReceipt"), r(" after redeem submissions (chain-of-truth verification)")]),

  // ── Layer 5: Polymarket APIs ───────────────────────────────────────
  h1("Layer 5 — Polymarket APIs (the real backend)"),
  p("We're not the backend for trading — Polymarket is. We're a builder on top."),
  threeColTable({
    header: ["API", "Host", "What it does"],
    body: [
      ["CLOB", "clob.polymarket.com", "Place + cancel orders, get orderbook prices. Returns auth credentials we cache in localStorage."],
      ["Data API", "data-api.polymarket.com", "Read positions, activity (trade history), portfolio value. Source of truth for what the user owns."],
      ["Gamma API", "gamma-api.polymarket.com", "Market + event metadata. Categories, end dates, conditionIds, negRisk flags, slugs."],
      ["Relayer V2", "relayer-v2.polymarket.com", "Gasless transaction submission. We sign, they relay, user pays in USDC.e from proxy balance."],
      ["Bridge", "bridge.polymarket.com", "Cross-chain deposits (Ethereum / Base / Solana → Polygon proxy)."],
    ],
  }),
  p(""),
  pInline([
    r("Builder fees: ", { bold: true }),
    r("by setting our address as the builder on every order (via the builder-signing SDK), Polymarket pays us a cut of the fees on trades placed through PolyStream. This is the actual revenue model."),
  ]),

  // ── Layer 6: External APIs ─────────────────────────────────────────
  h1("Layer 6 — External APIs"),
  threeColTable({
    header: ["API", "Purpose", "Auth"],
    body: [
      ["OpenAI (GPT-4o-mini)", "AI Consensus — 5 personas debate over 3 rounds with live web search context", "API key"],
      ["YouTube Data API v3", "Discover live streams for the 7 channels on the News page", "API key (10k req/day)"],
      ["Rumble (oEmbed + scrape)", "Same for Alex Jones channel", "None"],
      ["RSS feeds (BBC, NYT, NPR)", "News headlines for the ticker", "None"],
      ["ESPN site.api.espn.com", "Sports event data, team logos, schedules", "None"],
    ],
  }),

  // ── Layer 7: Auth ──────────────────────────────────────────────────
  new Paragraph({ children: [new PageBreak()] }),
  h1("Layer 7 — Auth flows (two parallel paths)"),
  h3("Wallet auth (MetaMask / Phantom / Coinbase)"),
  bullet("User clicks Connect Wallet → wagmi connects → returns EOA address"),
  bulletInline([r("We POST "), code("/api/user"), r(" with "), code('{id: address, authMethod: "wallet"}')]),
  bullet("Server creates row if new, returns user record"),
  bulletInline([r("Subsequent API calls include "), code("Authorization: Bearer <address>"), r(" header (no signature; we trust client)")]),
  h3("Google auth (Magic)"),
  bullet("User clicks Continue with Google → Magic redirects to Google OAuth"),
  bulletInline([r("Google returns to "), code("/"), r(" with state+code params")]),
  bullet("Magic SDK exchanges code, returns the user's deterministic Polygon address + email"),
  bulletInline([r("We POST "), code("/api/user"), r(" with "), code('{id, authMethod: "google", email}')]),
  bullet("Server records the user, pays any signup-referral bonus, returns record"),
  h3("Admin auth"),
  bulletInline([r("Phantom Solana wallet sign-in. Single hardcoded pubkey ("), code("4HHN3zLh...BWBiEVT"), r(") in "), code("src/lib/admin-auth.ts"), r(".")]),
  bullet("Server verifies the signature, sets HMAC-signed HttpOnly cookie, 24h TTL."),
  bullet("Cookie present + Phantom still trusts site = admin access."),

  // ── Layer 8: Money flow ────────────────────────────────────────────
  h1("Layer 8 — Money flow"),
  ...preBlock(moneyFlow),
  p(""),
  p("The platform itself never custodies user funds. Everything sits in the user's CREATE2 proxy, which only their EOA can sign for."),

  // ── Layer 9: AIRDROP token ─────────────────────────────────────────
  h1("Layer 9 — AIRDROP token (paper)"),
  pInline([
    r("A separate, internal-only token. Not on-chain. Tracked entirely in the "),
    code("users.balance"),
    r(" column."),
  ]),
  h3("Earned via"),
  bullet("Signup: 1,000"),
  bullet("Referral signup: 5,000 (referrer)"),
  bullet("Referral first deposit: 10,000 (referrer, when referred friend deposits real money)"),
  bullet("Daily claim: 100–700 (streak-based)"),
  bullet("Weekly goal (news watch 5 min): 500"),
  bullet("Weekly goal (5 paper trades): 500"),
  bullet("First real deposit: 2,500"),
  bullet("First sports trade: 1,000"),
  h3("Used for"),
  pInline([
    r("Paper trades on "),
    code("/airdrop?tab=trade"),
    r(" (BTC 5-min + AI consensus + sports). Has its own positions ledger."),
  ]),
  h3("Cashed out to USDC"),
  pInline([
    r("Weekly leaderboard winners get a USDC payout funded by the team. Monday 17:00 UTC snapshot writes the winners to "),
    code("prize_payouts"),
    r("; admin sends manually via the Copy manifest button on "),
    code("/admin"),
    r("."),
  ]),

  // ── Cheat sheet ────────────────────────────────────────────────────
  new Paragraph({ children: [new PageBreak()] }),
  h1("Short summaries (cheat sheet)"),
  twoColTable({
    header: ["Concept", "One-liner"],
    body: [
      ["Stack", "Next.js 16 on Vercel + Neon Postgres + Polymarket APIs + Polygon contracts."],
      ["Wallets", "MetaMask/Phantom (RainbowKit) or Google (Magic SDK). Both produce an EOA → derives a CREATE2 proxy wallet on Polygon."],
      ["Where funds live", "User's CREATE2 proxy. We never custody."],
      ["Trade flow", "Sign order → Polymarket CLOB matches → on-chain settlement → fees go to us as builder."],
      ["Cash out", "Sell back to CLOB (live markets) or redeem via CTF / NegRiskAdapter (resolved markets), all gasless via Polymarket Relay Hub."],
      ["AIRDROP token", "Internal paper token, tracked in DB. Earned via streak + goals + referrals. Weekly leaderboard winners get USDC."],
      ["Referral system", "First-touch HTTP cookie (30 day) survives OAuth round-trip. Database UNIQUE constraint on referrals.referred_id makes double-pay impossible."],
      ["Daily streak", "Day N earns N×100 AIRDROP, capped at 7×700. Resets on missed day. Boundary at 17:00 UTC (9am PST)."],
      ["Admin auth", "Phantom Solana signature for one hardcoded pubkey → HMAC HttpOnly cookie."],
      ["Cron", "Vercel `0 17 * * 1` snapshots weekly winners into prize_payouts."],
      ["Observability", "Greppable log prefixes: [signup], [redeem], [backfill-ref], [apply-referral], [referral-deposit]. 3-day Vercel log retention."],
      ["Deploy pipeline", "Push to master on thedopetoad/PolyNews → Vercel auto-deploys → polystream.vercel.app."],
      ["Money model", "Builder fees on real CLOB volume. AIRDROP is the engagement carrot; USDC trades are how we get paid."],
    ],
  }, [2400, 6960]),
];

// ── document ─────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: FONT, color: "1F2937" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: "1F2937" },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: "374151" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
      ],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

const outDir = path.join(__dirname, "..", "docs");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "infrastructure.docx");

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
});
