"""
Generates docs/infrastructure.pdf — the end-to-end PolyStream stack
writeup, in PDF form.

Run with:  python scripts/generate-infra-pdf.py
"""

from datetime import date
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, Preformatted, KeepTogether,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── monospace font for inline code + ASCII diagrams ─────────────────
# Default Courier doesn't have Unicode box-drawing glyphs (┌─┐│└┘▶◀▼)
# — they render as solid black blocks. Register Consolas (always on
# Windows) or fall back to common alternatives on other OSes.
MONO = "Courier"
for path in [
    r"C:\Windows\Fonts\consola.ttf",
    r"C:\Windows\Fonts\lucon.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/Library/Fonts/Menlo.ttc",
]:
    try:
        pdfmetrics.registerFont(TTFont("UnicodeMono", path))
        MONO = "UnicodeMono"
        break
    except Exception:
        continue

# ── page geometry ────────────────────────────────────────────────────
MARGIN = 0.7 * inch
CONTENT_W = LETTER[0] - 2 * MARGIN

# ── colors ───────────────────────────────────────────────────────────
INK = HexColor("#0F172A")            # near-black headings/body
BODY = HexColor("#1F2937")           # body text (slightly lighter)
SUBTLE = HexColor("#6B7280")
LINE = HexColor("#E5E7EB")
HEADER_BG = HexColor("#1F2937")      # dark navy table headers
HEADER_FG = HexColor("#FFFFFF")      # white text on dark header
ROW_ALT = HexColor("#F3F4F6")        # zebra
ACCENT = HexColor("#2563EB")
CODE_BG = HexColor("#F9FAFB")

# ── paragraph styles ─────────────────────────────────────────────────
S_TITLE = ParagraphStyle(
    "Title", fontName="Helvetica-Bold", fontSize=30, leading=36,
    textColor=INK, alignment=TA_CENTER,
)
S_SUBTITLE = ParagraphStyle(
    "Subtitle", fontName="Helvetica", fontSize=11, leading=15,
    textColor=SUBTLE, alignment=TA_CENTER, spaceAfter=4,
)
S_LEAD = ParagraphStyle(
    "Lead", fontName="Helvetica", fontSize=11, leading=16,
    textColor=BODY, alignment=TA_LEFT, spaceAfter=8,
)
S_H1 = ParagraphStyle(
    "H1", fontName="Helvetica-Bold", fontSize=18, leading=22,
    textColor=INK, spaceBefore=20, spaceAfter=8, keepWithNext=1,
)
S_H2 = ParagraphStyle(
    "H2", fontName="Helvetica-Bold", fontSize=12, leading=16,
    textColor=INK, spaceBefore=10, spaceAfter=4, keepWithNext=1,
)
S_BODY = ParagraphStyle(
    "Body", fontName="Helvetica", fontSize=10, leading=14,
    textColor=BODY, spaceAfter=6,
)
S_BULLET = ParagraphStyle(
    "Bullet", parent=S_BODY, leftIndent=14, spaceAfter=2,
)
S_CELL = ParagraphStyle(
    "Cell", fontName="Helvetica", fontSize=9.5, leading=12,
    textColor=BODY,
)
S_CELL_HEAD = ParagraphStyle(
    "CellHead", fontName="Helvetica-Bold", fontSize=10, leading=13,
    textColor=HEADER_FG,
)
S_CELL_KEY = ParagraphStyle(
    "CellKey", fontName="Helvetica-Bold", fontSize=9.5, leading=12,
    textColor=INK,
)
S_DIAGRAM = ParagraphStyle(
    "Diagram", fontName=MONO, fontSize=8.5, leading=10.5,
    textColor=INK, backColor=CODE_BG, borderPadding=8,
    leftIndent=0, rightIndent=0,
)

# ── helpers ──────────────────────────────────────────────────────────
def H1(text): return Paragraph(text, S_H1)
def H2(text): return Paragraph(text, S_H2)
def P(text): return Paragraph(text, S_BODY)
def B(text): return Paragraph(f"•&nbsp;&nbsp;{text}", S_BULLET)
def code(s): return f'<font name="{MONO}" size="9">{s}</font>'
def bold(s): return f"<b>{s}</b>"

