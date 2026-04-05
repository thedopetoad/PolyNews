import { NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { desc } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const authedUser = getAuthenticatedUser(request);

    const topUsers = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        balance: users.balance,
      })
      .from(users)
      .orderBy(desc(users.balance))
      .limit(50);

    // Mask wallet addresses for privacy — only show to the user themselves
    const masked = topUsers.map((u) => ({
      id: u.id === authedUser ? u.id : u.id.startsWith("0x")
        ? `${u.id.slice(0, 6)}...${u.id.slice(-4)}`
        : u.id.slice(0, 8) + "...",
      displayName: u.displayName,
      balance: u.balance,
    }));

    return NextResponse.json(
      { leaderboard: masked },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
