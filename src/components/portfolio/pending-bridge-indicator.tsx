"use client";

import { useEffect, useState } from "react";
import type { BridgeState } from "@/hooks/use-pending-bridge";

interface Props {
  state: BridgeState;
  onDismiss: () => void;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Finalizing…";
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const m = Math.ceil(seconds / 60);
  return `~${m} min left`;
}

export function PendingBridgeIndicator({ state, onDismiss }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Completed state: green check + "Delivered!" — 2s celebration ─────────
  if (state.kind === "completed") {
    const label =
      state.type === "deposit"
        ? `Deposit received from ${state.chain}`
        : `Delivered to ${state.chain}`;
    return (
      <div className="mt-3 pt-3 border-t border-[#21262d] animate-in fade-in duration-300">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-[#3fb950] font-medium flex items-center gap-1.5">
            <CheckIcon />
            {label}
          </span>
        </div>
        <div className="h-1 bg-[#21262d] rounded-full overflow-hidden relative">
          <div
            className="h-full w-full bg-gradient-to-r from-[#3fb950] to-[#56d364]"
            style={{ boxShadow: "0 0 12px rgba(63, 185, 80, 0.6)" }}
          />
        </div>
      </div>
    );
  }

  // ── Pending state: run the countdown ────────────────────────────────────
  const elapsed = (now - state.startedAt) / 1000;
  const percent = Math.min(100, (elapsed / state.etaSeconds) * 100);
  const remaining = Math.max(0, state.etaSeconds - elapsed);
  const isOvertime = elapsed > state.etaSeconds;

  const label =
    state.type === "deposit"
      ? `Awaiting ${state.chain} deposit`
      : `Bridging to ${state.chain}`;

  return (
    <div className="mt-3 pt-3 border-t border-[#21262d]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-[#768390] flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#58a6ff] opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#58a6ff]" />
          </span>
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] tabular-nums ${
              isOvertime ? "text-[#d29922]" : "text-[#484f58]"
            }`}
          >
            {isOvertime ? "Taking longer than usual…" : formatRemaining(remaining)}
          </span>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-[#484f58] hover:text-[#768390] leading-none text-sm"
          >
            ×
          </button>
        </div>
      </div>
      <div className="h-1 bg-[#21262d] rounded-full overflow-hidden relative">
        <div
          className={`h-full transition-all duration-1000 ease-linear ${
            isOvertime
              ? "bg-gradient-to-r from-[#d29922] to-[#e3b341]"
              : "bg-gradient-to-r from-[#58a6ff] to-[#79c0ff]"
          }`}
          style={{ width: `${percent}%` }}
        />
        {!isOvertime && (
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            style={{ animation: "shimmer 2s linear infinite" }}
          />
        )}
      </div>
      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}

function CheckIcon() {
  return (
    <span
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#3fb950]/20"
      style={{ animation: "popIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 12 12"
        fill="none"
        stroke="#3fb950"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="2 6 5 9 10 3" />
      </svg>
      <style jsx>{`
        @keyframes popIn {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          60% {
            transform: scale(1.15);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </span>
  );
}