def diagram(text):
    return Preformatted(text, S_DIAGRAM)

def make_table(rows, col_widths, key_col=True, keep=True):
    """
    rows[0] = header (rendered with white text on dark bg)
    rows[1:] = body (zebra-striped, optional bold first col)
    col_widths in inches, will be normalized to fit CONTENT_W
    """
    # Normalize widths to fit content area exactly
    total = sum(col_widths)
    widths = [w / total * CONTENT_W for w in col_widths]

    # Build cells with the right styles per row
    table_data = []
    table_data.append([Paragraph(c, S_CELL_HEAD) for c in rows[0]])
    for r in rows[1:]:
        cells = []
        for i, c in enumerate(r):
            style = S_CELL_KEY if (key_col and i == 0) else S_CELL
            cells.append(Paragraph(c, style))
        table_data.append(cells)

    t = Table(table_data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
        ("LINEBELOW", (0, 1), (-1, -2), 0.25, LINE),
    ]
    # Zebra striping
    for i in range(1, len(table_data)):
        if i % 2 == 1:
            cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(cmds))
    return KeepTogether(t) if keep else t

# ── content building blocks ──────────────────────────────────────────
overview_diagram = """\
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
                       └─────────────────┘      └────────────────────┘      └─────────────────┘"""

money_diagram = """\
External wallet (any chain)
        │
        │  1. Bridge or direct USDC.e on Polygon
        ▼
USER'S POLYMARKET PROXY  (CREATE2 from EOA)
        │
        │  2. Sign trade order
        ▼
Polymarket CLOB  ─────  matches with counterparty  ─────  settles on-chain
        │                                                          │
        │  3. Outcome tokens minted/transferred                     │  Fees → builder = us
        ▼                                                           │
USER'S PROXY  (now holds outcome shares)                            │
        │                                                           │
        │  4a. Sell back to CLOB                4b. Market resolved → Redeem
        ▼                                          ▼
Proxy gets USDC.e back            Proxy gets winnings via CTF or NegRiskAdapter
        │
        │  5. Withdraw via gasless relay
        ▼
External wallet (Polygon, Ethereum, Base, or Solana via bridge)"""

# ── document assembly ────────────────────────────────────────────────
out_path = Path(__file__).parent.parent / "docs" / "infrastructure.pdf"
out_path.parent.mkdir(parents=True, exist_ok=True)

doc = SimpleDocTemplate(
    str(out_path), pagesize=LETTER,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=0.85 * inch,
    title="PolyStream Infrastructure", author="PolyStream",
)

s = []  # story

# ── Title page ───────────────────────────────────────────────────────
s.append(Spacer(1, 1.6 * inch))
s.append(Paragraph("PolyStream", S_TITLE))
s.append(Paragraph("Infrastructure Reference", S_TITLE))
s.append(Spacer(1, 0.25 * inch))
s.append(Paragraph(f"End-to-end architecture · {date.today().isoformat()}", S_SUBTITLE))
s.append(Spacer(1, 0.5 * inch))
s.append(Paragraph(
    "PolyStream is a builder on top of Polymarket. Real bets settle on Polygon through "
    "Polymarket's contracts; we earn a cut of the fees as the registered builder on every "
    "order. This document covers every layer of the system — frontend, server, database, "
    "blockchain, external APIs, auth, money flow, and the in-app AIRDROP token economy.",
    S_LEAD,
))
s.append(PageBreak())

# ── 1. Bird's-eye view ──────────────────────────────────────────────
s.append(H1("1. Bird's-eye view"))
s.append(diagram(overview_diagram))
s.append(Spacer(1, 6))
s.append(P(
    "Two clients on top — the React app in the user's browser, and the Vercel server "
    "rendering it. The chain (Polygon) is the source of truth for money; Neon Postgres "
    "is the source of truth for everything else (accounts, paper trades, leaderboard "
    "snapshots). Polymarket's APIs are the trading backend we build on. External APIs "
    "(OpenAI, YouTube, RSS, Rumble, ESPN) feed the news and AI features."
))

