import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAuthenticatedUser } from "@/lib/auth";
import { getDb, users, positions, trades } from "@/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * POST /api/sports/bet
 *
 * Paper trade execution for sports markets.
 * Supports both buy and sell (close position).
 *
 * Body: { userId, marketId, marketQuestion, outcome, side, shares, price, clobTokenId, eventSlug, marketEndDate }
 */
export async function POST(request: NextRequest) {
  try {
    const authedUser = getAuthenticatedUser(request);
    if (!authedUser) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, marketId, marketQuestion, outcome, side, shares, price, clobTokenId, eventSlug, marketEndDate } = body;

    if (!userId || userId !== authedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!marketId || !outcome || !side || !shares || !price) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (side !== "buy" && side !== "sell") {
      return NextResponse.json({ error: "Side must be 'buy' or 'sell'" }, { status: 400 });
    }
    if (shares <= 0 || shares > 100_000) {
      return NextResponse.json({ error: "Invalid shares (max 100K)" }, { status: 400 });
    }
    if (price <= 0 || price >= 1) {
      return NextResponse.json({ error: "Invalid price (must be 0-1)" }, { status: 400 });
    }

    const db = getDb();
    const tradeId = crypto.randomUUID();

    if (side === "buy") {
      const cost = shares * price;

      // Atomic balance check & deduction
      const [updated] = await db
        .update(users)
        .set({ balance: sql`${users.balance} - ${cost}` })
        .where(and(eq(users.id, userId), sql`${users.balance} >= ${cost}`))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
      }

      // Find or create position
      const [existing] = await db
        .select()
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.marketId, marketId), eq(positions.outcome, outcome)))
        .limit(1);

      if (existing) {
        const totalShares = existing.shares + shares;
        const newAvgPrice = (existing.shares * existing.avgPrice + shares * price) / totalShares;
        await db.update(positions).set({ shares: totalShares, avgPrice: newAvgPrice, updatedAt: new Date() }).where(eq(positions.id, existing.id));
      } else {
        await db.insert(positions).values({
          id: crypto.randomUUID(),
          userId,
          marketId,
          marketQuestion: (marketQuestion || "").slice(0, 500),
          outcome,
          shares,
          avgPrice: price,
          clobTokenId: clobTokenId || null,
          eventSlug: eventSlug || null,
          marketEndDate: marketEndDate || null,
        });
      }

      await db.insert(trades).values({ id: tradeId, userId, marketId, marketQuestion: (marketQuestion || "").slice(0, 500), outcome, side: "buy", shares, price });

      return NextResponse.json({ success: true, user: updated });
    }

    // Sell (close position)
    const proceeds = shares * price;

    // Atomic share deduction
    const [updatedPos] = await db
      .update(positions)
      .set({ shares: sql`${positions.shares} - ${shares}`, updatedAt: new Date() })
      .where(and(eq(positions.userId, userId), eq(positions.marketId, marketId), eq(positions.outcome, outcome), sql`${positions.shares} >= ${shares}`))
      .returning();

    if (!updatedPos) {
      return NextResponse.json({ error: "Insufficient shares" }, { status: 400 });
    }

    // Delete position if shares reach 0
    if (updatedPos.shares <= 0.001) {
      await db.delete(positions).where(eq(positions.id, updatedPos.id));
    }

    // Add proceeds to balance
    const [updated] = await db
      .update(users)
      .set({ balance: sql`${users.balance} + ${proceeds}` })
      .where(eq(users.id, userId))
      .returning();

    await db.insert(trades).values({ id: tradeId, userId, marketId, marketQuestion: (marketQuestion || "").slice(0, 500), outcome, side: "sell", shares, price });

    return NextResponse.json({ success: true, user: updated });
  } catch (err) {
    console.error("Sports bet error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
