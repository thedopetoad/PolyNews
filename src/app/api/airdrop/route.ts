import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, referrals } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { getAuthenticatedUser, generateSecureId } from "@/lib/auth";
import { AIRDROP_AMOUNTS } from "@/lib/constants";

// POST /api/airdrop - Claim an airdrop
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, type } = body;

    // Auth check
    const authedUser = getAuthenticatedUser(request);
    const normalizedUserId = userId?.toLowerCase();

    if (!authedUser || authedUser !== normalizedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate type
    if (!["daily", "weekly", "signup"].includes(type)) {
      return NextResponse.json({ error: "Invalid airdrop type" }, { status: 400 });
    }

    const db = getDb();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, normalizedUserId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let amount = 0;

    // Use UTC date to avoid timezone mismatches between server and client
    const todayUTC = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    if (type === "signup") {
      if (user.hasSignupAirdrop) {
        return NextResponse.json(
          { error: "Already claimed" },
          { status: 400 }
        );
      }
      amount = AIRDROP_AMOUNTS.signup;

      // Atomic: only update if hasSignupAirdrop is still false
      const result = await db
        .update(users)
        .set({
          balance: sql`${users.balance} + ${amount}`,
          hasSignupAirdrop: true,
        })
        .where(
          and(
            eq(users.id, normalizedUserId),
            eq(users.hasSignupAirdrop, false)
          )
        )
        .returning();

      if (result.length === 0) {
        return NextResponse.json({ error: "Already claimed" }, { status: 400 });
      }
    } else if (type === "daily") {
      if (user.lastDailyAirdrop === todayUTC) {
        return NextResponse.json({ error: "Already claimed today" }, { status: 400 });
      }
      amount = AIRDROP_AMOUNTS.daily;

      // Atomic: check and set in one query
      const result = await db
        .update(users)
        .set({
          balance: sql`${users.balance} + ${amount}`,
          lastDailyAirdrop: todayUTC,
        })
        .where(
          and(
            eq(users.id, normalizedUserId),
            sql`${users.lastDailyAirdrop} IS DISTINCT FROM ${todayUTC}`
          )
        )
        .returning();

      if (result.length === 0) {
        return NextResponse.json({ error: "Already claimed today" }, { status: 400 });
      }
    } else if (type === "weekly") {
      const now = new Date();
      const weekKey = `${now.getFullYear()}-W${Math.ceil(
        ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7
      )}`;
      if (user.lastWeeklyAirdrop === weekKey) {
        return NextResponse.json({ error: "Already claimed this week" }, { status: 400 });
      }
      amount = AIRDROP_AMOUNTS.weekly;

      const result = await db
        .update(users)
        .set({
          balance: sql`${users.balance} + ${amount}`,
          lastWeeklyAirdrop: weekKey,
        })
        .where(
          and(
            eq(users.id, normalizedUserId),
            sql`${users.lastWeeklyAirdrop} IS DISTINCT FROM ${weekKey}`
          )
        )
        .returning();

      if (result.length === 0) {
        return NextResponse.json({ error: "Already claimed this week" }, { status: 400 });
      }
    }

    // Record airdrop
    await db.insert(airdrops).values({
      id: generateSecureId(),
      userId: normalizedUserId,
      source: type,
      amount,
    });

    // Handle referral bonus on signup
    if (type === "signup" && user.referredBy) {
      const [referrer] = await db
        .select()
        .from(users)
        .where(eq(users.referralCode, user.referredBy))
        .limit(1);

      if (referrer) {
        await db
          .update(users)
          .set({ balance: sql`${users.balance} + ${AIRDROP_AMOUNTS.referralBonus}` })
          .where(eq(users.id, referrer.id));

        await db.insert(referrals).values({
          id: generateSecureId(),
          referrerId: referrer.id,
          referredId: normalizedUserId,
          signupBonusPaid: true,
        });

        await db.insert(airdrops).values({
          id: generateSecureId(),
          userId: referrer.id,
          source: "referral",
          amount: AIRDROP_AMOUNTS.referralBonus,
        });
      }
    }

    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, normalizedUserId))
      .limit(1);

    return NextResponse.json({ user: updatedUser, amount });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
