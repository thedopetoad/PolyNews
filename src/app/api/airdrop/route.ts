import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, referrals } from "@/db";
import { eq } from "drizzle-orm";
import { AIRDROP_AMOUNTS } from "@/lib/constants";

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// POST /api/airdrop - Claim an airdrop
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, type } = body; // type: "daily" | "weekly" | "signup"

    if (!userId || !type) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const db = getDb();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let amount = 0;

    if (type === "signup") {
      if (user.hasSignupAirdrop) {
        return NextResponse.json(
          { error: "Already claimed signup airdrop" },
          { status: 400 }
        );
      }
      amount = AIRDROP_AMOUNTS.signup;
      await db
        .update(users)
        .set({
          balance: user.balance + amount,
          hasSignupAirdrop: true,
        })
        .where(eq(users.id, userId));
    } else if (type === "daily") {
      const today = new Date().toDateString();
      if (user.lastDailyAirdrop === today) {
        return NextResponse.json(
          { error: "Already claimed daily airdrop" },
          { status: 400 }
        );
      }
      amount = AIRDROP_AMOUNTS.daily;
      await db
        .update(users)
        .set({
          balance: user.balance + amount,
          lastDailyAirdrop: today,
        })
        .where(eq(users.id, userId));
    } else if (type === "weekly") {
      const now = new Date();
      const weekKey = `${now.getFullYear()}-W${Math.ceil(
        ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) /
          86400000 +
          1) /
          7
      )}`;
      if (user.lastWeeklyAirdrop === weekKey) {
        return NextResponse.json(
          { error: "Already claimed weekly airdrop" },
          { status: 400 }
        );
      }
      amount = AIRDROP_AMOUNTS.weekly;
      await db
        .update(users)
        .set({
          balance: user.balance + amount,
          lastWeeklyAirdrop: weekKey,
        })
        .where(eq(users.id, userId));
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    // Record airdrop
    await db.insert(airdrops).values({
      id: generateId(),
      userId,
      source: type,
      amount,
    });

    // If user was referred and this is signup, pay referral bonus
    if (type === "signup" && user.referredBy) {
      // Find the referrer by their referral code
      const [referrer] = await db
        .select()
        .from(users)
        .where(eq(users.referralCode, user.referredBy))
        .limit(1);

      if (referrer) {
        // Pay referrer signup bonus
        await db
          .update(users)
          .set({ balance: referrer.balance + AIRDROP_AMOUNTS.referralBonus })
          .where(eq(users.id, referrer.id));

        // Record referral
        await db.insert(referrals).values({
          id: generateId(),
          referrerId: referrer.id,
          referredId: userId,
          signupBonusPaid: true,
        });

        // Record airdrop for referrer
        await db.insert(airdrops).values({
          id: generateId(),
          userId: referrer.id,
          source: "referral",
          amount: AIRDROP_AMOUNTS.referralBonus,
        });
      }
    }

    // Return updated user
    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return NextResponse.json({ user: updatedUser, amount });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
