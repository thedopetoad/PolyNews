import { NextRequest, NextResponse } from "next/server";
import { getDb, referrals } from "@/db";
import { eq, count } from "drizzle-orm";
import { isValidAddress } from "@/lib/auth";

// GET /api/user/referrals?userId=0x123 — returns referral count
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
    const [result] = await db
      .select({ count: count() })
      .from(referrals)
      .where(eq(referrals.referrerId, normalizedId));

    return NextResponse.json({ count: result?.count ?? 0 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
