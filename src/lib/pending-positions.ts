"use client";

/**
 * Bridge between the bet-slip's "trade confirmed onchain" moment and the
 * portfolio page's open-positions list. Polymarket's /positions data-api
 * lags onchain settlement by ~10-30s, which means a user who hits "buy",
 * sees "Settled onchain ✓", and immediately taps Portfolio is greeted by
 * the OLD positions list (sans their fresh trade). Feels broken.
 *
 * We write a small record to localStorage the moment TradeProgress fires
 * its onConfirmed, then the portfolio page reads and renders a skeleton
 * row until /positions returns the matching asset (token id) — then
 * clears the record. 2-minute TTL as a safety net in case the data-api
 * never catches up (e.g. the trade resolved to zero shares).
 */

export interface PendingPosition {
  /** CLOB token id — the key we match against /positions' `asset` field. */
  tokenId: string;
  /** Market title for the skeleton row label. */
  marketTitle: string;
  /** Outcome name, e.g. "Baltimore Orioles" or "Yes". */
  outcomeName: string;
  /** Expected shares from the trade response (for the skeleton display). */
  shares: number;
  /** Price at fill, so P&L looks sensible in the skeleton. */
  avgPrice: number;
  /** BUY or SELL — SELL means we're shrinking a position, handled by closedLocally. */
  side: "BUY" | "SELL";
  /** UNIX ms; entries past `createdAt + TTL` get auto-swept. */
  createdAt: number;
}

const KEY = "polystream-pending-positions";
const TTL_MS = 120_000;

export function addPendingPosition(p: Omit<PendingPosition, "createdAt">) {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const existing = loadPendingPositions();
    // Dedupe on tokenId — newer entry wins.
    const filtered = existing.filter((e) => e.tokenId !== p.tokenId);
    filtered.push({ ...p, createdAt: now });
    localStorage.setItem(KEY, JSON.stringify(filtered));
  } catch {}
}

export function loadPendingPositions(): PendingPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingPosition[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((e) => e && now - e.createdAt < TTL_MS);
  } catch {
    return [];
  }
}

export function removePendingPosition(tokenId: string) {
  if (typeof window === "undefined") return;
  try {
    const remaining = loadPendingPositions().filter((e) => e.tokenId !== tokenId);
    localStorage.setItem(KEY, JSON.stringify(remaining));
  } catch {}
}

export function prunePendingPositions() {
  if (typeof window === "undefined") return;
  try {
    const live = loadPendingPositions();
    localStorage.setItem(KEY, JSON.stringify(live));
  } catch {}
}
