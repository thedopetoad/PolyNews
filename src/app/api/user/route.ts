import { NextRequest, NextResponse } from "next/server";
import { getDb, users, positions, trades, airdrops } from "@/db";
import { eq, and, ne, sql } from "drizzle-orm";
import {
  isValidAddress,
  generateReferralCode,
  getAuthenticatedUser,
} from "@/lib/auth";
import { STARTING_BALANCE } from "@/lib/constants";
import { payReferralBonus } from "@/lib/referral-payout";

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
    const { id, authMethod, walletAddress, email } = body;

    // Referral attribution — body.referredBy used to be the only source,
    // but it lived in client-side sessionStorage which we kept losing
    // across the Google OAuth round-trip (3 separate bug instances this
    // session). The middleware now sets a `ps_ref` cookie with first-
    // touch attribution that survives the redirect natively. Read order:
    //   1. cookie (set by middleware on the original /?ref=… page hit —
    //      authoritative because it can't be eaten by sessionStorage
    //      consume-timing bugs)
    //   2. body.referredBy (legacy path — keeps wallet-login flow
    //      and any future client that hasn't been updated working)
    const cookieRef = request.cookies.get("ps_ref")?.value;
    const referredBy = cookieRef || body.referredBy;
    // Track which source wound up being used so [signup] log lines can
    // distinguish cookie-via-link vs body-via-sessionStorage when we're
    // diagnosing a future drop.
    const refSource = cookieRef ? "cookie" : body.referredBy ? "body" : "none";

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
      const row = existing[0];
      // Update email if we have one now and they don't
      if (normalizedEmail && !row.email) {
        await db.update(users).set({ email: normalizedEmail, lastLoginAt: new Date() }).where(eq(users.id, normalizedId));
      }
      // Back-fill referral code if the user was created without one (e.g.
      // the friend clicked a `?ref=` link, got bitten by the pre-fix
      // Google OAuth stripping of the ref param, and is now retrying
      // with the same link). Atomic — only sets referredBy if it's still
      // NULL, so two concurrent retries can't both credit the referrer.
      if (referredBy && !row.referredBy) {
        const code = String(referredBy).toUpperCase();
        const [referrer] = await db
          .select({ id: users.id, referralCode: users.referralCode })
          .from(users)
          .where(eq(users.referralCode, code))
          .limit(1);
        // Only proceed if the code is valid AND not a self-referral.
        if (referrer && referrer.id !== normalizedId) {
          const claim = await db
            .update(users)
            .set({ referredBy: code })
            .where(and(eq(users.id, normalizedId), sql`${users.referredBy} IS NULL`))
            .returning({ id: users.id });
          if (claim.length > 0) {
            const paid = await payReferralBonus(db, referrer.id, normalizedId, "oauth_backfill");
            console.log(`[backfill-ref] user=${normalizedId} ref=${code} paid=${paid}`);
          } else {
            console.log(`[backfill-ref] user=${normalizedId} ref=${code} skipped=CAS_LOST`);
          }
        } else {
          console.log(`[backfill-ref] user=${normalizedId} ref=${code} skipped=${referrer ? "SELF_REF" : "UNKNOWN_CODE"}`);
        }
      }
      return NextResponse.json(row);
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

    // Normalize the ref code to uppercase upfront — referral codes are
    // generated uppercase (e.g. "PS-B6B43E80"), and if anything in the
    // sharing chain down-cased the URL param we'd silently fail the
    // referrer lookup and drop the payout on the floor.
    const normalizedRefCode = referredBy ? String(referredBy).toUpperCase() : null;

    // ─── No migration needed — create fresh account ───
    // Invalid code → skip the referral (don't hard-fail the signup). An
    // unknown referrer shouldn't stop someone from creating an account.
    let validatedRefCode: string | null = null;
    if (normalizedRefCode) {
      const referrer = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, normalizedRefCode))
        .limit(1);
      if (referrer.length > 0) {
        validatedRefCode = normalizedRefCode;
      } else {
        console.warn(`/api/user POST: unknown referral code "${normalizedRefCode}" — signing up without referrer`);
      }
    }

    const referralCode = generateReferralCode();

    // STARTING_BALANCE IS the signup bonus — there isn't an additional
    // bonus on top of it. Set `hasSignupAirdrop: true` on insert so the
    // legacy /api/airdrop POST {type:"signup"} path (still importable)
    // returns "already claimed" if anything stale calls it and can't
    // accidentally double-credit.
    const [newUser] = await db
      .insert(users)
      .values({
        id: normalizedId,
        email: normalizedEmail,
        authMethod,
        walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
        referralCode,
        referredBy: validatedRefCode,
        balance: STARTING_BALANCE,
        hasSignupAirdrop: true,
        signupIp: ip,
      })
      .returning();

    // Pay the referrer bonus + record the referral pair. Funnels through
    // the shared payReferralBonus so the same idempotency guard (unique
    // index on referrals.referred_id) protects this path. If a separate
    // /api/airdrop apply-referral fires for the same pair, only the
    // first one through actually credits the bonus.
    let paid = false;
    if (validatedRefCode) {
      const [referrer] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, validatedRefCode))
        .limit(1);
      if (referrer) {
        paid = await payReferralBonus(db, referrer.id, normalizedId, "signup_link");
      }
    }

    // Observability hook — if a ref-less signup flood appears again,
    // this line tells us instantly whether it's the client dropping the
    // ref before the POST (ref=MISSING on the new user) or the server
    // failing to pay (ref=<code> but paid=false). Greppable in Vercel
    // logs. Cheap; one line per signup, never contains a secret.
    console.log(
      `[signup] user=${normalizedId} auth=${authMethod} ref=${validatedRefCode ?? (referredBy ? `REJECTED:${referredBy}` : "MISSING")} refSource=${refSource} paid=${paid}`
    );

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
