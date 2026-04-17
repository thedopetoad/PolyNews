import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades, newsWatchHeartbeats } from "@/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { getAuthenticatedUser, generateSecureId } from "@/lib/auth";
import { AIRDROP_AMOUNTS } from "@/lib/constants";
import { isoWeekKey, isoWeekStart } from "@/lib/week";

// POST /api/airdrop/claim-weekly  body: { goal: "news_watch" | "paper_trades" }
//
// Weekly goal claims. Each goal resets Monday 00:00 UTC.
// - news_watch:   5 minutes of news page watch time (20 distinct 15s buckets this week)
// - paper_trades: 5 paper trades made this week
//
// Idempotent via airdrops(userId, source, weekKey) — a claim row with
// the current week blocks re-claim until the next Monday roll.
export async function POST(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { goal } = body as { goal?: string };
    if (goal !== "news_watch" && goal !== "paper_trades") {
      return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
    }

    const db = getDb();
    const weekKey = isoWeekKey();
    const weekStart = isoWeekStart();
    const source = goal === "news_watch" ? "news_watch_weekly" : "paper_trades_weekly";
    const amount = AIRDROP_AMOUNTS.weeklyGoal;

    // Already claimed this week?
    const [existing] = await db
      .select({ id: airdrops.id })
      .from(airdrops)
      .where(and(eq(airdrops.userId, authedUser), eq(airdrops.source, source), eq(airdrops.weekKey, weekKey)))
      .limit(1);
    if (existing) {
      return NextResponse.json({ error: "Already claimed this week", claimed: true }, { status: 400 });
    }

    // Progress check
    if (goal === "news_watch") {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)`.as("count") })
        .from(newsWatchHeartbeats)
        .where(and(eq(newsWatchHeartbeats.userId, authedUser), eq(newsWatchHeartbeats.weekKey, weekKey)));
      const buckets = Number(row?.count || 0);
      if (buckets < 20) {
        return NextResponse.json({ error: `Need 5 minutes of watch time (${buckets}/20 buckets)`, progress: buckets, required: 20 }, { status: 400 });
      }
    } else {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)`.as("count") })
        .from(trades)
        .where(and(eq(trades.userId, authedUser), gte(trades.createdAt, weekStart)));
      const count = Number(row?.count || 0);
      if (count < 5) {
        return NextResponse.json({ error: `Need 5 paper trades this week (${count}/5)`, progress: count, required: 5 }, { status: 400 });
      }
    }

    // Grant — credit balance and log airdrop.
    await db
      .update(users)
      .set({ balance: sql`${users.balance} + ${amount}` })
      .where(eq(users.id, authedUser));

    await db.insert(airdrops).values({
      id: generateSecureId(),
      userId: authedUser,
      source,
      amount,
      weekKey,
    });

    return NextResponse.json({ ok: true, amount, weekKey });
  } catch (err) {
    console.error("Weekly claim error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
