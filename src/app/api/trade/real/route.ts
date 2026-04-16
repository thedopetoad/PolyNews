import { NextRequest, NextResponse } from "next/server";
import { getDb, positions, trades } from "@/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * POST /api/trade/real
 *
 * Records a real CLOB trade in our database so it appears in the
 * portfolio page. Called by the bet slip after a successful
 * ClobClient.createAndPostMarketOrder().
 *
 * Does NOT create the order on the CLOB — that already happened
 * client-side. This just persists the position locally.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      marketId,
      marketQuestion,
      outcome,
      shares,
      price,
      clobTokenId,
      clobOrderId,
      eventSlug,
      endDate,
      side,
    } = body;

    if (!userId || !marketId || !outcome || !shares || !price) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getDb();

    // Upsert position — if same user + market + outcome + tradeType=real exists,
    // average into it. Otherwise create new.
    const existing = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, userId),
          eq(positions.marketId, marketId),
          eq(positions.outcome, outcome),
          eq(positions.tradeType, "real")
        )
      );

    const now = new Date();

    if (existing.length > 0 && side !== "SELL") {
      const pos = existing[0];
      const totalShares = pos.shares + shares;
      const newAvg =
        (pos.avgPrice * pos.shares + price * shares) / totalShares;

      await db
        .update(positions)
        .set({
          shares: totalShares,
          avgPrice: newAvg,
          clobOrderId: clobOrderId || pos.clobOrderId,
          updatedAt: now,
        })
        .where(eq(positions.id, pos.id));
    } else if (side === "SELL" && existing.length > 0) {
      const pos = existing[0];
      const remainingShares = pos.shares - shares;
      if (remainingShares <= 0.001) {
        // Position closed
        await db.delete(positions).where(eq(positions.id, pos.id));
      } else {
        await db
          .update(positions)
          .set({ shares: remainingShares, updatedAt: now })
          .where(eq(positions.id, pos.id));
      }
    } else {
      // New position
      await db.insert(positions).values({
        id: randomUUID(),
        userId,
        marketId,
        marketQuestion: marketQuestion || "",
        outcome,
        shares,
        avgPrice: price,
        clobTokenId: clobTokenId || null,
        marketEndDate: endDate || null,
        eventSlug: eventSlug || null,
        tradeType: "real",
        clobOrderId: clobOrderId || null,
      });
    }

    // Also log in trade history
    await db.insert(trades).values({
      id: randomUUID(),
      userId,
      marketId,
      marketQuestion: marketQuestion || "",
      outcome,
      side: side || "BUY",
      shares,
      price,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Real trade save error:", err);
    return NextResponse.json(
      { error: "Failed to save trade" },
      { status: 500 }
    );
  }
}
