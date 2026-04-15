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
import { checkChainActivity, getUsdcBalance, isWatchableChain } from "@/lib/bridge-watch";

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
  // ── Optional destination-chain watcher (used for withdraws). We can't
  // observe the cross-chain delivery from Polygon's USDC.e balance — it went
  // DOWN. Instead, poll the USDC balance at the recipient's address on the
  // destination chain and auto-dismiss when it rises above baseline.
  watchChainId?: string; // chainId of destination
  watchAddress?: string; // recipient address on destination
  baselineUsdc?: string; // USDC balance at watchAddress when withdraw started (bigint as string)
}

/** Shown briefly after arrival detected — green check + "Delivered!" before dismiss. */
export interface CompletedBridge {
  kind: "completed";
  type: PendingBridgeKind;
  chain: string;
}

export type BridgeState = WatchingBridge | PendingBridge | CompletedBridge;

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
    if (!parsed.kind || !parsed.type) return null;
    // Only watching/pending have startedAt — completed doesn't persist
    // meaningfully across reload (it's a 2s flash) so treat it as stale.
    if (parsed.kind === "completed") return null;
    if (!parsed.startedAt) return null;
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
   * exact signing time from the relay callback). Optionally pass destination
   * chain + recipient address so we can poll for arrival and auto-dismiss.
   */
  const startPending = useCallback(
    (
      type: PendingBridgeKind,
      chain: string,
      watch?: { chainId: string; address: string },
    ) => {
      const base: PendingBridge = {
        kind: "pending",
        type,
        chain,
        etaSeconds: etaForChain(chain),
        startedAt: Date.now(),
      };
      if (!watch || !isWatchableChain(watch.chainId)) {
        update(base);
        return;
      }
      // Always commit the pending state with watch fields so the probe loop
      // can start polling immediately. baselineUsdc is backfilled on the
      // first successful probe if the initial snapshot fails (rate limits).
      update({
        ...base,
        watchChainId: watch.chainId,
        watchAddress: watch.address,
      });
      getUsdcBalance(watch.chainId, watch.address)
        .then((bal) => {
          if (bal === null) return;
          // Only patch baseline onto the current state if it's still the
          // pending state we just created (user hasn't dismissed, etc.).
          const curr = stateRef.current;
          if (
            curr?.kind === "pending" &&
            curr.watchChainId === watch.chainId &&
            curr.watchAddress === watch.address &&
            curr.baselineUsdc === undefined
          ) {
            update({ ...curr, baselineUsdc: bal.toString() });
          }
        })
        .catch(() => {
          /* probe loop will retry */
        });
    },
    [update],
  );

  const dismiss = useCallback(() => update(null), [update]);

  /**
   * Celebrate a successful arrival — show a "Delivered!" card for 2s before
   * dismissing. Works for both deposit (balance-on-Polygon rose) and
   * withdraw (balance-at-destination rose) paths.
   */
  const complete = useCallback(
    (type: PendingBridgeKind, chain: string) => {
      update({ kind: "completed", type, chain });
    },
    [update],
  );

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

  /**
   * Destination-chain watcher for pending withdraws — polls the recipient's
   * USDC balance and transitions to "completed" when it rises above the
   * snapshot taken when the withdraw started. This is how we know
   * cross-chain delivery landed, since the Polygon balance went DOWN and
   * tells us nothing.
   *
   * Robustness: if the initial baseline fetch failed, the first successful
   * probe sets the baseline retroactively. Works unless the arrival happened
   * during that window — rare since withdraws take 1-2min and we poll every
   * 15s. After the ETA window we stop trying to backfill baseline and rely
   * on the overall 3x-ETA timer to dismiss.
   */
  useEffect(() => {
    if (state?.kind !== "pending") return;
    if (!state.watchChainId || !state.watchAddress) return;

    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      const current = stateRef.current;
      if (current?.kind !== "pending") return;
      if (!current.watchChainId || !current.watchAddress) return;

      try {
        const bal = await getUsdcBalance(current.watchChainId, current.watchAddress);
        if (cancelled || bal === null) return;
        // Re-check after async — might have been dismissed.
        const latest = stateRef.current;
        if (latest?.kind !== "pending") return;

        // Backfill baseline if the initial snapshot fetch failed, but only
        // within the first ETA window — after that, assume arrival might
        // have already happened and don't trust a fresh "baseline".
        if (latest.baselineUsdc === undefined) {
          const withinBackfillWindow =
            Date.now() - latest.startedAt < latest.etaSeconds * 1000;
          if (withinBackfillWindow) {
            update({ ...latest, baselineUsdc: bal.toString() });
          }
          return;
        }

        const baseline = BigInt(latest.baselineUsdc);
        if (bal > baseline) {
          update({ kind: "completed", type: latest.type, chain: latest.chain });
        }
      } catch {
        /* ignore, keep polling */
      }
    };

    probe();
    const timer = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state, update]);

  /**
   * "Completed" state auto-dismisses after 2s so the user sees the
   * satisfying "Delivered!" moment and then the card goes back to its
   * normal look.
   */
  useEffect(() => {
    if (state?.kind !== "completed") return;
    const t = setTimeout(() => update(null), 2000);
    return () => clearTimeout(t);
  }, [state, update]);

  return { state, startWatching, startPending, complete, dismiss };
}
