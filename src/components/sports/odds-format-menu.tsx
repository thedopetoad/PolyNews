"use client";

import { useEffect, useRef, useState } from "react";
import { useOddsFormat } from "@/stores/use-odds-format";
import { ODDS_FORMAT_LABEL, oddsFormatList } from "@/lib/odds-format";
import { cn } from "@/lib/utils";

/**
 * Header-right dropdown mirroring Polymarket's "Odds Format" menu — settings
 * icon opens a list of formats (Price / American / Decimal / …) with the
 * active one dotted blue. Also houses a "Show Spreads + Totals" toggle since
 * that's what Polymarket tucks into the same menu.
 */
export function OddsFormatMenu() {
  const { format, setFormat, showSpreadsTotals, toggleSpreadsTotals } = useOddsFormat();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on escape for keyboard users
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Odds format settings"
        title="Odds format"
        className={cn(
          "w-8 h-8 rounded-lg border flex items-center justify-center transition-colors",
          open
            ? "border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff]"
            : "border-[#30363d] bg-[#161b22] text-[#768390] hover:text-white hover:border-[#484f58]"
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" />
          <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" />
          <line x1="4" y1="18" x2="20" y2="18" /><circle cx="7" cy="18" r="2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 rounded-lg border border-[#30363d] bg-[#161b22] shadow-[0_8px_24px_rgba(0,0,0,0.6)] py-2">
          <p className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-[#484f58] font-semibold">Odds Format</p>
          {oddsFormatList().map((f) => {
            const active = f === format;
            return (
              <button
                key={f}
                onClick={() => { setFormat(f); setOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm flex items-center justify-between transition-colors",
                  active ? "text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"
                )}
              >
                <span>{ODDS_FORMAT_LABEL[f]}</span>
                {active && <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff]" />}
              </button>
            );
          })}
          <div className="my-1.5 border-t border-[#21262d]" />
          <button
            onClick={toggleSpreadsTotals}
            className="w-full text-left px-3 py-1.5 text-sm text-[#c9d1d9] hover:bg-[#21262d] flex items-center justify-between"
          >
            <span>Show Spreads + Totals</span>
            {showSpreadsTotals && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="5 12 10 17 19 8" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
