import { NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { eq } from "drizzle-orm";
import {
  isValidAddress,
  generateSecureId,
  generateReferralCode,
} from "@/lib/auth";

// GET /api/user?id=0x123... - Get user
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("id");
  if (!userId || !isValidAddress(userId)) {
    return NextResponse.json(
      { error: "Invalid or missing user ID" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const id = userId.toLowerCase();

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, id));
      return NextResponse.json(existing[0]);
    }

    return NextResponse.json({ error: "User not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
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

    // Validate address format for wallet auth
    if (authMethod === "wallet" && !isValidAddress(id)) {
      return NextResponse.json(
        { error: "Invalid wallet address format" },
        { status: 400 }
      );
    }

    // Validate authMethod
    if (!["wallet", "google"].includes(authMethod)) {
      return NextResponse.json(
        { error: "Invalid auth method" },
        { status: 400 }
      );
    }

    const db = getDb();
    const normalizedId = authMethod === "wallet" ? id.toLowerCase() : id;

    // Check if user already exists
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, normalizedId))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(existing[0]);
    }

    // Validate referral code if provided
    if (referredBy) {
      const referrer = await db
        .select()
        .from(users)
        .where(eq(users.referralCode, referredBy))
        .limit(1);
      if (referrer.length === 0) {
        return NextResponse.json(
          { error: "Invalid referral code" },
          { status: 400 }
        );
      }
    }

    const referralCode = generateReferralCode();

    const [newUser] = await db
      .insert(users)
      .values({
        id: normalizedId,
        authMethod,
        walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
        referralCode,
        referredBy: referredBy || null,
        balance: 10000,
      })
      .returning();

    return NextResponse.json(newUser, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
