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
    magicInstance = new Magic(MAGIC_API_KEY, {
      network: {
        rpcUrl: "https://polygon-rpc.com/",
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
 * Returns the Polygon wallet address if logged in, null otherwise.
 */
export async function checkMagicSession(): Promise<string | null> {
  const magic = getMagic();
  if (!magic) return null;

  try {
    const isLoggedIn = await magic.user.isLoggedIn();
    if (!isLoggedIn) return null;

    const info = await magic.user.getInfo();
    return info.publicAddress?.toLowerCase() || null;
  } catch (err) {
    console.error("Magic session check failed:", err);
    return null;
  }
}

/**
 * Start Google OAuth login via Magic.
 * Opens Google's account picker directly — no intermediate modal.
 * Redirects back to the current page after auth.
 */
export async function loginWithGoogle(): Promise<void> {
  const magic = getMagic();
  if (!magic) throw new Error("Magic not initialized");

  await magic.oauth2.loginWithRedirect({
    provider: "google",
    redirectURI: window.location.origin + "/",
  });
}

/**
 * Handle the OAuth redirect callback.
 * Call this on page load to complete the login flow after Google redirects back.
 * Returns the wallet address if login succeeded, null if no redirect happened.
 */
export async function handleOAuthRedirect(): Promise<string | null> {
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

    // Clean up URL — remove all OAuth params
    window.history.replaceState({}, "", url.pathname);

    return address || null;
  } catch (err) {
    console.error("Magic OAuth redirect failed:", err);
    return null;
  }
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
