import { NextRequest, NextResponse } from "next/server";
import { getDb, users, prizePayouts } from "@/db";
import { eq, inArray, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

// GET  /api/admin/payouts — list every payout row ever (newest week first).
// POST /api/admin/payouts — { id, status: "paid", txHash?: string } → flip a row to paid.

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
      status: r.status,
      txHash: r.txHash,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      paidBy: r.paidBy,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ payouts });
  } catch (err) {
    console.error("Admin payouts GET error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { id, status, txHash } = body as { id?: string; status?: string; txHash?: string };
    if (!id || status !== "paid") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const db = getDb();
    const trimmedHash = txHash && typeof txHash === "string" ? txHash.trim() : null;
    await db
      .update(prizePayouts)
      .set({
        status: "paid",
        txHash: trimmedHash || null,
        paidAt: new Date(),
        paidBy: admin.pubkey,
      })
      .where(eq(prizePayouts.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Admin payouts POST error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
