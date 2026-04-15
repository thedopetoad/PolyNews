"use client";

import { useEffect, useState } from "react";

interface Props {
  type: "deposit" | "withdraw";
  chain: string;
  etaSeconds: number;
  startedAt: number;
  onDismiss: () => void;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Finalizing…";
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const m = Math.ceil(seconds / 60);
  return `~${m} min left`;
}

export function PendingBridgeIndicator({
  type,
  chain,
  etaSeconds,
  startedAt,
  onDismiss,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = (now - startedAt) / 1000;
  const percent = Math.min(100, (elapsed / etaSeconds) * 100);
  const remaining = Math.max(0, etaSeconds - elapsed);
  const isOvertime = elapsed > etaSeconds;

  const label =
    type === "deposit" ? `Awaiting ${chain} deposit` : `Bridging to ${chain}`;

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
        {/* shimmer overlay while under ETA */}
        {!isOvertime && (
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            style={{
              animation: "shimmer 2s linear infinite",
            }}
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
