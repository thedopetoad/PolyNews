import crypto from "crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, settings } from "@/db";

/**
 * Admin session auth — Solana Phantom signature + DB-backed session token.
 *
 * Flow:
 *   1. Client fetches GET /api/admin/login?step=nonce → { nonce, message }
 *   2. Client asks Phantom to signMessage(message) (Solana / ed25519)
 *   3. Client POSTs { message, signature, publicKey } to /api/admin/login
 *   4. Server verifies: ed25519 signature valid + publicKey === ALLOWED_ADMIN
 *                       + nonce fresh + message well-formed
 *   5. Server generates a random 48-byte token, upserts it into the
 *      `settings` table under key "admin_active_session" with the pubkey +
 *      expiry, and sets the token in an HttpOnly cookie.
 *   6. Every /api/admin/* request reads the cookie, looks up the row in
 *      settings, and verifies token+pubkey+exp via requireAdmin().
 *
 * Why DB-backed instead of HMAC-signed?
 *   The previous design needed a server-wide HMAC secret. If
 *   ADMIN_SESSION_SECRET wasn't set, each Vercel serverless function
 *   instance generated its own random fallback secret — so cookies
 *   signed by one function instance wouldn't verify on another, causing
 *   intermittent 401s on newly-deployed routes. DB-backed sessions sidestep
 *   the env var entirely: the source of truth is one row in Postgres that
 *   every function instance reads consistently.
 *
 * Single-user, single-session: only one active session at a time. Signing
 * in on a new device automatically logs out the previous device. Fine for
 * the single-admin use case here.
 *
 * Single allowed wallet — hardcoded. Not configurable from the UI.
 */

export const ADMIN_COOKIE_NAME = "polystream_admin_session";
export const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Settings-table key under which we store the active session row. We use
// the existing settings table to avoid a schema migration just for auth.
const SESSION_SETTINGS_KEY = "admin_active_session";

/**
 * The ONLY wallet allowed to sign into the admin panel. Solana pubkey
 * (base58, ed25519). Must match window.solana.publicKey.toString() when
 * the user signs via Phantom.
 */
export const ADMIN_SOLANA_PUBKEY = "4HHN3zLhVuUcfXuw8MofXLARnQwLgzVhHdPDcBWBiEVT";

/**
 * Message the admin is asked to sign. Includes a nonce (to prevent
 * replay) and an issuedAt timestamp (to expire stale challenges after
 * 5 minutes).
 */
export function buildChallengeMessage(nonce: string): string {
  const issuedAt = new Date().toISOString();
  return [
    "PolyStream admin sign-in",
    "",
    "By signing, you authenticate as the PolyStream admin.",
    "",
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

/**
 * Extract the issuedAt ISO timestamp from the message. Returns null for
 * malformed messages. Used to reject challenges older than 5 minutes.
 */
export function extractIssuedAt(message: string): Date | null {
  const m = message.match(/^Issued: (.+)$/m);
  if (!m) return null;
  const d = new Date(m[1]);
  if (isNaN(d.getTime())) return null;
  return d;
}

interface StoredSession {
  token: string;
  pubkey: string;
  exp: number;
}

async function readStoredSession(): Promise<StoredSession | null> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SESSION_SETTINGS_KEY))
      .limit(1);
    if (rows.length === 0) return null;
    const parsed = JSON.parse(rows[0].value) as StoredSession;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.pubkey !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeStoredSession(session: StoredSession): Promise<void> {
  const db = getDb();
  const value = JSON.stringify(session);
  await db
    .insert(settings)
    .values({ key: SESSION_SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Generate a fresh session token, persist it as the active session for
 * `pubkey`, and return the opaque token to set in the cookie.
 */
export async function issueSessionToken(pubkey: string): Promise<string> {
  const token = crypto.randomBytes(48).toString("hex");
  const session: StoredSession = {
    token,
    pubkey,
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  };
  await writeStoredSession(session);
  return token;
}

/**
 * Look up the cookie token in the settings table. Returns { pubkey } if
 * the token matches the active session and hasn't expired, otherwise null.
 */
export async function verifySessionToken(
  cookieToken: string | undefined,
): Promise<{ pubkey: string } | null> {
  if (!cookieToken) return null;
  const stored = await readStoredSession();
  if (!stored) return null;
  // Timing-safe compare on the hex tokens
  const a = Buffer.from(cookieToken, "utf8");
  const b = Buffer.from(stored.token, "utf8");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > stored.exp) return null;
  return { pubkey: stored.pubkey };
}

/**
 * Revoke the active session (called by DELETE /api/admin/login). Deletes
 * the settings row entirely so subsequent verifies all return null.
 */
export async function revokeSession(): Promise<void> {
  try {
    const db = getDb();
    await db.delete(settings).where(eq(settings.key, SESSION_SETTINGS_KEY));
  } catch {}
}

/**
 * Gate API routes. Reads the admin cookie, verifies, also re-checks the
 * pubkey against the allow-list in case the hardcoded list ever changes.
 *
 * Async because the verification reads the DB. All callers should await.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<{ pubkey: string } | null> {
  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = await verifySessionToken(cookie);
  if (!session) return null;
  if (session.pubkey !== ADMIN_SOLANA_PUBKEY) return null;
  return session;
}
