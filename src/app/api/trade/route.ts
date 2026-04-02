import { NextRequest, NextResponse } from "next/server";
import { getDb, users, positions, trades } from "@/db";
import { eq, and } from "drizzle-orm";

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// POST /api/trade - Execute a paper trade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, marketId, marketQuestion, outcome, side, shares, price } =
      body;

    const db = getDb();

    if (
      !userId || !marketId || !marketQuestion || !outcome || !side ||
      !shares || !price
    ) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const cost = shares * price;

    if (side === "buy") {
      // Check balance
      if (cost > user.balance) {
        return NextResponse.json(
          { error: "Insufficient balance" },
          { status: 400 }
        );
      }

      // Check for existing position
      const existingPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.marketId, marketId),
            eq(positions.outcome, outcome)
          )
        )
        .limit(1);

      if (existingPositions.length > 0) {
        // Update existing position
        const pos = existingPositions[0];
        const totalShares = pos.shares + shares;
        const totalCost = pos.shares * pos.avgPrice + shares * price;
        await db
          .update(positions)
          .set({
            shares: totalShares,
            avgPrice: totalCost / totalShares,
            updatedAt: new Date(),
          })
          .where(eq(positions.id, pos.id));
      } else {
        // Create new position
        await db.insert(positions).values({
          id: generateId(),
          userId,
          marketId,
          marketQuestion,
          outcome,
          shares,
          avgPrice: price,
        });
      }

      // Deduct balance
      await db
        .update(users)
        .set({ balance: user.balance - cost })
        .where(eq(users.id, userId));
    } else if (side === "sell") {
      // Find position
      const existingPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.marketId, marketId),
            eq(positions.outcome, outcome)
          )
        )
        .limit(1);

      if (existingPositions.length === 0) {
        return NextResponse.json(
          { error: "No position to sell" },
          { status: 400 }
        );
      }

      const pos = existingPositions[0];
      if (shares > pos.shares) {
        return NextResponse.json(
          { error: "Not enough shares" },
          { status: 400 }
        );
      }

      if (shares === pos.shares) {
        // Close position entirely
        await db.delete(positions).where(eq(positions.id, pos.id));
      } else {
        // Reduce position
        await db
          .update(positions)
          .set({ shares: pos.shares - shares, updatedAt: new Date() })
          .where(eq(positions.id, pos.id));
      }

      // Add proceeds to balance
      await db
        .update(users)
        .set({ balance: user.balance + cost })
        .where(eq(users.id, userId));
    }

    // Record trade
    await db.insert(trades).values({
      id: generateId(),
      userId,
      marketId,
      marketQuestion,
      outcome,
      side,
      shares,
      price,
    });

    // Return updated user
    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
