import { NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { eq, count } from "drizzle-orm";
import { isValidAddress } from "@/lib/auth";

// GET /api/user/referrals?userId=0x123 — returns the count of users who
// signed up with this user's referral code (their `referredBy` matches
// this user's `referralCode`). We count from the users table, not from
// the `referrals` table, because referrals rows are only created once
// the referred user claims their signup airdrop — before that, Paulo's
// "I referred 4 people" wouldn't show up. This matches what users expect.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId || !isValidAddress(userId)) {
    return NextResponse.json({ error: "Invalid or missing user ID" }, { status: 400 });
  }

  const authed = request.headers.get("authorization")?.replace("Bearer ", "").trim().toLowerCase();
  const normalizedId = userId.toLowerCase();

  if (!authed || authed !== normalizedId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();

    // Look up this user's referral code
    const [me] = await db
      .select({ referralCode: users.referralCode })
      .from(users)
      .where(eq(users.id, normalizedId))
      .limit(1);

    if (!me?.referralCode) {
      return NextResponse.json({ count: 0 });
    }

    // Count users whose referredBy matches — i.e. everyone who signed up
    // using this code, regardless of whether they've claimed a bonus yet.
    const [result] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.referredBy, me.referralCode));

    return NextResponse.json({ count: result?.count ?? 0 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
