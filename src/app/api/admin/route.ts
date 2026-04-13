import { NextRequest, NextResponse } from "next/server";
import { getDb, users, airdrops, trades, positions, referrals } from "@/db";
import { sql, desc, gt, count, eq } from "drizzle-orm";

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
          email: users.email,
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

// POST /api/admin - Admin actions (set balance, reset user)
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, userId, balance } = body;

    const db = getDb();

    // migrateAccounts uses userIds array, not userId — handle before the userId check
    if (action === "migrateAccounts") {
      const { userIds } = body;
      if (!Array.isArray(userIds) || userIds.length !== 2) {
        return NextResponse.json({ error: "Need exactly 2 userIds" }, { status: 400 });
      }

      const [acc1] = await db.select().from(users).where(eq(users.id, userIds[0])).limit(1);
      const [acc2] = await db.select().from(users).where(eq(users.id, userIds[1])).limit(1);
      if (!acc1 || !acc2) {
        return NextResponse.json({ error: "One or both accounts not found" }, { status: 404 });
      }

      const source = new Date(acc1.createdAt) < new Date(acc2.createdAt) ? acc1 : acc2;
      const target = source.id === acc1.id ? acc2 : acc1;

      console.log(`Admin migrate: ${source.id} → ${target.id}`);

      await db.update(positions).set({ userId: target.id }).where(eq(positions.userId, source.id));
      await db.update(trades).set({ userId: target.id }).where(eq(trades.userId, source.id));
      await db.update(airdrops).set({ userId: target.id }).where(eq(airdrops.userId, source.id));
      await db.update(referrals).set({ referrerId: target.id }).where(eq(referrals.referrerId, source.id));
      await db.update(referrals).set({ referredId: target.id }).where(eq(referrals.referredId, source.id));

      await db.update(users).set({
        balance: sql`${users.balance} + ${source.balance}`,
        displayName: target.displayName || source.displayName,
      }).where(eq(users.id, target.id));

      await db.delete(users).where(eq(users.id, source.id));

      return NextResponse.json({ success: true, from: source.id, to: target.id });
    }

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    // Try exact ID first, then lowercased (handles mixed-case Google auth IDs)
    async function findAndUpdate(setter: Record<string, unknown>) {
      let [updated] = await db.update(users).set(setter).where(eq(users.id, userId)).returning();
      if (!updated) {
        [updated] = await db.update(users).set(setter).where(eq(users.id, userId.toLowerCase())).returning();
      }
      return updated || null;
    }

    if (action === "setBalance") {
      if (typeof balance !== "number" || balance < 0) {
        return NextResponse.json({ error: "Invalid balance" }, { status: 400 });
      }

      const updated = await findAndUpdate({ balance });
      if (!updated) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true, user: { id: updated.id, balance: updated.balance } });
    }

    if (action === "resetBalance") {
      const updated = await findAndUpdate({ balance: 1000 });
      if (!updated) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true, user: { id: updated.id, balance: updated.balance } });
    }

    if (action === "getUserDetails") {
      // Fetch user profile, trades, and positions for monitoring
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        // Try lowercase
        const [userLower] = await db.select().from(users).where(eq(users.id, userId.toLowerCase())).limit(1);
        if (!userLower) return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const targetId = user?.id || userId.toLowerCase();

      const [userTrades, userPositions, userAirdrops] = await Promise.all([
        db.select().from(trades).where(eq(trades.userId, targetId)).orderBy(desc(trades.createdAt)).limit(50),
        db.select().from(positions).where(eq(positions.userId, targetId)).orderBy(desc(positions.updatedAt)),
        db.select().from(airdrops).where(eq(airdrops.userId, targetId)).orderBy(desc(airdrops.createdAt)).limit(30),
      ]);

      return NextResponse.json({
        user: user || null,
        trades: userTrades,
        positions: userPositions,
        airdrops: userAirdrops,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("Admin POST error:", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