# ── 2. Frontend ──────────────────────────────────────────────────────
s.append(H1("2. Frontend (browser)"))
s.append(P(
    f"{bold('Framework:')} Next.js 16 with the App Router. Mix of React Server Components "
    f"for cheap initial render and Client Components for anything with state, wallet "
    f"hooks, or React Query."
))

s.append(H2("State management"))
s.append(B(f"{bold('React Query')} — server-data caching, background refetch, optimistic updates. "
           "Used for everything that hits an API."))
s.append(B(f"{bold('Zustand stores')} ({code('use-auth-store')}, {code('use-news-store')}) — "
           "small bits of cross-component state."))
s.append(B(f"{bold('localStorage')} — closed-positions ledger, pending trades, pending bridges (each with TTLs)."))
s.append(B(f"{bold('sessionStorage')} — login return-path, fallback referral code (cookie is primary)."))

s.append(H2("Wallet stack"))
s.append(B(f"{bold('RainbowKit + Wagmi')} — MetaMask, Phantom, Coinbase, WalletConnect. Standard EVM wallet flows."))
s.append(B(
    f"{bold('Magic SDK')} ({code('@magic-ext/oauth2')}) — Google login. User signs in with "
    f"Google, Magic generates a Polygon wallet for them deterministically. We treat the "
    f"Magic-generated address as their EOA — same downstream code path as MetaMask users."
))
s.append(B(f"{bold('viem')} — low-level chain interactions, encoding calldata, reading contracts."))

s.append(H2("Trading SDK"))
s.append(B(f"{code('@polymarket/builder-relayer-client')} — submits gasless transactions through "
           "Polymarket's relay hub (USDC.e transfers, position redemptions)."))
s.append(B(f"{code('@polymarket/builder-signing-sdk')} — HMAC-signed builder headers; the secret "
           f"stays server-side at {code('/api/polymarket/builder-headers')}."))

# ── 3. Server ────────────────────────────────────────────────────────
s.append(H1("3. Server (Vercel)"))
s.append(P(
    f"{bold('Hosting:')} Vercel Pro tier ($20/mo). Project {code('polystream')} in org "
    f"{code('williamnuuh-7435s-projects')}. Auto-deploys on push to {code('master')} of "
    f"GitHub repo {code('thedopetoad/PolyNews')}."
))
s.append(P(
    f"{bold('Runtime:')} mix of Edge functions (low-latency, 1MB bundle limit, no Node APIs) "
    f"and Serverless functions (full Node, slower cold starts). Anything touching "
    f"Drizzle/Neon runs serverless."
))

s.append(H2("Middleware"))
s.append(P(f"{code('src/middleware.ts')} runs before every request:"))
s.append(B("Sets security headers (CSP, HSTS, X-Frame-Options, etc.)"))
s.append(B("Rate-limits API calls (60/min general, 10/min for /api/airdrop + /api/trade)"))
s.append(B(f"{bold('First-touch referral cookie')} — captures {code('?ref=…')} from URL into a "
           "30-day SameSite=Lax cookie that survives Google OAuth round-trips."))

s.append(H2("Cron"))
s.append(P(f"Vercel's built-in scheduler. {code('0 17 * * 1')} calls "
           f"{code('/api/cron/weekly-snapshot')} to write that week's leaderboard winners "
           f"into {code('prize_payouts')}. Gated by a {code('CRON_SECRET')} env var."))

s.append(H2("Logs"))
s.append(P(f"3-day retention on Pro tier. Observability lines tagged with greppable prefixes: "
           f"{code('[signup]')}, {code('[redeem]')}, {code('[backfill-ref]')}, "
           f"{code('[apply-referral]')}, {code('[referral-deposit]')}."))

