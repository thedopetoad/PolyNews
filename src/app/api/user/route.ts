import { NextRequest, NextResponse } from "next/server";
import { getDb, users, positions, trades, airdrops } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import {
  isValidAddress,
  generateSecureId,
  generateReferralCode,
  getAuthenticatedUser,
} from "@/lib/auth";
import { STARTING_BALANCE } from "@/lib/constants";

// GET /api/user?id=0x123... - Get own user (auth required)
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("id");
  if (!userId || !isValidAddress(userId)) {
    return NextResponse.json(
      { error: "Invalid or missing user ID" },
      { status: 400 }
    );
  }

  // Only allow users to fetch their own record
  const authed = request.headers.get("authorization")?.replace("Bearer ", "").trim().toLowerCase();
  const requestedId = userId.toLowerCase();

  if (!authed || authed !== requestedId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, requestedId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, requestedId));
      return NextResponse.json(existing[0]);
    }

    return NextResponse.json({ error: "User not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

// Rate limit account creation per IP (in-memory, resets on cold start)
const createLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_CREATES_PER_IP = 3; // max 3 accounts per IP per hour

// POST /api/user - Create new user
export async function POST(request: NextRequest) {
  try {
    // Rate limit account creation by IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const limit = createLimits.get(ip);
    if (limit && limit.resetAt > now) {
      if (limit.count >= MAX_CREATES_PER_IP) {
        return NextResponse.json({ error: "Too many accounts created. Try again later." }, { status: 429 });
      }
      limit.count++;
    } else {
      createLimits.set(ip, { count: 1, resetAt: now + 3600000 }); // 1 hour window
    }

    const body = await request.json();
    const { id, authMethod, walletAddress, referredBy, email } = body;

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
    const normalizedId = id.toLowerCase();
    const normalizedEmail = email?.toLowerCase()?.trim() || null;

    // Check if user already exists with this address
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, normalizedId))
      .limit(1);

    if (existing.length > 0) {
      // Update email if we have one now and they don't
      if (normalizedEmail && !existing[0].email) {
        await db.update(users).set({ email: normalizedEmail, lastLoginAt: new Date() }).where(eq(users.id, normalizedId));
      }
      return NextResponse.json(existing[0]);
    }

    // ─── Account migration: check if old account exists with same email ───
    if (normalizedEmail && authMethod === "google") {
      const [oldAccount] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, normalizedEmail), ne(users.id, normalizedId)))
        .limit(1);

      if (oldAccount) {
        // Migrate: transfer all data from old account to new address
        const oldId = oldAccount.id;
        console.log(`Migrating account: ${oldId} → ${normalizedId} (email: ${normalizedEmail})`);

        // Transfer positions, trades, airdrops to new address
        await db.update(positions).set({ userId: normalizedId }).where(eq(positions.userId, oldId));
        await db.update(trades).set({ userId: normalizedId }).where(eq(trades.userId, oldId));
        await db.update(airdrops).set({ userId: normalizedId }).where(eq(airdrops.userId, oldId));

        // Update the old account's ID to the new address (preserves balance, display name, etc.)
        // We can't change a PK easily, so create new user with old data then delete old
        const referralCode = generateReferralCode();
        const [migrated] = await db
          .insert(users)
          .values({
            id: normalizedId,
            displayName: oldAccount.displayName,
            email: normalizedEmail,
            authMethod: "google",
            walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
            referralCode,
            referredBy: oldAccount.referredBy,
            balance: oldAccount.balance,
            hasSignupAirdrop: oldAccount.hasSignupAirdrop,
            lastDailyAirdrop: oldAccount.lastDailyAirdrop,
            lastWeeklyAirdrop: oldAccount.lastWeeklyAirdrop,
            signupIp: oldAccount.signupIp,
          })
          .returning();

        // Delete old account
        await db.delete(users).where(eq(users.id, oldId));

        console.log(`Migration complete: ${oldId} → ${normalizedId}, balance: ${migrated.balance}`);
        return NextResponse.json(migrated, { status: 201 });
      }
    }

    // ─── No migration needed — create fresh account ───
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
        email: normalizedEmail,
        authMethod,
        walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
        referralCode,
        referredBy: referredBy || null,
        balance: STARTING_BALANCE,
        signupIp: ip,
      })
      .returning();

    return NextResponse.json(newUser, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

// PATCH /api/user - Update display name
export async function PATCH(request: NextRequest) {
  try {
    const authedUser = getAuthenticatedUser(request);
    if (!authedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { displayName } = body;

    if (!displayName || typeof displayName !== "string") {
      return NextResponse.json({ error: "Display name required" }, { status: 400 });
    }

    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      return NextResponse.json({ error: "Display name must be 2-20 characters" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return NextResponse.json({ error: "Only letters, numbers, and underscores allowed" }, { status: 400 });
    }

    const db = getDb();

    const [updated] = await db
      .update(users)
      .set({ displayName: trimmed })
      .where(eq(users.id, authedUser))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
