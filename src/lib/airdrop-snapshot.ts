// Shared "take a snapshot of this week's leaderboard winners" logic.
// Called from BOTH:
//   - /api/cron/weekly-snapshot  (Vercel Cron, gated by CRON_SECRET)
//   - /api/admin/snapshot-now    (admin button on /admin, gated by
//                                 Phantom session cookie)
//
// Kept as a plain function (no HTTP) so the admin path doesn't need
// to forward requests through the cron URL — neither path depends on
// the other's auth mechanism.

import { getDb, users, airdrops, settings, prizePayouts } from "@/db";
import { sql, and, gte, inArray, isNotNull } from "drizzle-orm";
import { prizeWeekStart, prizeWeekKey } from "@/lib/week";
import { deriveProxyAddress } from "@/lib/proxy";
import { generateSecureId } from "@/lib/auth";

export interface SnapshotResult {
  ok: true;
  weekKey: string;
  referralWinners: number;
  gainerWinners: number;
  payoutRowsInserted: number;
  skippedNoPrize: string[];
}

export async function snapshotWeeklyPayouts(): Promise<SnapshotResult> {
  const db = getDb();

  // JUST-ENDED prize week. Shift reference point back 1 hour so Cron
  // drift up to ~59 min still targets the right week.
  const oneHourBeforeNow = new Date(Date.now() - 3600_000);
  const endedWeekStart = prizeWeekStart(oneHourBeforeNow);
  const endedWeekEnd = new Date(endedWeekStart.getTime() + 7 * 86400 * 1000 - 1);
  const weekKey = prizeWeekKey(oneHourBeforeNow);

  // Pull prize amounts from settings. Values are numeric strings;
  // parse and skip non-positive entries.
  const settingsRows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [
      "airdrop_prize_weeklyRef_1", "airdrop_prize_weeklyRef_2", "airdrop_prize_weeklyRef_3",
      "airdrop_prize_weeklyGain_1", "airdrop_prize_weeklyGain_2", "airdrop_prize_weeklyGain_3",
    ]));
  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const parseAmount = (key: string): number => {
    const raw = settingsMap[key];
    if (!raw) return 0;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // ── Weekly Referrals: top 3 referrers by new signups in the ended week ──
  const referralRows = await db
    .select({
      code: users.referredBy,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(users)
    .where(and(
      isNotNull(users.referredBy),
      gte(users.createdAt, endedWeekStart),
      sql`${users.createdAt} <= ${endedWeekEnd}`,
    ))
    .groupBy(users.referredBy)
    .orderBy(sql`count DESC`)
    .limit(3);

  const refCodes = referralRows.map((r) => r.code).filter(Boolean) as string[];
  const refReferrers = refCodes.length
    ? await db.select({ id: users.id, referralCode: users.referralCode }).from(users).where(inArray(users.referralCode, refCodes))
    : [];
  const codeToId = new Map(refReferrers.map((r) => [r.referralCode, r.id]));

  // ── Biggest Gainers: top 3 by sum of airdrops in the ended week ──
  const gainerRows = await db
    .select({
      userId: airdrops.userId,
      gain: sql<number>`SUM(${airdrops.amount})`.as("gain"),
    })
    .from(airdrops)
    .where(and(
      gte(airdrops.createdAt, endedWeekStart),
      sql`${airdrops.createdAt} <= ${endedWeekEnd}`,
    ))
    .groupBy(airdrops.userId)
    .orderBy(sql`gain DESC`)
    .limit(3);

  // ── Insert pending rows, skipping any place where amount ≤ 0 ──
  let inserted = 0;
  const skipped: string[] = [];

  for (let i = 0; i < referralRows.length; i++) {
    const place = i + 1;
    const userId = codeToId.get(referralRows[i].code ?? "");
    if (!userId) continue;
    const amount = parseAmount(`airdrop_prize_weeklyRef_${place}`);
    if (amount <= 0) { skipped.push(`weeklyRef_${place}`); continue; }
    const proxy = deriveProxyAddress(userId);
    await db.insert(prizePayouts).values({
      id: generateSecureId(),
      weekKey,
      leaderboard: "weeklyRef",
      place,
      userId,
      eoa: userId,
      proxyAddress: proxy,
      amountUsdc: amount,
      status: "pending",
    }).onConflictDoNothing();
    inserted++;
  }

  for (let i = 0; i < gainerRows.length; i++) {
    const place = i + 1;
    const userId = gainerRows[i].userId;
    const amount = parseAmount(`airdrop_prize_weeklyGain_${place}`);
    if (amount <= 0) { skipped.push(`weeklyGain_${place}`); continue; }
    const proxy = deriveProxyAddress(userId);
    await db.insert(prizePayouts).values({
      id: generateSecureId(),
      weekKey,
      leaderboard: "weeklyGain",
      place,
      userId,
      eoa: userId,
      proxyAddress: proxy,
      amountUsdc: amount,
      status: "pending",
    }).onConflictDoNothing();
    inserted++;
  }

  return {
    ok: true,
    weekKey,
    referralWinners: referralRows.length,
    gainerWinners: gainerRows.length,
    payoutRowsInserted: inserted,
    skippedNoPrize: skipped,
  };
}
