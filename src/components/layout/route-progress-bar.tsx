"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useIsFetching } from "@tanstack/react-query";

/**
 * Top-of-page progress indicator (NProgress-style). Fires on route change
 * AND whenever react-query has an in-flight request, so pages that hang
 * waiting on CLOB / ESPN data still feel alive while they load.
 *
 * Animation model:
 *   - while "active" (route change in-flight OR queries fetching), the
 *     width eases asymptotically toward 90% so it feels like progress
 *     even when the backend is slow.
 *   - on transition to idle, snap to 100% then fade out 220ms later.
 *
 * Mounted in the root layout so every page gets it for free.
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFetching = useIsFetching();

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const busyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeActiveRef = useRef(false);
  const pathKey = `${pathname}?${searchParams?.toString() ?? ""}`;
  const prevPathRef = useRef(pathKey);

  // Internal: compute "are we busy?" from route-change and query state,
  // and run the animation accordingly. Called from the two edge-triggered
  // effects below.
  const evaluateBusy = (queryCount: number) => {
    const busy = queryCount > 0 || routeActiveRef.current;
    if (busy && !busyRef.current) {
      // Transition idle → busy: start the bar.
      busyRef.current = true;
      setVisible(true);
      setProgress((p) => (p > 15 ? p : 15));
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const tick = () => {
        setProgress((p) => {
          if (p >= 90) return p;
          const inc = Math.max(0.5, (90 - p) * 0.06);
          return Math.min(90, p + inc);
        });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else if (!busy && busyRef.current) {
      // Transition busy → idle: finish the bar.
      busyRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      setProgress(100);
      if (finishTimerRef.current != null) clearTimeout(finishTimerRef.current);
      finishTimerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 220);
    }
  };

  // Route change edge — arm the "route active" flag for 1.2s so navigations
  // that don't kick off a query still show a bar.
  useEffect(() => {
    if (prevPathRef.current === pathKey) return;
    prevPathRef.current = pathKey;
    routeActiveRef.current = true;
    evaluateBusy(isFetching);
    if (routeTimerRef.current != null) clearTimeout(routeTimerRef.current);
    routeTimerRef.current = setTimeout(() => {
      routeActiveRef.current = false;
      evaluateBusy(isFetching);
    }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);

  // Query activity edge.
  useEffect(() => {
    evaluateBusy(isFetching);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetching]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (finishTimerRef.current != null) clearTimeout(finishTimerRef.current);
    if (routeTimerRef.current != null) clearTimeout(routeTimerRef.current);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-[100] h-[2px] pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 220ms ease-out",
      }}
    >
      <div
        className="h-full bg-gradient-to-r from-[#58a6ff] via-[#79c0ff] to-[#58a6ff] shadow-[0_0_8px_rgba(88,166,255,0.7)]"
        style={{
          width: `${progress}%`,
          transition: "width 180ms ease-out",
        }}
      />
    </div>
  );
}
