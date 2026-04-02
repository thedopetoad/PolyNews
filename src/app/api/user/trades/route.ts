import { NextRequest, NextResponse } from "next/server";
import { getDb, trades } from "@/db";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
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
