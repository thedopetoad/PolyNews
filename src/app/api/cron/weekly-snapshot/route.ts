import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, settings, prizePayouts } from "@/db";
import { sql, and, gte, inArray, isNotNull } from "drizzle-orm";
import { prizeWeekStart, prizeWeekKey } from "@/lib/week";
import { deriveProxyAddress } from "@/lib/proxy";
import { generateSecureId } from "@/lib/auth";

// GET /api/cron/weekly-snapshot
//
// Runs every Monday 17:00 UTC (= 9am PST / 10am PDT) via Vercel Cron.
// Snapshots the top 3 of each weekly leaderboard for the WEEK THAT
// JUST ENDED (the `prizeWeekKey` for a moment 1 second before now, so
// we always capture the previous week even if the cron drifts a few
// seconds into the new week).
//
// Amounts come from settings.airdrop_prize_<board>_<place>. Parsed as
// integers — any entry ≤ 0 or unparseable is skipped (no payout row
// created for that place). Admin can pay the rest.
//
// Idempotent: prize_payouts has UNIQUE(week_key, leaderboard, place)
// so a re-run of this endpoint no-ops on existing rows.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when
// CRON_SECRET env is set. Reject anything else.

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const db = getDb();
    // Snapshot the JUST-ENDED week. Subtract a second so a cron that
    // fires slightly before 17:00 UTC still picks up the right week,
    // and one that fires slightly after still captures the previous
    // week (not the one that started a blink ago).
    const oneSecBeforeNow = new Date(Date.now() - 1000);
    const endedWeekStart = prizeWeekStart(oneSecBeforeNow);
    const endedWeekEnd = new Date(endedWeekStart.getTime() + 7 * 86400 * 1000 - 1);
    const weekKey = prizeWeekKey(oneSecBeforeNow);

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

    // ── Weekly Referrals: top 3 referrers by new signups in the
    //    ended week ──
    const referralRows = await db
      .select({
        code: users.referredBy,
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(users)
      .where(and(isNotNull(users.referredBy), gte(users.createdAt, endedWeekStart), sql`${users.createdAt} <= ${endedWeekEnd}`))
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
      .where(and(gte(airdrops.createdAt, endedWeekStart), sql`${airdrops.createdAt} <= ${endedWeekEnd}`))
      .groupBy(airdrops.userId)
      .orderBy(sql`gain DESC`)
      .limit(3);

    // ── Insert pending rows, skipping any entry where amount ≤ 0 ──
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

    return NextResponse.json({
      ok: true,
      weekKey,
      referralWinners: referralRows.length,
      gainerWinners: gainerRows.length,
      payoutRowsInserted: inserted,
      skippedNoPrize: skipped,
    });
  } catch (err) {
    console.error("Weekly snapshot cron error:", err);
    return NextResponse.json({ error: "Cron error", detail: (err as Error).message }, { status: 500 });
  }
}
