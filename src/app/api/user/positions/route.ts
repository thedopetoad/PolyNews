import { NextRequest, NextResponse } from "next/server";
import { getDb, positions } from "@/db";
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
      .from(positions)
      .where(eq(positions.userId, userId))
      .orderBy(desc(positions.updatedAt));

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
