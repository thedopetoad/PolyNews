"use client";

/**
 * Tracks in-flight bridge deposits/withdraws so the portfolio UI can show
 * progress while the user waits. Persisted to localStorage so a refresh
 * doesn't lose the indicator.
 *
 * Faux system — we don't poll source/destination chains (public RPCs are
 * too rate-limited to rely on). Instead:
 *   - Deposit: bar counts down → Polygon USDC.e balance goes UP → "Delivered!"
 *   - Withdraw: bar counts down → when ETA elapses → "Delivered!" (timer,
 *     no real detection, since we can't cheaply see the destination chain).
 *
 * Both paths end with the same 2-second "Delivered!" celebration.
 */

import { useCallback, useEffect, useState } from "react";

export type PendingBridgeKind = "deposit" | "withdraw";

export interface PendingBridge {
  kind: "pending";
  type: PendingBridgeKind;
  chain: string;
  etaSeconds: number;
  startedAt: number;
}

export interface CompletedBridge {
  kind: "completed";
  type: PendingBridgeKind;
  chain: string;
}

export type BridgeState = PendingBridge | CompletedBridge;

const STORAGE_KEY = "polystream.pendingBridge";

// Conservative ETAs — covers confirmations + bridge sweep + destination
// delivery. Displayed to the user so generous is better than optimistic.
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
    if (!parsed.kind || !parsed.type || !parsed.chain) return null;
    // Completed is a 2s flash — no meaningful persistence across reloads.
    if (parsed.kind === "completed") return null;
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

export function usePendingBridge() {
  const [state, setState] = useState<BridgeState | null>(readStored);

  const update = useCallback((next: BridgeState | null) => {
    setState(next);
    writeStored(next);
  }, []);

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

  const complete = useCallback(
    (type: PendingBridgeKind, chain: string) => {
      update({ kind: "completed", type, chain });
    },
    [update],
  );

  const dismiss = useCallback(() => update(null), [update]);

  /**
   * Pending-state timer:
   *   - Withdraw: auto-transitions to "completed" when the ETA elapses.
   *     This is the faux signal — we can't see the destination chain, so
   *     we assume the bridge delivered by the time our countdown ran out.
   *   - Deposit: dismisses at 3× ETA as a safety net. Primary completion
   *     is via the portfolio page detecting a USDC.e balance bump and
   *     calling complete() directly.
   */
  useEffect(() => {
    if (state?.kind !== "pending") return;
    const elapsed = Date.now() - state.startedAt;

    if (state.type === "withdraw") {
      const target = state.etaSeconds * 1000;
      if (elapsed >= target) {
        update({ kind: "completed", type: state.type, chain: state.chain });
        return;
      }
      const t = setTimeout(
        () => update({ kind: "completed", type: state.type, chain: state.chain }),
        target - elapsed,
      );
      return () => clearTimeout(t);
    }

    // Deposit safety net
    const maxAge = state.etaSeconds * 1000 * 3;
    if (elapsed >= maxAge) {
      update(null);
      return;
    }
    const t = setTimeout(() => update(null), maxAge - elapsed);
    return () => clearTimeout(t);
  }, [state, update]);

  /** Completed state auto-dismisses after 2s so the card goes back to normal. */
  useEffect(() => {
    if (state?.kind !== "completed") return;
    const t = setTimeout(() => update(null), 2000);
    return () => clearTimeout(t);
  }, [state, update]);

  return { state, startPending, complete, dismiss };
}
