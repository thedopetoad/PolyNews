import { NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { eq } from "drizzle-orm";

function generateReferralCode(): string {
  return "PS-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// GET /api/user?id=0x123... - Get or create user
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("id");
  if (!userId) {
    return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
  }

  try {
    const db = getDb();
    // Try to find existing user
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing.length > 0) {
      // Update last login
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, userId));
      return NextResponse.json(existing[0]);
    }

    return NextResponse.json({ error: "User not found" }, { status: 404 });
  } catch {
    return NextResponse.json(
      { error: "Database error" },
      { status: 500 }
    );
  }
}

// POST /api/user - Create new user
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, authMethod, walletAddress, referredBy } = body;

    if (!id || !authMethod) {
      return NextResponse.json(
        { error: "Missing id or authMethod" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check if user already exists
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(existing[0]);
    }

    const referralCode = generateReferralCode();

    const [newUser] = await db
      .insert(users)
      .values({
        id,
        authMethod,
        walletAddress: walletAddress || null,
        referralCode,
        referredBy: referredBy || null,
        balance: 10000,
      })
      .returning();

    return NextResponse.json(newUser, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Database error" },
      { status: 500 }
    );
  }
}
