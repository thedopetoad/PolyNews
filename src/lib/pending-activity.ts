"use client";

/**
 * Same eventual-consistency story as pending-positions.ts, but for the
 * History tab. Polymarket's /activity data-api lags onchain by 10-60s,
 * so a user who just closed a position and flips to History sees old
 * trades while their freshly-mined tx is missing. We keep a localStorage
 * list of "pending activity" entries keyed by tx hash and surface them
 * as skeleton rows until /activity returns them (matched by txHash).
 *
 * 3-minute TTL — activity sometimes lags longer than positions.
 */

export interface PendingActivity {
  /** Onchain tx hash from the CLOB response. Used to match against /activity. */
  txHash: string;
  side: "BUY" | "SELL";
  marketTitle: string;
  outcomeName: string;
  shares: number;
  /** Effective fill price (0-1). */
  price: number;
  /** USDC spent (BUY) or received (SELL). */
  usdcSize: number;
  createdAt: number;
}

const KEY = "polystream-pending-activity";
const TTL_MS = 180_000;

export function addPendingActivity(a: Omit<PendingActivity, "createdAt">) {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const existing = loadPendingActivity();
    // Dedupe on txHash — if the same onchain tx is written twice, newer wins.
    const filtered = existing.filter((e) => e.txHash !== a.txHash);
    filtered.push({ ...a, createdAt: now });
    localStorage.setItem(KEY, JSON.stringify(filtered));
  } catch {}
}

export function loadPendingActivity(): PendingActivity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingActivity[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((e) => e && now - e.createdAt < TTL_MS);
  } catch {
    return [];
  }
}

export function removePendingActivity(txHash: string) {
  if (typeof window === "undefined") return;
  try {
    const remaining = loadPendingActivity().filter((e) => e.txHash !== txHash);
    localStorage.setItem(KEY, JSON.stringify(remaining));
  } catch {}
}
