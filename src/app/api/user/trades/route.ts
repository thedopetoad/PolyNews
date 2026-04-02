import { NextRequest, NextResponse } from "next/server";
import { getDb, trades } from "@/db";
import { eq, desc } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const userId = getAuthenticatedUser(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const result = await db
      .select()
      .from(trades)
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.createdAt))
      .limit(50);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
