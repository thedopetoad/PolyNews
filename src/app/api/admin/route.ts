import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades } from "@/db";
import { sql, desc, gt, count } from "drizzle-orm";

// Only these addresses can access the admin dashboard
const ADMIN_ADDRESSES = [
  "0xfbeefb072f368803b33ba5c529f2f6762941b282", // Owner wallet
  "0x6f4e9f64d68abd067fbb1a2f62d21a1b01f190b1", // Team wallet
  "0xcf0b29d5c0ceede01543eb28400fdcb5034bc0fe", // Dan's wallet
];

function isAdmin(request: NextRequest): boolean {
  const token = request.headers
    .get("authorization")
    ?.replace("Bearer ", "")
    .trim()
    .toLowerCase();
  return !!token && ADMIN_ADDRESSES.includes(token);
}

// GET /api/admin - Full admin dashboard data
export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const db = getDb();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      allUsers,
      todayUsers,
      weekUsers,
      airdropStats,
      airdropBySource,
      recentUsersList,
      highBalanceUsers,
      heavyClaimers,
      tradeStats,
      recentTrades,
    ] = await Promise.all([
      // Total user count
      db.select({ count: count() }).from(users),

      // Users created today
      db
        .select({ count: count() })
        .from(users)
        .where(gt(users.createdAt, oneDayAgo)),

      // Users created this week
      db
        .select({ count: count() })
        .from(users)
        .where(gt(users.createdAt, oneWeekAgo)),

      // Total airdrop tokens distributed
      db
        .select({
          totalAmount: sql<number>`COALESCE(SUM(${airdrops.amount}), 0)`,
          totalClaims: count(),
        })
        .from(airdrops),

      // Airdrop breakdown by source
      db
        .select({
          source: airdrops.source,
          totalAmount: sql<number>`SUM(${airdrops.amount})`,
          claimCount: count(),
        })
        .from(airdrops)
        .groupBy(airdrops.source),

      // Recent 20 users
      db
        .select({
          id: users.id,
          displayName: users.displayName,
          authMethod: users.authMethod,
          balance: users.balance,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
          signupIp: users.signupIp,
          hasSignupAirdrop: users.hasSignupAirdrop,
          referredBy: users.referredBy,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(20),

      // Suspicious: high balance users (> 50,000)
      db
        .select({
          id: users.id,
          displayName: users.displayName,
          balance: users.balance,
          createdAt: users.createdAt,
          signupIp: users.signupIp,
        })
        .from(users)
        .where(gt(users.balance, 50000))
        .orderBy(desc(users.balance)),

      // Suspicious: users with many airdrop claims
      db
        .select({
          userId: airdrops.userId,
          claimCount: count(),
          totalAmount: sql<number>`SUM(${airdrops.amount})`,
        })
        .from(airdrops)
        .groupBy(airdrops.userId)
        .having(sql`COUNT(*) > 10`)
        .orderBy(sql`COUNT(*) DESC`),

      // Trade stats
      db
        .select({
          totalTrades: count(),
          totalVolume: sql<number>`COALESCE(SUM(${trades.shares} * ${trades.price}), 0)`,
        })
        .from(trades),

      // Recent 10 trades
      db
        .select({
          id: trades.id,
          userId: trades.userId,
          marketQuestion: trades.marketQuestion,
          side: trades.side,
          shares: trades.shares,
          price: trades.price,
          createdAt: trades.createdAt,
        })
        .from(trades)
        .orderBy(desc(trades.createdAt))
        .limit(10),
    ]);

    // Build IP report: group users by signup IP
    const ipGroups: Record<string, string[]> = {};
    for (const u of recentUsersList) {
      if (u.signupIp) {
        if (!ipGroups[u.signupIp]) ipGroups[u.signupIp] = [];
        ipGroups[u.signupIp].push(u.id);
      }
    }

    // Also query ALL users with IPs to find multi-account IPs
    const allUsersWithIp = await db
      .select({ id: users.id, signupIp: users.signupIp })
      .from(users)
      .where(sql`${users.signupIp} IS NOT NULL`);

    const fullIpGroups: Record<string, string[]> = {};
    for (const u of allUsersWithIp) {
      if (u.signupIp) {
        if (!fullIpGroups[u.signupIp]) fullIpGroups[u.signupIp] = [];
        fullIpGroups[u.signupIp].push(u.id);
      }
    }

    // Only include IPs with 2+ accounts (suspicious)
    const suspiciousIps = Object.entries(fullIpGroups)
      .filter(([, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([ip, userIds]) => ({ ip, accountCount: userIds.length, userIds }));

    // Build suspicious accounts list
    const suspicious: Array<{
      userId: string;
      reason: string;
      details: string;
    }> = [];

    // High balance
    for (const u of highBalanceUsers) {
      suspicious.push({
        userId: u.id,
        reason: "HIGH_BALANCE",
        details: `Balance: ${u.balance?.toLocaleString()} AIRDROP`,
      });
    }

    // Heavy airdrop claimers
    for (const u of heavyClaimers) {
      suspicious.push({
        userId: u.userId,
        reason: "EXCESSIVE_CLAIMS",
        details: `${u.claimCount} claims totaling ${Number(u.totalAmount).toLocaleString()} AIRDROP`,
      });
    }

    // Multi-account IPs
    for (const ipEntry of suspiciousIps) {
      for (const uid of ipEntry.userIds) {
        suspicious.push({
          userId: uid,
          reason: "SHARED_IP",
          details: `IP ${ipEntry.ip} has ${ipEntry.accountCount} accounts`,
        });
      }
    }

    return NextResponse.json({
      stats: {
        totalUsers: allUsers[0]?.count ?? 0,
        usersToday: todayUsers[0]?.count ?? 0,
        usersThisWeek: weekUsers[0]?.count ?? 0,
        totalAirdropsDistributed: airdropStats[0]?.totalAmount ?? 0,
        totalAirdropClaims: airdropStats[0]?.totalClaims ?? 0,
        totalTrades: tradeStats[0]?.totalTrades ?? 0,
        totalTradeVolume: tradeStats[0]?.totalVolume ?? 0,
      },
      airdropBreakdown: airdropBySource,
      recentUsers: recentUsersList,
      recentTrades,
      suspiciousAccounts: suspicious,
      suspiciousIps,
    });
  } catch (e) {
    console.error("Admin API error:", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
