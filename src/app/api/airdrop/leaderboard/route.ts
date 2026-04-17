import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops } from "@/db";
import { sql, eq, and, gte } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { isoWeekKey, isoWeekStart } from "@/lib/week";

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
    const currentWeek = isoWeekKey();
    const weekStart = isoWeekStart();

    // Mask every id except the caller's own, so users can locate
    // themselves but can't dox others.
    const maskId = (id: string) =>
      id === authedUser
        ? id
        : id.startsWith("0x")
          ? `${id.slice(0, 6)}...${id.slice(-4)}`
          : id.slice(0, 8) + "...";

    if (type === "total") {
      // Total lifetime airdrop per user, top 50, with referral count.
      const totals = await db
        .select({
          userId: airdrops.userId,
          total: sql<number>`SUM(${airdrops.amount})`.as("total"),
        })
        .from(airdrops)
        .groupBy(airdrops.userId)
        .orderBy(sql`total DESC`)
        .limit(50);

      // Attach displayName + referralCode, then count referrals per user.
      const userIds = totals.map((r) => r.userId);
      if (userIds.length === 0) {
        return NextResponse.json({ leaderboard: [] });
      }

      const userRows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          referralCode: users.referralCode,
        })
        .from(users)
        .where(sql`${users.id} = ANY(${userIds})`);

      const userMap = new Map(userRows.map((u) => [u.id, u]));
      const codes = userRows.map((u) => u.referralCode);

      const refCountRows = codes.length
        ? await db
          .select({
            code: users.referredBy,
            count: sql<number>`COUNT(*)`.as("count"),
          })
          .from(users)
          .where(sql`${users.referredBy} = ANY(${codes})`)
          .groupBy(users.referredBy)
        : [];
      const refCounts = new Map(refCountRows.map((r) => [r.code, Number(r.count)]));

      const leaderboard = totals.map((row, i) => {
        const u = userMap.get(row.userId);
        return {
          rank: i + 1,
          id: maskId(row.userId),
          displayName: u?.displayName ?? null,
          total: Math.round(Number(row.total) || 0),
          referralCount: u?.referralCode ? refCounts.get(u.referralCode) ?? 0 : 0,
        };
      });

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
          .where(sql`${users.referralCode} = ANY(${codes})`)
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

    // weeklyGainers: sum of airdrops in the current ISO week
    const weekRows = await db
      .select({
        userId: airdrops.userId,
        gain: sql<number>`SUM(${airdrops.amount})`.as("gain"),
      })
      .from(airdrops)
      .where(eq(airdrops.weekKey, currentWeek))
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
      .where(sql`${users.id} = ANY(${userIds})`);
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
