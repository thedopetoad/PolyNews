import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops } from "@/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getAuthenticatedUser, generateSecureId } from "@/lib/auth";
import { AIRDROP_AMOUNTS } from "@/lib/constants";
import { isoWeekKey } from "@/lib/week";

// POST /api/airdrop/claim-one-time  body: { type: "first_deposit" | "first_sports_trade" }
//
// One-time boosts. Idempotency is enforced by the per-user boolean flags
// on `users`. Called by the client after the corresponding action (real
// deposit detected via USDC.e balance change, or a successful CLOB sell/
// buy order posted). Client can't re-fire because the flag flips on
// first grant.
//
// The client is trusted here (the flags mean a user can only ever claim
// once). If abuse emerges we can replace with server-side detection
// (watch the `trades` table, onchain balance checks, etc.).
export async function POST(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type } = body as { type?: string };

    if (type !== "first_deposit" && type !== "first_sports_trade") {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const db = getDb();
    const amount = type === "first_deposit" ? AIRDROP_AMOUNTS.firstDeposit : AIRDROP_AMOUNTS.firstSportsTrade;
    const flagColumn = type === "first_deposit" ? users.firstDepositBonusPaid : users.firstSportsTradeBonusPaid;
    const weekKey = isoWeekKey();

    // Atomic: only grant if flag is still false. If another concurrent
    // request already flipped it, return claimed:true so the caller knows.
    const updateResult = await db
      .update(users)
      .set(
        type === "first_deposit"
          ? { firstDepositBonusPaid: true, balance: sql`${users.balance} + ${amount}` }
          : { firstSportsTradeBonusPaid: true, balance: sql`${users.balance} + ${amount}` }
      )
      .where(and(eq(users.id, authedUser), eq(flagColumn, false)))
      .returning();

    if (updateResult.length === 0) {
      return NextResponse.json({ error: "Already claimed", claimed: true }, { status: 400 });
    }

    await db.insert(airdrops).values({
      id: generateSecureId(),
      userId: authedUser,
      source: type,
      amount,
      weekKey,
    });

    return NextResponse.json({ ok: true, amount, type });
  } catch (err) {
    console.error("One-time claim error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
