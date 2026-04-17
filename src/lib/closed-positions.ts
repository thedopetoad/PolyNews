"use client";

/**
 * Positions the user has locally marked as closed — used by the portfolio
 * page to hide them during the 10-30s window it takes Polymarket's
 * /positions data-api to stop returning them after an onchain settlement.
 *
 * Shared storage between anywhere that can close a position (portfolio's
 * Sell modal, bet slip's SELL tab on game view, anywhere else in the
 * future) so the portfolio filters the row immediately regardless of
 * where the close was initiated.
 *
 * Persisted to localStorage with a 2-minute TTL. On reload the portfolio
 * rehydrates; a storage event listener also picks up writes from other
 * tabs (or from the bet slip on the same tab, where a state update in a
 * different component doesn't reach the portfolio automatically).
 */

const KEY = "polystream-closed-positions";
const TTL_MS = 120_000;

type ClosedMap = Record<string, number>; // id → expiresAt (ms since epoch)

function readRaw(): ClosedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ClosedMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeRaw(map: ClosedMap) {
  if (typeof window === "undefined") return;
  try {
    // Drop expired entries opportunistically so the store doesn't grow.
    const now = Date.now();
    for (const [k, v] of Object.entries(map)) {
      if (v <= now) delete map[k];
    }
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {}
}

export function addClosedPosition(id: string) {
  const map = readRaw();
  map[id] = Date.now() + TTL_MS;
  writeRaw(map);
}

export function removeClosedPosition(id: string) {
  const map = readRaw();
  delete map[id];
  writeRaw(map);
}

/** Returns a fresh Set of currently-active closed ids (expired entries filtered). */
export function loadClosedPositions(): Set<string> {
  const now = Date.now();
  const map = readRaw();
  const live = new Set<string>();
  for (const [id, expiresAt] of Object.entries(map)) {
    if (expiresAt > now) live.add(id);
  }
  return live;
}

export const CLOSED_POSITIONS_STORAGE_KEY = KEY;
