import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades, positions } from "@/db";
import { eq, asc } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { STARTING_BALANCE } from "@/lib/constants";

// GET /api/airdrop/history
//
// Reconstructs the user's AIRDROP-token balance over time from the
// immutable ledger (airdrops grants + trades). Each trade changes
// AIRDROP balance — buy subtracts shares*price, sell adds it.
//
// Returns an array of points { t, balance } plus the current net worth
// (balance + open-position market value at last traded price, since we
// don't have live prices on this endpoint — the portfolio page lives-
// refreshes those).
//
// The final point is "now" with the current users.balance (authoritative).
export async function GET(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();

    const [user] = await db.select().from(users).where(eq(users.id, authedUser)).limit(1);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const [grants, tradeRows, positionRows] = await Promise.all([
      db
        .select({ amount: airdrops.amount, createdAt: airdrops.createdAt, source: airdrops.source })
        .from(airdrops)
        .where(eq(airdrops.userId, authedUser))
        .orderBy(asc(airdrops.createdAt)),
      db
        .select({
          shares: trades.shares,
          price: trades.price,
          side: trades.side,
          createdAt: trades.createdAt,
        })
        .from(trades)
        .where(eq(trades.userId, authedUser))
        .orderBy(asc(trades.createdAt)),
      db
        .select({ shares: positions.shares, avgPrice: positions.avgPrice })
        .from(positions)
        .where(eq(positions.userId, authedUser)),
    ]);

    // Merge-sort all ledger events by time, walking the balance forward.
    type Event =
      | { t: number; kind: "grant"; amount: number }
      | { t: number; kind: "trade"; delta: number };
    const events: Event[] = [
      ...grants.map((g) => ({ t: g.createdAt.getTime(), kind: "grant" as const, amount: g.amount })),
      ...tradeRows.map((tr) => ({
        t: tr.createdAt.getTime(),
        kind: "trade" as const,
        // buy removes balance (shares * price spent), sell returns it.
        delta: tr.side === "buy" ? -tr.shares * tr.price : tr.shares * tr.price,
      })),
    ].sort((a, b) => a.t - b.t);

    // Every user starts at STARTING_BALANCE (1000). Start the chart
    // at createdAt so the first point matches the user's account birth.
    let balance = STARTING_BALANCE;
    const points: { t: number; balance: number }[] = [
      { t: user.createdAt.getTime(), balance },
    ];

    for (const ev of events) {
      if (ev.kind === "grant") balance += ev.amount;
      else balance += ev.delta;
      points.push({ t: ev.t, balance: Math.round(balance * 100) / 100 });
    }

    // Always include a "now" point with the authoritative db balance —
    // so rounding drift from the reconstruction doesn't leave a gap.
    points.push({ t: Date.now(), balance: Math.round(user.balance * 100) / 100 });

    // Open-position "frozen" value at last-traded price (not live — the
    // portfolio page will hydrate live prices separately).
    const openValue = positionRows.reduce((s, p) => s + p.shares * p.avgPrice, 0);

    return NextResponse.json({
      points,
      currentBalance: user.balance,
      openPositionValue: Math.round(openValue * 100) / 100,
      netWorth: Math.round((user.balance + openValue) * 100) / 100,
    });
  } catch (err) {
    console.error("/api/airdrop/history error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
