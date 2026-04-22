import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades, newsWatchHeartbeats } from "@/db";
import { eq, and, sql, gte, count } from "drizzle-orm";
import { getAuthenticatedUser, generateSecureId } from "@/lib/auth";
import { AIRDROP_AMOUNTS } from "@/lib/constants";
import { dailyClaimKey, dailyClaimStart } from "@/lib/week";

// POST /api/airdrop/claim-weekly
//
// Despite the legacy URL, this endpoint now handles DAILY goal claims.
// Five goal ids, each claimable once per day (window rolls at 17:00 UTC
// = 9am PST to match the daily-streak claim):
//
//   news_watch_5m   — 5 minutes of news page watch time today   (+100)
//   news_watch_15m  — 15 minutes                                 (+300)
//   news_watch_30m  — 30 minutes                                 (+600)
//   news_watch_2h   — 2 hours                                    (+2400)
//   paper_trades    — 5 paper trades today                       (+500)
//
// Idempotency: airdrops(userId, source, weekKey=todaysDailyKey). We
// still store the day key in the `weekKey` column — same uniqueness
// guarantee, no schema change needed.

interface NewsGoalConfig {
  kind: "news";
  seconds: number;
  source: string;
  reward: number;
}
interface TradeGoalConfig {
  kind: "trade";
  count: number;
  source: string;
  reward: number;
}
type GoalConfig = NewsGoalConfig | TradeGoalConfig;

const DAILY_GOALS: Record<string, GoalConfig> = {
  news_watch_5m: {
    kind: "news",
    seconds: 5 * 60,
    source: "news_watch_5m_daily",
    reward: AIRDROP_AMOUNTS.newsWatch5mDaily,
  },
  news_watch_15m: {
    kind: "news",
    seconds: 15 * 60,
    source: "news_watch_15m_daily",
    reward: AIRDROP_AMOUNTS.newsWatch15mDaily,
  },
  news_watch_30m: {
    kind: "news",
    seconds: 30 * 60,
    source: "news_watch_30m_daily",
    reward: AIRDROP_AMOUNTS.newsWatch30mDaily,
  },
  news_watch_2h: {
    kind: "news",
    seconds: 2 * 60 * 60,
    source: "news_watch_2h_daily",
    reward: AIRDROP_AMOUNTS.newsWatch2hDaily,
  },
  paper_trades: {
    kind: "trade",
    count: 5,
    source: "paper_trades_daily",
    reward: AIRDROP_AMOUNTS.paperTradesDaily,
  },
};

export async function POST(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const goal = body.goal as string | undefined;
    const config = goal ? DAILY_GOALS[goal] : undefined;
    if (!config) {
      return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
    }

    const db = getDb();
    const dayKey = dailyClaimKey();
    const dayStart = dailyClaimStart();

    // Already claimed this goal today?
    const [existing] = await db
      .select({ id: airdrops.id })
      .from(airdrops)
      .where(
        and(
          eq(airdrops.userId, authedUser),
          eq(airdrops.source, config.source),
          eq(airdrops.weekKey, dayKey),
        ),
      )
      .limit(1);
    if (existing) {
      return NextResponse.json(
        { error: "Already claimed today", claimed: true },
        { status: 400 },
      );
    }

    if (config.kind === "news") {
      // Count today's 15-second heartbeat buckets. Each bucket = 15s
      // of watch time (capped at 1× per bucket-id by the unique index).
      const [row] = await db
        .select({ c: count() })
        .from(newsWatchHeartbeats)
        .where(
          and(
            eq(newsWatchHeartbeats.userId, authedUser),
            gte(newsWatchHeartbeats.createdAt, dayStart),
          ),
        );
      const buckets = Number(row?.c || 0);
      const secondsWatched = buckets * 15;
      if (secondsWatched < config.seconds) {
        return NextResponse.json(
          {
            error: `Need ${Math.round(config.seconds / 60)} min of watch time today (${secondsWatched}s / ${config.seconds}s)`,
            progress: secondsWatched,
            required: config.seconds,
          },
          { status: 400 },
        );
      }
    } else {
      const [row] = await db
        .select({ c: count() })
        .from(trades)
        .where(
          and(eq(trades.userId, authedUser), gte(trades.createdAt, dayStart)),
        );
      const tradeCount = Number(row?.c || 0);
      if (tradeCount < config.count) {
        return NextResponse.json(
          {
            error: `Need ${config.count} paper trades today (${tradeCount}/${config.count})`,
            progress: tradeCount,
            required: config.count,
          },
          { status: 400 },
        );
      }
    }

    // Grant: credit balance + log to airdrops ledger.
    await db
      .update(users)
      .set({ balance: sql`${users.balance} + ${config.reward}` })
      .where(eq(users.id, authedUser));

    await db.insert(airdrops).values({
      id: generateSecureId(),
      userId: authedUser,
      source: config.source,
      amount: config.reward,
      weekKey: dayKey,
    });

    return NextResponse.json({ ok: true, amount: config.reward, dayKey });
  } catch (err) {
    console.error("Daily goal claim error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
