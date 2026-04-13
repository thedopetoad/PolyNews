import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getDb, users, positions, trades } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";

// Builder API credentials for order attribution
const builderCreds = {
  key: process.env.POLYMARKET_BUILDER_API_KEY || "",
  secret: process.env.POLYMARKET_BUILDER_SECRET || "",
  passphrase: process.env.POLYMARKET_BUILDER_PASSPHRASE || "",
};

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * POST /api/sports/bet
 *
 * Phase 1: Paper trade execution for sports markets (same as /api/trade but sports-specific)
 * Phase 2: Real CLOB order execution via Builder API (requires EIP-712 wallet signing)
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
    if (shares <= 0 || shares > 1_000_000) {
      return NextResponse.json({ error: "Invalid shares" }, { status: 400 });
    }
    if (price <= 0 || price >= 1) {
      return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    }

    const db = getDb();

    // Phase 1: Paper trade execution
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
          id: `${userId}-${marketId}-${outcome}-${Date.now()}`,
          userId,
          marketId,
          marketQuestion: marketQuestion || "",
          outcome,
          shares,
          avgPrice: price,
          clobTokenId: clobTokenId || null,
          eventSlug: eventSlug || null,
          marketEndDate: marketEndDate || null,
        });
      }

      // Record trade
      await db.insert(trades).values({
        id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId,
        marketId,
        marketQuestion: marketQuestion || "",
        outcome,
        side: "buy",
        shares,
        price,
      });

      return NextResponse.json({ success: true, user: updated });
    }

    return NextResponse.json({ error: "Only buy supported for sports bets" }, { status: 400 });
  } catch (err) {
    console.error("Sports bet error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * GET /api/sports/bet/builder-info
 * Returns builder attribution info (for future real-money integration)
 */
export async function GET() {
  const hasBuilder = !!(builderCreds.key && builderCreds.secret && builderCreds.passphrase);

  // Demo: generate builder headers for a test request
  let headers: Record<string, string> = {};
  if (hasBuilder) {
    try {
      const signer = new BuilderSigner(builderCreds);
      headers = signer.createBuilderHeaderPayload("GET", "/order");
    } catch {}
  }

  return NextResponse.json({
    builderEnabled: hasBuilder,
    phase: "paper-trade",
    note: "Phase 1: Paper trades. Phase 2: Real CLOB orders via Builder API with wallet EIP-712 signing.",
    headers: hasBuilder ? Object.keys(headers) : [],
  });
}
