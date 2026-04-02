import { NextRequest, NextResponse } from "next/server";
import { getDb, users, positions, trades } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import {
  getAuthenticatedUser,
  generateSecureId,
  validateTradeParams,
} from "@/lib/auth";

// POST /api/trade - Execute a paper trade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, marketId, marketQuestion, outcome, side, shares, price } =
      body;

    // Auth: verify the caller matches the userId
    const authedUser = getAuthenticatedUser(request);
    const normalizedUserId = userId?.toLowerCase();

    if (!authedUser || authedUser !== normalizedUserId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!marketId || !marketQuestion) {
      return NextResponse.json(
        { error: "Missing market fields" },
        { status: 400 }
      );
    }

    // Length limits to prevent storage abuse
    if (typeof marketId !== "string" || marketId.length > 200) {
      return NextResponse.json({ error: "Invalid marketId" }, { status: 400 });
    }
    if (typeof marketQuestion !== "string" || marketQuestion.length > 500) {
      return NextResponse.json({ error: "Invalid marketQuestion" }, { status: 400 });
    }

    // Validate trade parameters
    const validationError = validateTradeParams({ shares, price, side, outcome });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const cost = shares * price;
    const tradeId = generateSecureId();

    if (side === "buy") {
      // Atomic balance deduction using SQL to prevent race conditions
      const result = await db
        .update(users)
        .set({
          balance: sql`${users.balance} - ${cost}`,
        })
        .where(
          and(
            eq(users.id, normalizedUserId),
            sql`${users.balance} >= ${cost}`
          )
        )
        .returning();

      if (result.length === 0) {
        return NextResponse.json(
          { error: "Insufficient balance" },
          { status: 400 }
        );
      }

      // Update or create position
      const existingPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, normalizedUserId),
            eq(positions.marketId, marketId),
            eq(positions.outcome, outcome)
          )
        )
        .limit(1);

      if (existingPositions.length > 0) {
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
        await db.insert(positions).values({
          id: generateSecureId(),
          userId: normalizedUserId,
          marketId,
          marketQuestion,
          outcome,
          shares,
          avgPrice: price,
        });
      }
    } else if (side === "sell") {
      // Atomic sell: deduct shares only if enough exist
      const updated = await db
        .update(positions)
        .set({
          shares: sql`${positions.shares} - ${shares}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(positions.userId, normalizedUserId),
            eq(positions.marketId, marketId),
            eq(positions.outcome, outcome),
            sql`${positions.shares} >= ${shares}`
          )
        )
        .returning();

      if (updated.length === 0) {
        return NextResponse.json(
          { error: "No position or not enough shares" },
          { status: 400 }
        );
      }

      // Clean up zero-share positions
      if (updated[0].shares === 0) {
        await db.delete(positions).where(eq(positions.id, updated[0].id));
      }

      // Atomic balance addition
      await db
        .update(users)
        .set({
          balance: sql`${users.balance} + ${cost}`,
        })
        .where(eq(users.id, normalizedUserId));
    }

    // Record trade
    await db.insert(trades).values({
      id: tradeId,
      userId: normalizedUserId,
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
      .where(eq(users.id, normalizedUserId))
      .limit(1);

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