# ── 4. Database ──────────────────────────────────────────────────────
s.append(PageBreak())
s.append(H1("4. Database (Neon Postgres)"))
s.append(P(f"{bold('Provider:')} Neon, serverless Postgres on AWS via Vercel Marketplace. "
           "Drizzle ORM for queries + schema management."))

s.append(H2("Tables"))
s.append(make_table(
    [["Table", "Purpose"],
     ["users", "One row per account. EOA address as PK. Holds AIRDROP balance, displayName, email, referredBy code, signup IP, daily streak, one-time-boost flags."],
     ["positions", "Paper-trade positions on the AIRDROP token. Real trades aren't here — they live on Polymarket's data-api."],
     ["trades", "Paper-trade execution history."],
     ["airdrops", "Ledger of every AIRDROP grant (signup, daily, referral, weekly goal, etc)."],
     ["referrals", "(referrer_id, referred_id) pairs. UNIQUE on referred_id — the database-level lock that prevents double-paying. Has source + referralDepositBonusPaid flags."],
     ["news_watch_heartbeats", "15-second buckets pinged from the News page. 20 distinct buckets in a week = 5-min news goal complete."],
     ["youtube_stream_cache", "Resolved live-stream IDs cached 30 min to stay under YouTube API quota."],
     ["consensus_cache", "AI-debate output cached 5 hours per market."],
     ["settings", "Key/value store. Currently holds the 6 prize-amount values for the leaderboard pills."],
     ["prize_payouts", "Weekly leaderboard winner snapshots. (weekKey, leaderboard, place) unique."]],
    [1.5, 4.5],
    keep=False,  # too long to fit one page; allow split
))
s.append(Spacer(1, 8))
s.append(P(f"{bold('Schema migrations:')} {code('npx drizzle-kit push')} reads "
           f"{code('schema.ts')}, diffs against the live DB, prints the SQL it'll run, "
           "and applies on confirm. No migration files — Drizzle infers from the schema directly."))

# ── 5. Polygon ───────────────────────────────────────────────────────
s.append(H1("5. Polygon blockchain"))
s.append(P(f"{bold('Why Polygon:')} Polymarket lives on Polygon. Every real bet, every "
           "cash-out, every redemption is a Polygon transaction."))

s.append(H2("Contracts we touch"))
s.append(make_table(
    [["Contract", "Address", "Purpose"],
     ["USDC.e", "0x2791Bca1...A84174", "Bridged USDC. Polymarket's collateral token."],
     ["CTF (Conditional Tokens)", "0x4D97DCd9...076045", "ERC-1155 holding outcome shares. Where redeem happens for binary markets."],
     ["CTF Exchange", "0x4bFb41d5...8B8982E", "Where binary-market trades match."],
     ["NegRisk CTF Exchange", "0xC5d563A3...220f80a", "Same but for NegRisk (multi-outcome) markets."],
     ["NegRisk Adapter", "0xd91E80cF...0DA35296", "Where NegRisk redemption + position prep happens."],
     ["Polymarket Relay Hub", "0xD216153c...172F494", "Gasless tx submission. We sign, hub pays gas, fee taken from user's USDC.e."]],
    [1.7, 1.7, 3.0],
))
s.append(Spacer(1, 8))
s.append(P(f"{bold('Wallet derivation (CREATE2 proxy):')} every EOA has a deterministic "
           f"Polymarket proxy wallet derived via {code('getCreate2Address')} from the EOA. "
           "Funds live in the proxy. Trades execute from the proxy. The user signs from "
           "their EOA but transactions move funds in/out of the proxy."))

s.append(H2("RPC endpoints"))
s.append(B(f"{code('drpc.org')} — primary, CORS-friendly, used by wagmi + Magic + most reads"))
s.append(B(f"{code('polygon-pokt.nodies.app')} — used for {code('eth_getLogs')} (drpc free tier caps too low)"))
s.append(B(f"{code('Alchemy')} — used for {code('waitForTransactionReceipt')} after redeem submissions"))

