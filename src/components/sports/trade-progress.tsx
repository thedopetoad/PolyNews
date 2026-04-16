"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { polygon } from "wagmi/chains";

/**
 * Onchain settlement progress bar for a Polymarket trade.
 *
 * The CLOB matches the order server-side (nearly instant) and returns one or
 * more Polygon tx hashes. The matched funds / shares aren't actually in the
 * user's proxy wallet until those txns confirm on chain (~2-10s on Polygon).
 *
 * Rather than polling Polymarket's trade status API (which needs user-scoped
 * CLOB auth + HTTP requests), we just use our public Polygon RPC to wait on
 * the receipt — cheaper and more accurate since it tells us when the USDC /
 * token movement is actually final.
 *
 * Handles multi-tx orders (rare — happens on large fills that hit multiple
 * maker orders): shows aggregate progress, links to the first tx, says
 * "+N more" if there are additional hashes.
 */
export function TradeProgress({
  txHashes,
  label,
  onConfirmed,
}: {
  txHashes: string[];
  /** Short summary shown next to the bar, e.g. "Settling your buy…" */
  label: string;
  /** Fires once all txns are confirmed. Lets the parent refresh positions/balances. */
  onConfirmed?: () => void;
}) {
  const publicClient = usePublicClient({ chainId: polygon.id });
  const [confirmedCount, setConfirmedCount] = useState(0);
  // "reverted" = receipt came back with status !== "success" (real failure).
  // "slow"     = timed out waiting or RPC error; the tx may still settle,
  //              we just lost visibility. Don't scare the user in this case.
  const [state, setState] = useState<"pending" | "slow" | "reverted">("pending");
  const [elapsed, setElapsed] = useState(0);

  const total = txHashes.length;
  const done = total > 0 && confirmedCount === total;

  // Tick elapsed seconds for the visible "Xs" counter until confirmed or failed.
  useEffect(() => {
    if (done || state === "reverted") return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(t);
  }, [done, state]);

  // Wait for each tx receipt. Runs once per mount — txHashes comes from the
  // trade response and doesn't change.
  useEffect(() => {
    if (!publicClient || txHashes.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const hash of txHashes) {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: hash as `0x${string}`,
            timeout: 90_000, // a little slack for slow Polygon blocks
          });
          if (cancelled) return;
          if (receipt.status !== "success") {
            // Real revert — the chain says it failed.
            setState("reverted");
            return;
          }
          setConfirmedCount((c) => c + 1);
        } catch {
          if (cancelled) return;
          // Timeout or RPC error. The tx is probably still settling; we just
          // can't see it from here. Surface a soft "taking longer" state and
          // still fire onConfirmed so the portfolio refetches — the real
          // state shows up as soon as /positions or the data-api catches up.
          setState("slow");
          onConfirmed?.();
          return;
        }
      }
      if (!cancelled) onConfirmed?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient]);

  if (txHashes.length === 0) return null;

  const firstHash = txHashes[0];
  const reverted = state === "reverted";
  const slow = state === "slow";
  // Progress: part of the bar represents confirmed txns (hard), the rest is
  // a "walking" indeterminate fill based on elapsed time (capped at ~80% of
  // the remainder, so it never hits 100% before a real confirmation).
  const confirmedPct = (confirmedCount / total) * 100;
  // Indeterminate progress cap grows with elapsed time: ~70% of remaining
  // at 8s, asymptotic after that. Feels like it's working without lying.
  const walk = Math.min(0.8, 1 - 1 / (1 + elapsed / 4));
  const remainingPct = ((total - confirmedCount) / total) * 100;
  const displayPct = done ? 100 : reverted ? 100 : slow ? 95 : Math.min(99, confirmedPct + remainingPct * walk);

  // Color scheme: green = settled, red = reverted (hard fail),
  // amber = slow (don't know yet — but likely fine), blue = in-flight.
  const tone = reverted
    ? { wrap: "bg-[#f85149]/10 border-[#f85149]/30 text-[#f85149]", bar: "bg-[#f85149]" }
    : done
      ? { wrap: "bg-[#3fb950]/10 border-[#3fb950]/30 text-[#3fb950]", bar: "bg-[#3fb950]" }
      : slow
        ? { wrap: "bg-[#d29922]/10 border-[#d29922]/30 text-[#d29922]", bar: "bg-[#d29922]" }
        : { wrap: "bg-[#58a6ff]/10 border-[#58a6ff]/30 text-[#58a6ff]", bar: "bg-[#58a6ff]" };

  return (
    <div className={`rounded-lg px-3 py-2.5 text-xs border ${tone.wrap}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-medium">
          {reverted
            ? "Settlement reverted onchain"
            : done
              ? "Settled onchain ✓"
              : slow
                ? "Taking longer than expected — check Polygonscan"
                : `${label} ${elapsed}s`}
        </span>
        <a
          href={`https://polygonscan.com/tx/${firstHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] underline decoration-dotted underline-offset-2 hover:no-underline whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          View tx{total > 1 ? ` (+${total - 1} more)` : ""} ↗
        </a>
      </div>
      <div className="h-1 w-full rounded-full overflow-hidden bg-black/30">
        <div
          className={`h-full transition-[width] duration-300 ease-out ${tone.bar}`}
          style={{ width: `${displayPct}%` }}
        />
      </div>
    </div>
  );
}
