import { NextRequest, NextResponse } from "next/server";
import { getDb, users, positions, trades } from "@/db";
import { eq, sql } from "drizzle-orm";
import { generateSecureId } from "@/lib/auth";

const GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * POST /api/trade/auto-close
 *
 * Auto-closes ALL positions for a resolved BTC 5-min market.
 * Checks the Gamma API to determine the winning outcome,
 * then settles each position: winners get 1.0 per share, losers get 0.0.
 */
export async function POST(request: NextRequest) {
  try {
    const { marketId, marketSlug } = await request.json();

    if (!marketId || !marketSlug) {
      return NextResponse.json({ error: "Missing marketId or marketSlug" }, { status: 400 });
    }

    // Fetch the market from Gamma API to verify resolution
    const res = await fetch(`${GAMMA_API}/events?slug=${marketSlug}`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch market status" }, { status: 502 });
    }

    const events = await res.json();
    const market = events?.[0]?.markets?.[0];

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (!market.closed) {
      return NextResponse.json({ error: "Market not yet resolved" }, { status: 400 });
    }

    // Determine winning outcome
    const prices = JSON.parse(market.outcomePrices);
    const outcomes = JSON.parse(market.outcomes);
    const upIdx = outcomes.indexOf("Up");
    const downIdx = outcomes.indexOf("Down");

    let winningOutcome: string | null = null;
    if (parseFloat(prices[upIdx]) > 0.5) winningOutcome = "Up";
    else if (parseFloat(prices[downIdx]) > 0.5) winningOutcome = "Down";

    if (!winningOutcome) {
      return NextResponse.json({ error: "Could not determine winning outcome" }, { status: 500 });
    }

    // Find ALL positions for this market (across all users)
    const db = getDb();
    const openPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.marketId, marketId));

    if (openPositions.length === 0) {
      return NextResponse.json({ message: "No positions to close", closed: 0, winningOutcome });
    }

    // Close each position
    const results: { userId: string; outcome: string; shares: number; won: boolean; payout: number }[] = [];

    for (const pos of openPositions) {
      const won = pos.outcome === winningOutcome;
      const settlementPrice = won ? 1.0 : 0.0;
      const payout = pos.shares * settlementPrice;

      // Credit balance (winners get shares × 1.0, losers get 0)
      if (payout > 0) {
        await db
          .update(users)
          .set({ balance: sql`${users.balance} + ${payout}` })
          .where(eq(users.id, pos.userId));
      }

      // Record the sell trade
      await db.insert(trades).values({
        id: generateSecureId(),
        userId: pos.userId,
        marketId: pos.marketId,
        marketQuestion: pos.marketQuestion,
        outcome: pos.outcome,
        side: "sell",
        shares: pos.shares,
        price: settlementPrice,
      });

      // Delete the position
      await db.delete(positions).where(eq(positions.id, pos.id));

      results.push({
        userId: pos.userId,
        outcome: pos.outcome,
        shares: pos.shares,
        won,
        payout,
      });
    }

    return NextResponse.json({
      message: `Closed ${results.length} positions`,
      winningOutcome,
      closed: results.length,
      results,
    });
  } catch {
    return NextResponse.json({ error: "Auto-close failed" }, { status: 500 });
  }
}