# ── 6. Polymarket APIs ───────────────────────────────────────────────
s.append(PageBreak())
s.append(H1("6. Polymarket APIs (the real backend)"))
s.append(P("We're not the backend for trading — Polymarket is. We're a builder on top."))
s.append(make_table(
    [["API", "Host", "What it does"],
     ["CLOB", "clob.polymarket.com", "Place + cancel orders, get orderbook prices. Returns auth credentials we cache."],
     ["Data API", "data-api.polymarket.com", "Read positions, activity (trade history), portfolio value. Source of truth."],
     ["Gamma API", "gamma-api.polymarket.com", "Market + event metadata. Categories, end dates, conditionIds, negRisk flags."],
     ["Relayer V2", "relayer-v2.polymarket.com", "Gasless transaction submission. Fees taken from proxy USDC.e balance."],
     ["Bridge", "bridge.polymarket.com", "Cross-chain deposits (Ethereum / Base / Solana → Polygon proxy)."]],
    [1.0, 2.0, 3.4],
))
s.append(Spacer(1, 8))
s.append(P(f"{bold('Builder fees:')} by setting our address as the builder on every order "
           "(via the builder-signing SDK), Polymarket pays us a cut of the fees on trades "
           f"placed through PolyStream. {bold('This is the actual revenue model.')}"))

# ── 7. External APIs ─────────────────────────────────────────────────
s.append(H1("7. External APIs"))
s.append(make_table(
    [["API", "Purpose", "Auth"],
     ["OpenAI (GPT-4o-mini)", "AI Consensus — 5 personas debate over 3 rounds with live web search context", "API key"],
     ["YouTube Data API v3", "Discover live streams for 6 of the 7 channels on the News page", "API key (10k req/day)"],
     ["Rumble (oEmbed + scrape)", "Discovers the Alex Jones stream (1 of 7 News-page channels)", "None"],
     ["RSS feeds (BBC, NYT, NPR)", "News headlines for the ticker", "None"],
     ["ESPN site.api.espn.com", "Sports event data, team logos, schedules", "None"]],
    [1.7, 3.4, 1.3],
))

# ── 8. Auth ──────────────────────────────────────────────────────────
s.append(H1("8. Auth flows"))

s.append(H2("Wallet auth (MetaMask / Phantom / Coinbase)"))
s.append(B("User clicks Connect Wallet → wagmi connects → returns EOA address"))
s.append(B(f"We POST {code('/api/user')} with " + code("{id, authMethod: 'wallet'}")))
s.append(B("Server creates row if new, returns user record"))
s.append(B(f"Subsequent API calls include {code('Authorization: Bearer &lt;address&gt;')} header"))

s.append(H2("Google auth (Magic)"))
s.append(B("User clicks Continue with Google → Magic redirects to Google OAuth"))
s.append(B(f"Google returns to {code('/')} with state+code params"))
s.append(B("Magic SDK exchanges code, returns the user's deterministic Polygon address + email"))
s.append(B(f"We POST {code('/api/user')} with " + code("{id, authMethod: 'google', email}")))
s.append(B("Server records the user, pays any signup-referral bonus, returns record"))

s.append(H2("Admin auth"))
s.append(B(f"Phantom Solana wallet sign-in. Single hardcoded pubkey in {code('src/lib/admin-auth.ts')}."))
s.append(B("Server verifies the signature, sets HMAC-signed HttpOnly cookie, 24h TTL."))
s.append(B("Cookie present + Phantom still trusts site = admin access."))

# ── 9. Money flow ────────────────────────────────────────────────────
s.append(PageBreak())
s.append(H1("9. Money flow"))
s.append(diagram(money_diagram))
s.append(Spacer(1, 8))
s.append(P("The platform itself never custodies user funds. Everything sits in the user's "
           "CREATE2 proxy, which only their EOA can sign for."))

# ── 10. AIRDROP token ────────────────────────────────────────────────
s.append(H1("10. AIRDROP token (paper)"))
s.append(P(f"A separate, internal-only token. Not on-chain. Tracked entirely in the "
           f"{code('users.balance')} column."))

