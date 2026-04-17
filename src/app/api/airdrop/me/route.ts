import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades, newsWatchHeartbeats, positions } from "@/db";
import { eq, and, sql, gte, count } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { isoWeekKey, isoWeekStart } from "@/lib/week";

// GET /api/airdrop/me
//
// Returns everything the Earn tab needs to render milestone progress:
// - user's total lifetime airdrop
// - this-week progress for each weekly goal (+ whether already claimed)
// - one-time boost flags (first deposit, first sports trade)
// - daily claim status + referral count
export async function GET(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const weekKey = isoWeekKey();
    const weekStart = isoWeekStart();
    const todayUTC = new Date().toISOString().slice(0, 10);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, authedUser))
      .limit(1);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Total lifetime airdrop (sum of grants). This is interesting but
    // NOT the number we show as "Your AIRDROP total" — that should match
    // the Portfolio tab (balance + open-position value at entry price).
    const [totalRow] = await db
      .select({ total: sql<number>`COALESCE(SUM(${airdrops.amount}), 0)`.as("total") })
      .from(airdrops)
      .where(eq(airdrops.userId, authedUser));
    const totalGranted = Math.round(Number(totalRow?.total || 0));

    // Open paper-position value at entry price. Live prices aren't fetched
    // here (that would slow the endpoint); the Portfolio tab hydrates live
    // prices separately. Entry-price value matches what the Portfolio balance
    // card shows when prices haven't streamed in yet, so the two tabs agree.
    const openPositions = await db
      .select({ shares: positions.shares, avgPrice: positions.avgPrice, tradeType: positions.tradeType })
      .from(positions)
      .where(eq(positions.userId, authedUser));
    const openPositionValue = openPositions
      .filter((p) => p.tradeType !== "real")
      .reduce((s, p) => s + p.shares * p.avgPrice, 0);
    const netWorth = Math.round(user.balance + openPositionValue);

    // News watch progress this week (in seconds; each bucket = 15s)
    const [newsRow] = await db
      .select({ count: count() })
      .from(newsWatchHeartbeats)
      .where(and(eq(newsWatchHeartbeats.userId, authedUser), eq(newsWatchHeartbeats.weekKey, weekKey)));
    const newsBuckets = Number(newsRow?.count || 0);
    const newsSeconds = Math.min(newsBuckets * 15, 300);

    // Paper trades this week
    const [tradeRow] = await db
      .select({ count: count() })
      .from(trades)
      .where(and(eq(trades.userId, authedUser), gte(trades.createdAt, weekStart)));
    const tradesThisWeek = Number(tradeRow?.count || 0);

    // Weekly claims already grabbed?
    const thisWeekClaims = await db
      .select({ source: airdrops.source })
      .from(airdrops)
      .where(and(eq(airdrops.userId, authedUser), eq(airdrops.weekKey, weekKey)));
    const claimedSet = new Set(thisWeekClaims.map((r) => r.source));

    // Referral count (users whose referredBy = my code)
    const [refRow] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.referredBy, user.referralCode));

    return NextResponse.json({
      // "totalAirdrop" is the headline number — net worth (balance +
      // open positions), so Earn and Portfolio tabs show the same thing.
      totalAirdrop: netWorth,
      // Kept for future use (e.g. "you've earned N grants over all time").
      totalGranted,
      balance: user.balance,
      openPositionValue: Math.round(openPositionValue),
      referralCode: user.referralCode,
      referralCount: Number(refRow?.count || 0),
      referredBy: user.referredBy,
      dailyClaim: {
        claimed: user.lastDailyAirdrop === todayUTC,
      },
      weeklyGoals: {
        newsWatch: {
          progress: newsSeconds,
          required: 300, // 5 min
          claimed: claimedSet.has("news_watch_weekly"),
        },
        paperTrades: {
          progress: tradesThisWeek,
          required: 5,
          claimed: claimedSet.has("paper_trades_weekly"),
        },
      },
      oneTimeBoosts: {
        firstDeposit: { paid: user.firstDepositBonusPaid },
        firstSportsTrade: { paid: user.firstSportsTradeBonusPaid },
      },
    });
  } catch (err) {
    console.error("/api/airdrop/me error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
