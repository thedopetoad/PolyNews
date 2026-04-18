"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// Admin Payouts board. Shows every prize_payouts row grouped by week,
// newest first. Per user direction:
//   - Mark-paid flow removed (admin tracks sends outside the system).
//   - Each week starts COLLAPSED — click the header to expand.
//   - Latest week auto-expands on first load so the current payout is
//     visible without a click.
//   - "Copy manifest" sits on the collapsed card too, so you can grab
//     the manifest for any past week without expanding.
//
// Reads from GET /api/admin/payouts. Manually triggers a new snapshot
// via POST /api/admin/snapshot-now (gated by Phantom admin cookie).

type Payout = {
  id: string;
  weekKey: string;
  leaderboard: "weeklyRef" | "weeklyGain";
  place: number;
  userId: string;
  displayName: string | null;
  eoa: string;
  proxyAddress: string;
  amountUsdc: number;
  createdAt: string;
};

const BOARD_LABEL: Record<Payout["leaderboard"], string> = {
  weeklyRef: "Weekly Referrals",
  weeklyGain: "Biggest Gainers",
};
const PLACE_GLYPH: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function formatRange(weekKey: string): string {
  const [y, m, d] = weekKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * 86400 * 1000);
  const fmt = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function buildManifest(rows: Payout[], weekKey: string): string {
  const byBoard: Record<string, Payout[]> = {};
  for (const r of rows) {
    const k = r.leaderboard;
    if (!byBoard[k]) byBoard[k] = [];
    byBoard[k].push(r);
  }
  const lines = [`Weekly Payouts — ${weekKey} (${formatRange(weekKey)})`, ""];
  for (const board of ["weeklyRef", "weeklyGain"] as const) {
    const boardRows = byBoard[board];
    if (!boardRows || boardRows.length === 0) continue;
    lines.push(`${BOARD_LABEL[board]}`);
    boardRows.sort((a, b) => a.place - b.place);
    for (const r of boardRows) {
      lines.push(`  ${PLACE_GLYPH[r.place] ?? `#${r.place}`} ${r.displayName ?? r.eoa.slice(0, 10) + "…"}`);
      lines.push(`     Proxy:  ${r.proxyAddress}`);
      lines.push(`     Amount: ${r.amountUsdc} USDC.e`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function PayoutsBoard() {
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [didInitialExpand, setDidInitialExpand] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/payouts", { credentials: "include", cache: "no-store" });
      if (!r.ok) throw new Error("fetch failed");
      const data = await r.json();
      setPayouts(data.payouts ?? []);
    } catch {
      setMsg("Couldn't load payouts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const byWeek = useMemo(() => {
    if (!payouts) return [] as { weekKey: string; rows: Payout[] }[];
    const m = new Map<string, Payout[]>();
    for (const p of payouts) {
      if (!m.has(p.weekKey)) m.set(p.weekKey, []);
      m.get(p.weekKey)!.push(p);
    }
    return Array.from(m.entries())
      .map(([weekKey, rows]) => ({ weekKey, rows }))
      .sort((a, b) => (a.weekKey < b.weekKey ? 1 : -1));
  }, [payouts]);

  // Auto-expand the most recent week once data arrives. Only runs the
  // first time — if admin collapses that week we respect their choice.
  useEffect(() => {
    if (didInitialExpand || byWeek.length === 0) return;
    setExpandedWeeks(new Set([byWeek[0].weekKey]));
    setDidInitialExpand(true);
  }, [byWeek, didInitialExpand]);

  const toggleWeek = (weekKey: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      setMsg("Clipboard failed");
    }
  };

  const snapshotNow = async () => {
    setSnapshotBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/snapshot-now", { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error("snapshot failed");
      const added: number = data?.payoutRowsInserted ?? 0;
      const replaced: number = data?.rowsReplaced ?? 0;
      if (added === 0) {
        setMsg("Snapshot ran — no winners with amounts set. (Set prize amounts in the Prize editor first.)");
      } else if (replaced > 0) {
        setMsg(`Refreshed week with ${added} current winner${added === 1 ? "" : "s"} (replaced ${replaced} old row${replaced === 1 ? "" : "s"}).`);
      } else {
        setMsg(`Snapshot created ${added} payout row${added === 1 ? "" : "s"}.`);
      }
      await refresh();
    } catch {
      setMsg("Snapshot failed");
    } finally {
      setSnapshotBusy(false);
    }
  };

  return (
    <div className="bg-[#161b22] border border-[#d4a843]/30 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-[#f5c542]">💰</span>
            Leaderboard Payouts
          </h2>
          <p className="text-[10px] text-[#768390] mt-0.5">
            Cron snapshots every Mon 17:00 UTC (= 9am PST). Amounts come from the Prize editor above.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-[11px] text-[#d4a843]">{msg}</span>}
          <button
            onClick={snapshotNow}
            disabled={snapshotBusy}
            className="text-xs font-semibold bg-[#d4a843]/15 text-[#f5c542] border border-[#d4a843]/30 px-3 py-1.5 rounded hover:bg-[#d4a843]/25 disabled:opacity-50"
          >
            {snapshotBusy ? "Running…" : "Snapshot now"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-[#768390] text-center py-6">Loading…</p>
      ) : !payouts || payouts.length === 0 ? (
        <p className="text-xs text-[#768390] text-center py-6">
          No payouts yet. Click &ldquo;Snapshot now&rdquo; to generate one from current standings, or wait for Monday.
        </p>
      ) : (
        <div className="space-y-2">
          {byWeek.map(({ weekKey, rows }) => {
            const isExpanded = expandedWeeks.has(weekKey);
            return (
              <div key={weekKey} className="bg-[#0d1117] border border-[#21262d] rounded overflow-hidden">
                {/* Collapsible header — clicking anywhere toggles except the
                    action buttons (which stopPropagation). */}
                <button
                  type="button"
                  onClick={() => toggleWeek(weekKey)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#1c2128]/60 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg
                      className={cn("w-3 h-3 text-[#484f58] transition-transform shrink-0", isExpanded && "rotate-90")}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="text-left min-w-0">
                      <p className="text-xs font-semibold text-white">{weekKey}</p>
                      <p className="text-[10px] text-[#768390]">{formatRange(weekKey)} · {rows.length} winner{rows.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <div
                    onClick={(e) => { e.stopPropagation(); copy(buildManifest(rows, weekKey), `manifest-${weekKey}`); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        copy(buildManifest(rows, weekKey), `manifest-${weekKey}`);
                      }
                    }}
                    className="text-[10px] font-semibold bg-[#d4a843]/15 text-[#f5c542] border border-[#d4a843]/30 px-2.5 py-1 rounded hover:bg-[#d4a843]/25 shrink-0"
                  >
                    {copiedKey === `manifest-${weekKey}` ? "Copied manifest!" : "Copy manifest"}
                  </div>
                </button>

                {/* Expanded body */}
                {isExpanded && (
                  <div className="divide-y divide-[#21262d] border-t border-[#21262d]">
                    {rows.map((r) => (
                      <div key={r.id} className="px-3 py-2.5 grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-3 text-xs">
                          <div className="text-[#f5c542]">{BOARD_LABEL[r.leaderboard]}</div>
                          <div className="text-[10px] text-[#768390]">{PLACE_GLYPH[r.place]} #{r.place}</div>
                        </div>
                        <div className="col-span-2 text-xs">
                          <div className="text-white truncate">{r.displayName ?? "(no name)"}</div>
                          <div className="text-[10px] text-[#484f58] truncate">{r.eoa.slice(0, 6)}…{r.eoa.slice(-4)}</div>
                        </div>
                        <div className="col-span-5 text-xs min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-[10px] text-[#adbac7] bg-[#161b22] px-1.5 py-0.5 rounded truncate block flex-1 min-w-0">{r.proxyAddress}</code>
                            <button
                              onClick={() => copy(r.proxyAddress, `proxy-${r.id}`)}
                              className="text-[10px] bg-[#21262d] text-[#adbac7] hover:text-white px-2 py-1 rounded shrink-0"
                            >
                              {copiedKey === `proxy-${r.id}` ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                        <div className="col-span-2 text-right">
                          <span className="text-xs font-semibold text-[#f5c542] tabular-nums">${r.amountUsdc}</span>
                          <span className="text-[10px] text-[#484f58] ml-1">USDC.e</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
