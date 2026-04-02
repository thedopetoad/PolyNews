import { NextRequest } from "next/server";
import crypto from "crypto";

/**
 * Simple session-based auth for paper trading.
 *
 * MVP approach: client sends wallet address in an Authorization header.
 * The server validates that the address format is correct (0x + 40 hex chars).
 *
 * TODO: Upgrade to SIWE (Sign-In with Ethereum) for proper cryptographic
 * verification that the caller owns the wallet. For paper trading with
 * virtual tokens, this level of auth is acceptable.
 */
export function getAuthenticatedUser(request: NextRequest): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const address = authHeader.replace("Bearer ", "").trim();
    if (isValidAddress(address)) return address.toLowerCase();
  }

  // Fallback: check userId in query params (for GET requests)
  const userId = request.nextUrl.searchParams.get("userId");
  if (userId && isValidAddress(userId)) return userId.toLowerCase();

  return null;
}

/**
 * Validate Ethereum address format (0x + 40 hex characters)
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Cryptographically secure ID generation
 */
export function generateSecureId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a secure referral code
 */
export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(4);
  return "PS-" + bytes.toString("hex").toUpperCase().slice(0, 8);
}

/**
 * Validate trade parameters
 */
export function validateTradeParams(params: {
  shares?: number;
  price?: number;
  side?: string;
  outcome?: string;
}): string | null {
  const { shares, price, side, outcome } = params;

  if (typeof shares !== "number" || !isFinite(shares) || shares <= 0) {
    return "Shares must be a positive number";
  }
  if (shares > 1_000_000) {
    return "Shares cannot exceed 1,000,000";
  }
  if (typeof price !== "number" || !isFinite(price) || price <= 0 || price >= 1) {
    return "Price must be between 0 and 1";
  }
  if (side !== "buy" && side !== "sell") {
    return "Side must be 'buy' or 'sell'";
  }
  if (outcome !== "Yes" && outcome !== "No") {
    return "Outcome must be 'Yes' or 'No'";
  }
  return null;
}
