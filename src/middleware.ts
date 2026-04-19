import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Simple in-memory rate limiter (per-IP, resets on cold start)
const rateLimit = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute per IP

// Stricter limits for sensitive endpoints
const sensitiveRateLimit = new Map<string, { count: number; resetAt: number }>();
const SENSITIVE_LIMIT_WINDOW = 60_000;
const SENSITIVE_LIMIT_MAX = 10; // 10 requests per minute for airdrop/trade

function checkSensitiveRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = sensitiveRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    sensitiveRateLimit.set(ip, { count: 1, resetAt: now + SENSITIVE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= SENSITIVE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count++;
  return true;
}

// Referral attribution cookie. Survives the Google OAuth round-trip
// natively (cookies are sent on every same-domain request regardless
// of where the navigation originated, so unlike sessionStorage there's
// no consume-timing trap). 30-day window matches industry standard
// (Dropbox, Coinbase) for "first-touch" attribution.
//
// SameSite=Lax (NOT Strict) is critical: Strict drops the cookie on
// the 302 returning from Google, defeating the whole point.
//
// First-touch wins: middleware only writes the cookie if it isn't
// already set, so a user clicking Friend A's link then Friend B's
// link sticks with A as their attributed referrer.
const REF_COOKIE = "ps_ref";
const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Capture `?ref=…` into a cookie before anything redirects us off-site.
  // Skips API routes (those POST the body directly), only fires on
  // navigations / page renders. Idempotent — re-clicking the same link
  // doesn't re-extend the window, and a different code in the URL
  // doesn't overwrite an existing attribution.
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    const ref = request.nextUrl.searchParams.get("ref");
    const existing = request.cookies.get(REF_COOKIE)?.value;
    if (ref && !existing) {
      response.cookies.set(REF_COOKIE, ref.toUpperCase(), {
        maxAge: REF_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        httpOnly: false, // client may want to read this for the apply-referral UI
      });
    }
  }

  // Security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.magic.link https://*.walletconnect.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; frame-src https://www.youtube.com https://rumble.com https://*.magic.link https://auth.magic.link https://*.walletconnect.com; connect-src 'self' https: wss:;"
  );

  // Rate limit API routes only
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Try again in a minute." },
        { status: 429 }
      );
    }

    // Stricter limits on airdrop and trade endpoints
    const path = request.nextUrl.pathname;
    if (path === "/api/airdrop" || path === "/api/trade") {
      if (!checkSensitiveRateLimit(ip)) {
        return NextResponse.json(
          { error: "Rate limit exceeded for this action." },
          { status: 429 }
        );
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
