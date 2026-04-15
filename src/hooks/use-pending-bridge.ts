"use client";

/**
 * Tracks in-flight bridge deposits/withdraws so the portfolio UI can show
 * accurate progress while the user waits. Persisted to localStorage so a
 * refresh doesn't lose the indicator.
 *
 * Two states:
 *   - "watching": we have the source-chain deposit address but haven't yet
 *     seen on-chain activity. Shown as an indeterminate pulse. Promotes
 *     itself to "pending" when a background probe catches activity (or the
 *     user actually sees their balance arrive, whichever comes first).
 *   - "pending": activity detected (or withdraw signed). Countdown runs off
 *     the real block timestamp when available.
 *
 * Deposits flow:      close modal → watching → (probe detects tx) → pending → (balance arrives) → dismissed
 * Withdraws flow:     relay signs → pending → (ETA elapses) → dismissed (or × button)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { checkChainActivity, isWatchableChain } from "@/lib/bridge-watch";

export type PendingBridgeKind = "deposit" | "withdraw";

export interface WatchingBridge {
  kind: "watching";
  type: PendingBridgeKind;
  chain: string; // human name — "Ethereum" / "Solana" / ...
  chainId: string; // bridge's chainId — "1" / "1151111081099710" / ...
  address: string; // source-chain deposit address we're watching
  startedAt: number; // epoch ms (modal close time)
}

export interface PendingBridge {
  kind: "pending";
  type: PendingBridgeKind;
  chain: string;
  etaSeconds: number;
  startedAt: number; // epoch ms — block timestamp if detected, else now()
}

export type BridgeState = WatchingBridge | PendingBridge;

const STORAGE_KEY = "polystream.pendingBridge";

// Generous ETAs covering confirmations + bridge sweep + destination delivery.
// What we DISPLAY — users prefer conservative estimates.
const CHAIN_ETAS: Record<string, number> = {
  Polygon: 30,
  Solana: 120,
  Base: 120,
  Ethereum: 480,
  Arbitrum: 120,
  Optimism: 120,
  "BNB Smart Chain": 180,
  Tron: 300,
  Bitcoin: 1800,
  Monad: 180,
  HyperEVM: 180,
  Abstract: 180,
  Ethereal: 180,
};

export function etaForChain(chain: string): number {
  return CHAIN_ETAS[chain] ?? 180;
}

function readStored(): BridgeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BridgeState;
    if (!parsed.kind || !parsed.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(s: BridgeState | null) {
  if (typeof window === "undefined") return;
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// How often to probe the source chain while in "watching" state.
const POLL_INTERVAL_MS = 15_000;
// Give up watching after this long — we were probably wrong that they sent.
const MAX_WATCH_MS = 30 * 60 * 1000;

export function usePendingBridge() {
  const [state, setState] = useState<BridgeState | null>(readStored);
  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback((next: BridgeState | null) => {
    setState(next);
    writeStored(next);
  }, []);

  /**
   * Start watching a source-chain deposit address. If the chain isn't one
   * we know how to probe, skip straight to "pending" with the close-time
   * start (legacy behavior — still useful for unsupported chains).
   */
  const startWatching = useCallback(
    (chain: string, chainId: string, address: string) => {
      if (!isWatchableChain(chainId)) {
        update({
          kind: "pending",
          type: "deposit",
          chain,
          etaSeconds: etaForChain(chain),
          startedAt: Date.now(),
        });
        return;
      }
      update({
        kind: "watching",
        type: "deposit",
        chain,
        chainId,
        address,
        startedAt: Date.now(),
      });
    },
    [update],
  );

  /**
   * Start a pending indicator directly — used for withdraws (we know the
   * exact signing time from the relay callback).
   */
  const startPending = useCallback(
    (type: PendingBridgeKind, chain: string) => {
      update({
        kind: "pending",
        type,
        chain,
        etaSeconds: etaForChain(chain),
        startedAt: Date.now(),
      });
    },
    [update],
  );

  const dismiss = useCallback(() => update(null), [update]);

  /**
   * Background probe while in "watching" state. Promotes to "pending" when
   * on-chain activity is found, anchored to the real block timestamp.
   */
  useEffect(() => {
    if (state?.kind !== "watching") return;

    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      // Snapshot before the async call in case state changes under us.
      const current = stateRef.current;
      if (current?.kind !== "watching") return;

      // Stop if we've been watching too long.
      if (Date.now() - current.startedAt > MAX_WATCH_MS) {
        update(null);
        return;
      }

      try {
        const result = await checkChainActivity(current.chainId, current.address);
        if (cancelled) return;
        // Re-check state after async — might have been dismissed.
        if (stateRef.current?.kind !== "watching") return;
        if (result.detected) {
          update({
            kind: "pending",
            type: current.type,
            chain: current.chain,
            etaSeconds: etaForChain(current.chain),
            startedAt: result.txTime ?? Date.now(),
          });
        }
      } catch {
        /* network blips are normal — keep polling */
      }
    };

    probe(); // immediate check so fast deposits are caught promptly
    const timer = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state, update]);

  /**
   * Auto-expire stale pending indicators at 3x the ETA. (Watching has its
   * own MAX_WATCH_MS handled in the probe loop above.)
   */
  useEffect(() => {
    if (state?.kind !== "pending") return;
    const maxAge = state.etaSeconds * 1000 * 3;
    const elapsed = Date.now() - state.startedAt;
    if (elapsed >= maxAge) {
      update(null);
      return;
    }
    const t = setTimeout(() => update(null), maxAge - elapsed);
    return () => clearTimeout(t);
  }, [state, update]);

  return { state, startWatching, startPending, dismiss };
}
