import { NextResponse } from "next/server";
import { getDb, settings } from "@/db";
import { inArray } from "drizzle-orm";

// GET /api/settings/public
//
// Returns the subset of `settings` that's safe for anonymous clients.
// Today this is the admin-editable leaderboard prize amounts.
//
// Prize keys, one per (board, place):
//   airdrop_prize_total_1       airdrop_prize_total_2       airdrop_prize_total_3
//   airdrop_prize_weeklyRef_1   airdrop_prize_weeklyRef_2   airdrop_prize_weeklyRef_3
//   airdrop_prize_weeklyGain_1  airdrop_prize_weeklyGain_2  airdrop_prize_weeklyGain_3
//
// Missing rows → null → UI renders "TBD". Admin sets them from /admin.
const PRIZE_KEYS = [
  "airdrop_prize_total_1", "airdrop_prize_total_2", "airdrop_prize_total_3",
  "airdrop_prize_weeklyRef_1", "airdrop_prize_weeklyRef_2", "airdrop_prize_weeklyRef_3",
  "airdrop_prize_weeklyGain_1", "airdrop_prize_weeklyGain_2", "airdrop_prize_weeklyGain_3",
] as const;

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, [...PRIZE_KEYS]));
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const pick = (k: string) => map.get(k) ?? null;

    return NextResponse.json({
      prizes: {
        total: [pick("airdrop_prize_total_1"), pick("airdrop_prize_total_2"), pick("airdrop_prize_total_3")],
        weeklyReferrals: [pick("airdrop_prize_weeklyRef_1"), pick("airdrop_prize_weeklyRef_2"), pick("airdrop_prize_weeklyRef_3")],
        weeklyGainers: [pick("airdrop_prize_weeklyGain_1"), pick("airdrop_prize_weeklyGain_2"), pick("airdrop_prize_weeklyGain_3")],
      },
    }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    console.error("Public settings error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
