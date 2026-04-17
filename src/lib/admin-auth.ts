import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * Admin session auth — Solana Phantom signature + HttpOnly cookie.
 *
 * Flow:
 *   1. Client fetches GET /api/admin/login?step=nonce → { nonce, message }
 *   2. Client asks Phantom to signMessage(message) (Solana / ed25519)
 *   3. Client POSTs { message, signature, publicKey } to /api/admin/login
 *   4. Server verifies: ed25519 signature valid + publicKey === ALLOWED_ADMIN
 *                       + nonce fresh + message well-formed
 *   5. Server issues an HmacSHA256-signed session token in an HttpOnly cookie
 *   6. Every /api/admin/* request checks the cookie via requireAdmin()
 *
 * Single allowed wallet — hardcoded. Not configurable from the UI.
 */

export const ADMIN_COOKIE_NAME = "polystream_admin_session";
export const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

/**
 * Session secret for HMAC. Falls back to an ephemeral random per-process
 * secret if the env var is missing — that means sessions don't survive a
 * server restart (fine for admin; better than silently running insecure).
 */
function getSessionSecret(): string {
  const envSecret = process.env.ADMIN_SESSION_SECRET;
  if (envSecret && envSecret.length >= 32) return envSecret;
  // dev fallback — stable within a single process lifecycle
  if (!globalThis.__polystreamAdminSecret) {
    globalThis.__polystreamAdminSecret = crypto.randomBytes(32).toString("hex");
  }
  return globalThis.__polystreamAdminSecret;
}

/**
 * Build a session token: base64url(payload).hmacHex
 * Payload is JSON { pubkey, exp }.
 */
export function issueSessionToken(pubkey: string): string {
  const payload = {
    pubkey,
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("hex");
  return `${payloadB64}.${mac}`;
}

/** Returns { pubkey } if the token is valid and unexpired, else null. */
export function verifySessionToken(token: string | undefined): { pubkey: string } | null {
  if (!token) return null;
  const [payloadB64, mac] = token.split(".");
  if (!payloadB64 || !mac) return null;
  const expectedMac = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("hex");
  // Timing-safe compare — a naive === on hex strings technically leaks a
  // few bytes of the MAC over time. Not exploitable at this scale but
  // cheap to do right.
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expectedMac, "hex");
  if (macBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(macBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      pubkey: string;
      exp: number;
    };
    if (!payload.pubkey || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return { pubkey: payload.pubkey };
  } catch {
    return null;
  }
}

/**
 * Gate API routes. Reads the admin cookie, verifies, also re-checks the
 * pubkey against the allow-list in case the hardcoded list ever changes.
 */
export function requireAdmin(request: NextRequest): { pubkey: string } | null {
  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = verifySessionToken(cookie);
  if (!session) return null;
  if (session.pubkey !== ADMIN_SOLANA_PUBKEY) return null;
  return session;
}

// Module augmentation for the process-wide fallback secret.
declare global {
  // eslint-disable-next-line no-var
  var __polystreamAdminSecret: string | undefined;
}
