import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades, newsWatchHeartbeats, positions } from "@/db";
import { eq, and, sql, gte, count } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { dailyClaimKey, dailyClaimStart } from "@/lib/week";
import { activeStreak, nextStreak, streakReward, DAILY_STREAK_CAP } from "@/lib/daily-streak";
import { AIRDROP_AMOUNTS } from "@/lib/constants";

// GET /api/airdrop/me
//
// Returns everything the Earn tab needs to render milestone progress:
// - user's total lifetime airdrop
// - today's news-watch progress + per-tier claim state (5m/15m/30m/2h)
// - today's paper-trade progress + claim state
// - one-time boost flags (first deposit, first sports trade)
// - daily claim status + referral count
export async function GET(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    // All daily windows roll at 17:00 UTC (9am PST) to match the daily
    // claim + the UI label.
    const todayKey = dailyClaimKey();
    const todayStart = dailyClaimStart();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, authedUser))
      .limit(1);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [
      [totalRow],
      openPositions,
      [newsRow],
      [tradeRow],
      todaysClaims,
      [refRow],
    ] = await Promise.all([
      db
        .select({ total: sql<number>`COALESCE(SUM(${airdrops.amount}), 0)`.as("total") })
        .from(airdrops)
        .where(eq(airdrops.userId, authedUser)),
      db
        .select({ shares: positions.shares, avgPrice: positions.avgPrice, tradeType: positions.tradeType })
        .from(positions)
        .where(eq(positions.userId, authedUser)),
      db
        .select({ c: count() })
        .from(newsWatchHeartbeats)
        .where(and(eq(newsWatchHeartbeats.userId, authedUser), gte(newsWatchHeartbeats.createdAt, todayStart))),
      db
        .select({ c: count() })
        .from(trades)
        .where(and(eq(trades.userId, authedUser), gte(trades.createdAt, todayStart))),
      db
        .select({ source: airdrops.source })
        .from(airdrops)
        .where(and(eq(airdrops.userId, authedUser), eq(airdrops.weekKey, todayKey))),
      db
        .select({ c: count() })
        .from(users)
        .where(eq(users.referredBy, user.referralCode)),
    ]);

    const totalGranted = Math.round(Number(totalRow?.total || 0));
    const openPositionValue = openPositions
      .filter((p) => p.tradeType !== "real")
      .reduce((s, p) => s + p.shares * p.avgPrice, 0);
    const netWorth = Math.round(user.balance + openPositionValue);

    const newsBuckets = Number(newsRow?.c || 0);
    const newsSecondsToday = newsBuckets * 15;
    const tradesToday = Number(tradeRow?.c || 0);
    const claimedSet = new Set(todaysClaims.map((r) => r.source));

    // Build the 4 news-watch tiers. UI renders one tile per tier; all
    // share the same underlying progress (newsSecondsToday) so watching
    // once fills every bar simultaneously.
    const newsTiers: Array<{
      id: "5m" | "15m" | "30m" | "2h";
      requiredSeconds: number;
      reward: number;
      claimed: boolean;
    }> = [
      { id: "5m", requiredSeconds: 5 * 60, reward: AIRDROP_AMOUNTS.newsWatch5mDaily, claimed: claimedSet.has("news_watch_5m_daily") },
      { id: "15m", requiredSeconds: 15 * 60, reward: AIRDROP_AMOUNTS.newsWatch15mDaily, claimed: claimedSet.has("news_watch_15m_daily") },
      { id: "30m", requiredSeconds: 30 * 60, reward: AIRDROP_AMOUNTS.newsWatch30mDaily, claimed: claimedSet.has("news_watch_30m_daily") },
      { id: "2h", requiredSeconds: 2 * 60 * 60, reward: AIRDROP_AMOUNTS.newsWatch2hDaily, claimed: claimedSet.has("news_watch_2h_daily") },
    ];

    return NextResponse.json({
      totalAirdrop: netWorth,
      totalGranted,
      balance: user.balance,
      openPositionValue: Math.round(openPositionValue),
      referralCode: user.referralCode,
      referralCount: Number(refRow?.c || 0),
      referredBy: user.referredBy,
      dailyClaim: {
        claimed: user.lastDailyAirdrop === todayKey,
        currentStreak: activeStreak(user.lastDailyAirdrop, user.dailyStreak),
        nextStreak: nextStreak(user.lastDailyAirdrop, user.dailyStreak),
        nextReward: streakReward(nextStreak(user.lastDailyAirdrop, user.dailyStreak)),
        cap: DAILY_STREAK_CAP,
      },
      dailyGoals: {
        newsWatch: {
          progressSeconds: newsSecondsToday,
          tiers: newsTiers,
        },
        paperTrades: {
          progress: tradesToday,
          required: 5,
          reward: AIRDROP_AMOUNTS.paperTradesDaily,
          claimed: claimedSet.has("paper_trades_daily"),
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
