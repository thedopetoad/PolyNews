"use client";

import { Magic } from "magic-sdk";
import { OAuthExtension } from "@magic-ext/oauth2";

const MAGIC_API_KEY = process.env.NEXT_PUBLIC_MAGIC_API_KEY || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let magicInstance: any = null;

/**
 * Get or create the Magic SDK instance configured for Polygon.
 * Magic handles Google login with a clean popup — straight to Google account picker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMagic(): any {
  if (!MAGIC_API_KEY) return null;
  if (typeof window === "undefined") return null;

  if (!magicInstance) {
    // polygon-rpc.com has intermittent CORS + "Failed to fetch" errors when
    // called from Magic's iframe. drpc.org is reliable and CORS-friendly.
    magicInstance = new Magic(MAGIC_API_KEY, {
      network: {
        rpcUrl: "https://polygon.drpc.org",
        chainId: 137,
      },
      extensions: [new OAuthExtension()],
    });
  }

  return magicInstance;
}

/**
 * Check if user has an active Magic session.
 * Magic sessions persist across page refreshes automatically.
 * Returns the Polygon wallet address AND email if logged in, null otherwise.
 * We need the email on every session restore so stale DB rows (created before
 * we started capturing email) can be backfilled and future Magic-address
 * changes can be linked via email-based migration.
 */
export async function checkMagicSession(): Promise<{ address: string; email: string | null } | null> {
  const magic = getMagic();
  if (!magic) return null;

  try {
    const isLoggedIn = await magic.user.isLoggedIn();
    if (!isLoggedIn) return null;

    const info = await magic.user.getInfo();
    const address = info.publicAddress?.toLowerCase();
    if (!address) return null;
    // Magic's `getInfo()` response has shifted over SDK versions — email has
    // shown up directly on `info`, under `userMetadata`, and nested inside
    // `oauth.userInfo`. Check every known location so a single missing field
    // on one SDK path doesn't drop the email on the floor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const email = extractEmail(info as any);
    return { address, email };
  } catch (err) {
    console.error("Magic session check failed:", err);
    return null;
  }
}

// sessionStorage key for stashing the page the user was on when they
// clicked "Continue with Google", so we can send them back there after
// the OAuth round-trip completes. Keeps the login flow using a single
// whitelisted redirect URI (the site root) — previous implementation
// passed the current pathname as redirectURI, which broke with
// `Error 400: redirect_uri_mismatch` whenever a user tried to log in
// from a page whose URL wasn't on Google's (or Magic's) allowed list.
// aggrehglory@gmail.com hit exactly that path on /airdrop or similar.
const RETURN_PATH_KEY = "polystream:login-return-path";

// sessionStorage key for the referral code lifted from a `?ref=…` URL
// param. We stash it on page load so it can survive the Google OAuth
// round-trip (which strips every URL param that isn't state/code).
// Without this, any friend who clicks a referral link and signs up
// with Google creates an account with referredBy=null — the referrer
// never sees their friend count tick up or gets the +5000 bonus.
// Wallet logins were fine because they don't redirect off-site.
const REF_KEY = "polystream:pending-ref";

/**
 * Capture `?ref=…` from the current URL into sessionStorage so it
 * survives off-site OAuth redirects. Idempotent; safe to call on
 * every page load. Does NOT overwrite an existing stashed ref (first
 * ref wins — keeps a later page visit from replacing the original
 * referrer).
 */
export function captureRefFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && !sessionStorage.getItem(REF_KEY)) {
      sessionStorage.setItem(REF_KEY, ref);
    }
  } catch { /* sessionStorage can be blocked */ }
}

/**
 * Read the stashed ref code. Clears it so subsequent /api/user calls
 * (e.g. session restore on a repeat visit) don't re-send it. Falls
 * back to scanning the URL in case captureRefFromUrl wasn't called
 * yet — the wallet-login flow calls this directly without going
 * through Google OAuth.
 */
