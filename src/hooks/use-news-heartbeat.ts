"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@/hooks/use-user";

// Ping /api/airdrop/news-heartbeat every 15s while the news tab is
// visible and the user is logged in. Server dedupes by 15s bucket, so
// background tabs or multiple open tabs can't artificially accelerate
// the weekly 5-minute claim. 20 distinct buckets = 5 minutes.
//
// Mount this once on the News page (/). If it's unmounted during a
// short visibility blip we drop the one pending ping — no retries,
// since the next interval tick will fire a new bucket.
export function useNewsHeartbeat(enabled: boolean = true) {
  const { address, isConnected } = useUser();
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !isConnected || !address) return;

    const ping = () => {
      if (document.visibilityState !== "visible") return;
      // Cancel any previous still-flying ping — shouldn't happen,
      // but guard against retries stacking up.
      inFlightRef.current?.abort();
      const ctrl = new AbortController();
      inFlightRef.current = ctrl;
      fetch("/api/airdrop/news-heartbeat", {
        method: "POST",
        headers: { Authorization: `Bearer ${address}`, "Content-Type": "application/json" },
        body: "{}",
        signal: ctrl.signal,
      }).catch(() => { /* non-critical */ });
    };

    // Fire immediately so the first 15s bucket records even if the
    // user bounces before the first interval tick.
    ping();
    const id = setInterval(ping, 15_000);
    return () => {
      clearInterval(id);
      inFlightRef.current?.abort();
    };
  }, [enabled, isConnected, address]);
}
