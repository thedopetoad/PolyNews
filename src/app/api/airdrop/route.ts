import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { getAuthenticatedUser, generateSecureId } from "@/lib/auth";
import { AIRDROP_AMOUNTS } from "@/lib/constants";
import { isoWeekKey } from "@/lib/week";
import { payReferralBonus } from "@/lib/referral-payout";

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

    // Handle apply-referral: set referredBy on an existing user (one-time only)
    if (type === "apply-referral") {
      const { referralCode } = body;
      if (!referralCode) return NextResponse.json({ error: "Missing referral code" }, { status: 400 });
      const code = referralCode.toUpperCase();

      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.id, normalizedUserId)).limit(1);
      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
      if (user.referralCode === code) {
        return NextResponse.json({ error: "You cannot use your own referral code" }, { status: 400 });
      }

      const [referrer] = await db.select().from(users).where(eq(users.referralCode, code)).limit(1);
      if (!referrer) return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });

      // Atomic claim: only set referredBy if it's currently NULL. Two
      // concurrent applies see exactly one succeed (returning length 1).
      const claim = await db
        .update(users)
        .set({ referredBy: code })
        .where(and(eq(users.id, normalizedUserId), sql`${users.referredBy} IS NULL`))
        .returning({ id: users.id });

      if (claim.length === 0) {
        return NextResponse.json({ error: "You already have a referral code applied" }, { status: 400 });
      }

      // Pay the referrer. payReferralBonus is idempotent — the unique
      // index on referrals.referred_id means even if /api/user POST and
      // this handler both fire (race or retry), only the first succeeds
      // in inserting the row, only that one pays the bonus.
      await payReferralBonus(db, referrer.id, normalizedUserId);

      return NextResponse.json({ success: true });
    }

    // Validate type
    if (!["daily", "signup"].includes(type)) {
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
    }

    // Record airdrop
    const weekKey = isoWeekKey();
    await db.insert(airdrops).values({
      id: generateSecureId(),
      userId: normalizedUserId,
      source: type,
      amount,
      weekKey,
    });

    // Handle referral bonus on signup. Idempotent — payReferralBonus
    // no-ops if the (referrer, referred) pair was already credited via
    // any other path.
    if (type === "signup" && user.referredBy) {
      const [referrer] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, user.referredBy))
        .limit(1);
      if (referrer) {
        await payReferralBonus(db, referrer.id, normalizedUserId);
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
