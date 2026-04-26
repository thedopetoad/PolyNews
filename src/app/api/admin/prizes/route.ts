import { NextRequest, NextResponse } from "next/server";
import { getDb, settings } from "@/db";
import { inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/prizes — returns all 9 prize settings, nulls for unset
// POST /api/admin/prizes — upserts a subset { key: value, ... }
//
// Settings keys (free-form strings so toad can write "$25" or "TBD"):
//   airdrop_prize_total_{1,2,3}
//   airdrop_prize_weeklyRef_{1,2,3}
//   airdrop_prize_weeklyGain_{1,2,3}
const PRIZE_KEYS = [
  "airdrop_prize_total_1", "airdrop_prize_total_2", "airdrop_prize_total_3",
  "airdrop_prize_weeklyRef_1", "airdrop_prize_weeklyRef_2", "airdrop_prize_weeklyRef_3",
  "airdrop_prize_weeklyGain_1", "airdrop_prize_weeklyGain_2", "airdrop_prize_weeklyGain_3",
] as const;

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, [...PRIZE_KEYS]));
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const out: Record<string, string | null> = {};
    for (const k of PRIZE_KEYS) out[k] = map[k] ?? null;
    return NextResponse.json({ prizes: out });
  } catch (err) {
    console.error("Admin prizes GET error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as Record<string, string | null | undefined>;
    const updates: { key: string; value: string }[] = [];
    for (const k of PRIZE_KEYS) {
      const v = body[k];
      if (typeof v === "string") updates.push({ key: k, value: v.slice(0, 40) });
    }

    const db = getDb();
    for (const u of updates) {
      if (u.value.trim() === "") {
        // Empty string → delete the row so the UI falls back to "TBD"
        await db.delete(settings).where(inArray(settings.key, [u.key]));
      } else {
        await db
          .insert(settings)
          .values({ key: u.key, value: u.value })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: u.value, updatedAt: new Date() },
          });
      }
    }

    return NextResponse.json({ ok: true, updated: updates.length });
  } catch (err) {
    console.error("Admin prizes POST error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
