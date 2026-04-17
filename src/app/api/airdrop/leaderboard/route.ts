import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, positions } from "@/db";
import { sql, and, gte, inArray, isNotNull } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { prizeWeekStart } from "@/lib/week";

// GET /api/airdrop/leaderboard?type=total|weeklyReferrals|weeklyGainers
//
// Returns top 50 for the requested leaderboard. The Total leaderboard
// also joins the per-user referral count (number of users whose
// `referredBy` matches that user's code) so the UI can show
// "referrals drive the leaderboard."
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "total";
  if (!["total", "weeklyReferrals", "weeklyGainers"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  try {
    const db = getDb();
    const authedUser = getAuthenticatedUser(request);
    // Weekly leaderboards anchor on Monday 17:00 UTC (= 9am PST)
    // so the "reset" matches the payout-snapshot cron cadence.
    const weekStart = prizeWeekStart();

    // Mask every id except the caller's own, so users can locate
    // themselves but can't dox others.
    const maskId = (id: string) =>
      id === authedUser
        ? id
        : id.startsWith("0x")
          ? `${id.slice(0, 6)}...${id.slice(-4)}`
          : id.slice(0, 8) + "...";

    if (type === "total") {
      // Rank EVERY user by net AIRDROP worth = users.balance + sum of
      // open paper-position entry value. This matches what users see as
      // "Your AIRDROP Portfolio" on the Portfolio tab, so rankings line
      // up with the number in the card. (The earlier version summed the
      // airdrops grant ledger, which excluded STARTING_BALANCE + trade
      // P&L — meaning a user with 2K in their wallet could be missing
      // from the leaderboard entirely.)
      const allUsers = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          referralCode: users.referralCode,
          balance: users.balance,
        })
        .from(users);

      if (allUsers.length === 0) return NextResponse.json({ leaderboard: [] });

      // Open paper position value per user — entry price (live prices
      // would slow this endpoint). Matches /api/airdrop/me's net-worth
      // calculation for consistency.
      const posRows = await db
        .select({
          userId: positions.userId,
          tradeType: positions.tradeType,
          shares: positions.shares,
          avgPrice: positions.avgPrice,
        })
        .from(positions);
      const positionValueByUser = new Map<string, number>();
      for (const p of posRows) {
        if (p.tradeType === "real") continue;
        positionValueByUser.set(
          p.userId,
          (positionValueByUser.get(p.userId) || 0) + p.shares * p.avgPrice,
        );
      }

      // Referral counts — one query over all referredBy values.
      const refCountRows = await db
        .select({
          code: users.referredBy,
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(users)
        .where(isNotNull(users.referredBy))
        .groupBy(users.referredBy);
      const refCounts = new Map(refCountRows.map((r) => [r.code, Number(r.count)]));

      const ranked = allUsers
        .map((u) => ({
          id: u.id,
          displayName: u.displayName,
          referralCode: u.referralCode,
          netWorth: Math.round(u.balance + (positionValueByUser.get(u.id) || 0)),
        }))
        .sort((a, b) => b.netWorth - a.netWorth)
        .slice(0, 50);

      const leaderboard = ranked.map((u, i) => ({
        rank: i + 1,
        id: maskId(u.id),
        displayName: u.displayName ?? null,
        total: u.netWorth,
        referralCount: u.referralCode ? refCounts.get(u.referralCode) ?? 0 : 0,
      }));

      return NextResponse.json({ leaderboard });
    }

    if (type === "weeklyReferrals") {
      // Count new users whose referredBy matches each referrer's code,
      // filtered to signups in the current ISO week.
      const rows = await db
        .select({
          code: users.referredBy,
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(users)
        .where(and(sql`${users.referredBy} IS NOT NULL`, gte(users.createdAt, weekStart)))
        .groupBy(users.referredBy)
        .orderBy(sql`count DESC`)
        .limit(50);

      if (rows.length === 0) {
        return NextResponse.json({ leaderboard: [] });
      }

      const codes = rows.map((r) => r.code).filter(Boolean) as string[];
      const userRows = codes.length
        ? await db
          .select({
            id: users.id,
            displayName: users.displayName,
            referralCode: users.referralCode,
          })
          .from(users)
          .where(inArray(users.referralCode, codes))
        : [];
      const codeToUser = new Map(userRows.map((u) => [u.referralCode, u]));

      const leaderboard = rows
        .map((r, i) => {
          const u = r.code ? codeToUser.get(r.code) : null;
          if (!u) return null;
          return {
            rank: i + 1,
            id: maskId(u.id),
            displayName: u.displayName ?? null,
            count: Number(r.count),
          };
        })
        .filter(Boolean);

      return NextResponse.json({ leaderboard });
    }

    // weeklyGainers: sum of airdrops granted since the last prize-week
    // reset (Mon 17:00 UTC). Filter by createdAt timestamp rather than
    // the legacy airdrops.weekKey column — weekKey is ISO week (Mon
    // 00:00 UTC) which drifts 17 hours from the prize-week boundary.
    const weekRows = await db
      .select({
        userId: airdrops.userId,
        gain: sql<number>`SUM(${airdrops.amount})`.as("gain"),
      })
      .from(airdrops)
      .where(gte(airdrops.createdAt, weekStart))
      .groupBy(airdrops.userId)
      .orderBy(sql`gain DESC`)
      .limit(50);

    if (weekRows.length === 0) {
      return NextResponse.json({ leaderboard: [] });
    }

    const userIds = weekRows.map((r) => r.userId);
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds));
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    const leaderboard = weekRows.map((r, i) => {
      const u = userMap.get(r.userId);
      return {
        rank: i + 1,
        id: maskId(r.userId),
        displayName: u?.displayName ?? null,
        gain: Math.round(Number(r.gain) || 0),
      };
    });

    return NextResponse.json({ leaderboard });
  } catch (err) {
    console.error("Airdrop leaderboard error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
