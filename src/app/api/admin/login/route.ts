import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import crypto from "crypto";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  ADMIN_SOLANA_PUBKEY,
  buildChallengeMessage,
  extractIssuedAt,
  issueSessionToken,
  revokeSession,
} from "@/lib/admin-auth";

/**
 * GET /api/admin/login?step=nonce
 *   Returns { nonce, message } for the client to sign via Phantom.
 *   We don't track the nonce server-side (stateless) — freshness is
 *   enforced by the `Issued: <ISO timestamp>` inside the message, which
 *   must be within the last 5 minutes when POSTed back.
 *
 * POST /api/admin/login
 *   Body: { message, signature, publicKey }
 *   - message:   the exact string we handed out via GET (incl. nonce + Issued)
 *   - signature: base64 of the 64-byte ed25519 sig from Phantom
 *   - publicKey: the signer's base58 Solana address
 *
 *   Verifies:
 *     1. publicKey === ADMIN_SOLANA_PUBKEY (hardcoded single-user allow-list)
 *     2. ed25519 signature valid over `message` by publicKey
 *     3. Message was issued < 5 min ago (prevents long-lived challenge reuse)
 *     4. Message has the expected shape (starts with our preamble)
 *   On success: sets HttpOnly cookie with a 24h HMAC session token and
 *   returns { ok: true }.
 */

const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const step = req.nextUrl.searchParams.get("step");
  if (step !== "nonce") {
    return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = buildChallengeMessage(nonce);
  return NextResponse.json({ nonce, message });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, signature, publicKey } = body as {
      message?: unknown;
      signature?: unknown;
      publicKey?: unknown;
    };

    if (typeof message !== "string" || typeof signature !== "string" || typeof publicKey !== "string") {
      return NextResponse.json({ error: "Missing or malformed fields" }, { status: 400 });
    }

    // 1. Preamble check — reject obviously wrong messages fast
    if (!message.startsWith("PolyStream admin sign-in")) {
      return NextResponse.json({ error: "Invalid message format" }, { status: 401 });
    }

    // 2. Pubkey must match the hardcoded admin — single-user allow-list
    if (publicKey !== ADMIN_SOLANA_PUBKEY) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }

    // 3. Challenge freshness — reject messages older than 5 min
    const issuedAt = extractIssuedAt(message);
    if (!issuedAt) {
      return NextResponse.json({ error: "Invalid message timestamp" }, { status: 401 });
    }
    if (Date.now() - issuedAt.getTime() > CHALLENGE_MAX_AGE_MS) {
      return NextResponse.json({ error: "Challenge expired — retry" }, { status: 401 });
    }
    if (issuedAt.getTime() > Date.now() + 60_000) {
      // Future-dated by more than 1 min — clock skew or tampering
      return NextResponse.json({ error: "Invalid challenge timestamp" }, { status: 401 });
    }

    // 4. ed25519 signature verification
    let pubkeyBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubkeyBytes = bs58.decode(publicKey);
      sigBytes = Buffer.from(signature, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid signature encoding" }, { status: 400 });
    }
    if (pubkeyBytes.length !== 32) {
      return NextResponse.json({ error: "Invalid pubkey length" }, { status: 400 });
    }
    if (sigBytes.length !== 64) {
      return NextResponse.json({ error: "Invalid signature length" }, { status: 400 });
    }
    const msgBytes = new TextEncoder().encode(message);
    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
    if (!ok) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }

    // 5. Issue session cookie (writes the session row to settings table)
    const token = await issueSessionToken(publicKey);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (err) {
    console.error("Admin login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

// Logout — clears the cookie AND revokes the server-side session row.
// Without the revoke, a stolen cookie would remain valid until expiry.
export async function DELETE() {
  await revokeSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
