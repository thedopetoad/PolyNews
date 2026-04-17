import { NextRequest, NextResponse } from "next/server";
import { getDb, users, prizePayouts } from "@/db";
import { inArray, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/payouts — list every snapshotted payout row (newest
// week first). The admin UI only READS this data; actual USDC sends
// happen externally (boss's wallet). Mark-paid was removed per
// product call — admin tracks sends outside the system.

export async function GET(request: NextRequest) {
  const admin = requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(prizePayouts)
      .orderBy(desc(prizePayouts.weekKey), prizePayouts.leaderboard, prizePayouts.place);

    if (rows.length === 0) return NextResponse.json({ payouts: [] });

    // Attach display names in one follow-up query.
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds));
    const nameByUser = new Map(userRows.map((u) => [u.id, u.displayName]));

    const payouts = rows.map((r) => ({
      id: r.id,
      weekKey: r.weekKey,
      leaderboard: r.leaderboard,
      place: r.place,
      userId: r.userId,
      displayName: nameByUser.get(r.userId) ?? null,
      eoa: r.eoa,
      proxyAddress: r.proxyAddress,
      amountUsdc: r.amountUsdc,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ payouts });
  } catch (err) {
    console.error("Admin payouts GET error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