s.append(H2("Earned via"))
s.append(make_table(
    [["Source", "Amount", "When"],
     ["Signup", "1,000", "Account creation"],
     ["Referral signup", "5,000 (referrer)", "Friend signs up via your link"],
     ["Referral first deposit", "10,000 (referrer)", "Referred friend deposits real USDC"],
     ["Daily claim", "100–700", "Streak: Day N earns N×100, capped at Day 7"],
     ["Weekly news watch", "500", "5 minutes of news consumed in a week"],
     ["Weekly paper trades", "500", "5 paper trades placed in a week"],
     ["First real deposit", "2,500", "Your first USDC bridge in"],
     ["First sports trade", "1,000", "Your first real CLOB sports order"]],
    [1.8, 1.5, 3.1],
))
s.append(Spacer(1, 8))

s.append(H2("Used for"))
s.append(P(f"Paper trades on {code('/airdrop?tab=trade')} (BTC 5-min + AI consensus + sports). "
           "Has its own positions ledger. Resolved-market wins claim at $1/share via the "
           "same close-position dialog."))

s.append(H2("Cashed out to USDC"))
s.append(P("Weekly leaderboard winners get a USDC payout funded by the team. Monday 17:00 "
           f"UTC snapshot writes the winners to {code('prize_payouts')}; admin sends "
           f"manually via the Copy manifest button on {code('/admin')}."))

# ── 11. Cheat sheet ──────────────────────────────────────────────────
s.append(PageBreak())
s.append(H1("11. Cheat sheet"))
s.append(P("One-liner reference for the whole system."))
s.append(make_table(
    [["Concept", "One-liner"],
     ["Stack", "Next.js 16 on Vercel + Neon Postgres + Polymarket APIs + Polygon contracts."],
     ["Wallets", "MetaMask/Phantom (RainbowKit) or Google (Magic SDK). Both produce an EOA → derives a CREATE2 proxy on Polygon."],
     ["Where funds live", "User's CREATE2 proxy. We never custody."],
     ["Trade flow", "Sign order → Polymarket CLOB matches → on-chain settlement → fees go to us as builder."],
     ["Cash out (live market)", "Sell back to CLOB at the current mid via gasless relay."],
     ["Cash out (resolved market)", "Redeem via CTF (binary) or NegRiskAdapter (multi-outcome). Same gasless relay."],
     ["AIRDROP token", "Internal paper token. Earned via streak + goals + referrals. Weekly leaderboard winners get USDC."],
     ["Referral system", "First-touch HTTP cookie (30 day) survives OAuth. UNIQUE constraint on referrals.referred_id makes double-pay impossible."],
     ["Daily streak", "Day N earns N×100 AIRDROP, capped at 7×700. Resets on missed day. Boundary at 17:00 UTC (9am PST)."],
     ["Admin auth", "Phantom Solana signature for one hardcoded pubkey → HMAC HttpOnly cookie, 24h TTL."],
     ["Cron", "Vercel `0 17 * * 1` snapshots weekly winners into prize_payouts."],
     ["Observability", "Greppable log prefixes: [signup], [redeem], [backfill-ref], [apply-referral], [referral-deposit]."],
     ["Deploy pipeline", "Push to master on thedopetoad/PolyNews → Vercel auto-deploys → polystream.vercel.app."],
     ["Money model", "Builder fees on real CLOB volume. AIRDROP is the engagement carrot; USDC trades are how we get paid."]],
    [1.7, 4.3],
    keep=False,  # let it split if it must
))

# ── footer ───────────────────────────────────────────────────────────
def footer(canv, doc):
    canv.saveState()
    canv.setFont("Helvetica", 8)
    canv.setFillColor(SUBTLE)
    canv.drawString(MARGIN, 0.45 * inch, "PolyStream Infrastructure")
    canv.drawRightString(LETTER[0] - MARGIN, 0.45 * inch, f"Page {doc.page}")
    canv.restoreState()

doc.build(s, onFirstPage=footer, onLaterPages=footer)
print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")
