import { NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { sql, desc, or, ilike } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/users?q=<query>
//
// Admin-gated user search. Returns the same row shape as the
// `recentUsers` field on /api/admin so the existing table on /admin
// can render results without any JSX changes — admin types in the
// Search Users box, results stream into the same drawer-equipped
// table.
//
// Search is case-insensitive ILIKE across id (wallet/proxy hash),
// displayName, email, walletAddress, and signupIp. Empty query
// returns the most recent 100 users so the table is non-empty even
// before someone starts typing.

const MAX_RESULTS = 100;

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (request.nextUrl.searchParams.get("q") || "").trim();

  try {
    const db = getDb();
    const select = db
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
      .limit(MAX_RESULTS);

    const rows = q
      ? await select.where(
          or(
            ilike(users.id, `%${q}%`),
            ilike(users.displayName, `%${q}%`),
            ilike(users.email, `%${q}%`),
            ilike(users.walletAddress, `%${q}%`),
            ilike(users.signupIp, `%${q}%`),
            ilike(users.referredBy, `%${q}%`),
            // referralCode lookup so admin can paste a code and find the owner
            ilike(users.referralCode, `%${q}%`),
          )
        )
      : await select;

    // Total count so the UI can say "showing 25 of 42"
    const totalRow = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(users);

    return NextResponse.json({
      users: rows,
      shownCount: rows.length,
      totalCount: totalRow[0]?.count ?? 0,
      query: q,
    });
  } catch (e) {
    console.error("Admin user search error:", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