export function consumePendingRef(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const stashed = sessionStorage.getItem(REF_KEY);
    if (stashed) {
      sessionStorage.removeItem(REF_KEY);
      return stashed;
    }
  } catch { /* ignore */ }
  try {
    return new URLSearchParams(window.location.search).get("ref") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start Google OAuth login via Magic.
 * Opens Google's account picker directly — no intermediate modal.
 * Saves the current page to sessionStorage so handleOAuthRedirect can
 * navigate back once the OAuth round-trip is complete.
 */
export async function loginWithGoogle(): Promise<void> {
  const magic = getMagic();
  if (!magic) throw new Error("Magic not initialized");

  // Save the page we came from so we can restore it after OAuth returns.
  // Includes query + hash in case the user was deep-linked somewhere
  // (e.g. /airdrop?tab=earn). OAuth itself always returns to the site
  // root — that's the only path we need to keep on the whitelist.
  try {
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (current && current !== "/") {
      sessionStorage.setItem(RETURN_PATH_KEY, current);
    }
  } catch { /* sessionStorage can be blocked; fall back to root */ }

  await magic.oauth2.loginWithRedirect({
    provider: "google",
    redirectURI: window.location.origin + "/",
  });
}

/**
 * Pop the stashed pre-login path (if any) so callers can router.replace
 * the user back to where they started. Clears the stash so a page
 * refresh doesn't re-trigger the navigation.
 */
export function consumePostLoginReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_PATH_KEY);
    if (path) sessionStorage.removeItem(RETURN_PATH_KEY);
    return path;
  } catch {
    return null;
  }
}

/**
 * Handle the OAuth redirect callback.
 * Call this on page load to complete the login flow after Google redirects back.
 * Returns the wallet address if login succeeded, null if no redirect happened.
 */
export interface OAuthResult {
  address: string | null;
  email: string | null;
}

export async function handleOAuthRedirect(): Promise<OAuthResult | null> {
  const magic = getMagic();
  if (!magic) return null;

  // Only process if we have OAuth params in the URL (Google returns state+code)
  const url = new URL(window.location.href);
  const hasOAuthParams = url.searchParams.has("state") && url.searchParams.has("code");
  const hasMagicParams = url.searchParams.has("magic_oauth_request_id") || url.searchParams.has("magic_credential");
  if (!hasOAuthParams && !hasMagicParams) {
    return null;
  }

  try {
    const result = await magic.oauth2.getRedirectResult();
    const address = result?.magic?.userMetadata?.publicAddress?.toLowerCase()
      || result?.magic?.userMetadata?.wallets?.ethereum?.publicAddress?.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const email = extractEmail(result as any);
    if (!email) {
      // Useful when a new user's email ends up NULL in the DB — lets us
      // see in prod logs which response shape Magic returned, so we can
      // add another fallback path rather than silently dropping it.
      console.warn("Magic OAuth redirect: no email found on result", {
        oauthShape: result?.oauth ? Object.keys(result.oauth) : null,
        magicShape: result?.magic ? Object.keys(result.magic) : null,
        userMetaKeys: result?.magic?.userMetadata ? Object.keys(result.magic.userMetadata) : null,
      });
    }

    // Clean up URL — remove all OAuth params
    window.history.replaceState({}, "", url.pathname);

    return { address: address || null, email };
  } catch (err) {
    console.error("Magic OAuth redirect failed:", err);
    return null;
  }
}

/**
 * Pull an email out of any of the Magic SDK response shapes we've seen.
 * The structure has shifted between `magic-sdk` versions and between the
 * OAuth redirect result vs `user.getInfo()`. Checking every known path
 * keeps users from slipping through with a NULL email.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEmail(obj: any): string | null {
  if (!obj) return null;
  const candidates = [
    obj.email,
    obj.userMetadata?.email,
    obj.magic?.userMetadata?.email,
    obj.oauth?.userInfo?.email,
    obj.oauth?.userHandle,
    obj.oauth?.user_info?.email,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.includes("@")) {
      return c.toLowerCase().trim();
    }
  }
  return null;
}

/**
 * Log out from Magic. Clears the session completely.
 */
export async function logoutMagic(): Promise<void> {
  const magic = getMagic();
  if (!magic) return;

  try {
    await magic.user.logout();
  } catch (err) {
    console.error("Magic logout failed:", err);
  }
}
