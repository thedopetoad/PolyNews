"use client";

/**
 * Tracks an in-flight bridge deposit/withdraw so the portfolio UI can show
 * a countdown while the user waits. Persisted to localStorage so a refresh
 * doesn't lose the indicator.
 *
 * Deposits: started when the user closes the deposit modal (signal that they
 *   likely sent funds). Auto-dismissed when the USDC.e balance increases.
 * Withdraws: started when the withdraw modal reports a successful relay.
 *   For cross-chain we rely on the ETA timer (we can't see destination chain).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PendingBridgeKind = "deposit" | "withdraw";

export interface PendingBridge {
  type: PendingBridgeKind;
  chain: string; // human name, e.g. "Ethereum", "Solana"
  etaSeconds: number;
  startedAt: number; // epoch ms
}

const STORAGE_KEY = "polystream.pendingBridge";

// Generous ETAs covering confirmations + bridge sweep + destination delivery.
// These are what we DISPLAY — users expect conservative estimates.
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

function readStored(): PendingBridge | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingBridge;
    if (!parsed.startedAt || !parsed.chain) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(p: PendingBridge | null) {
  if (typeof window === "undefined") return;
  try {
    if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function usePendingBridge() {
  const [pending, setPending] = useState<PendingBridge | null>(readStored);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const start = useCallback((type: PendingBridgeKind, chain: string) => {
    const p: PendingBridge = {
      type,
      chain,
      etaSeconds: etaForChain(chain),
      startedAt: Date.now(),
    };
    setPending(p);
    writeStored(p);
  }, []);

  const dismiss = useCallback(() => {
    setPending(null);
    writeStored(null);
  }, []);

  // Auto-expire stale trackers after 3x the ETA.
  useEffect(() => {
    if (!pending) return;
    const maxAge = pending.etaSeconds * 1000 * 3;
    const elapsed = Date.now() - pending.startedAt;
    if (elapsed >= maxAge) {
      dismiss();
      return;
    }
    const t = setTimeout(dismiss, maxAge - elapsed);
    return () => clearTimeout(t);
  }, [pending, dismiss]);

  return { pending, start, dismiss };
}
