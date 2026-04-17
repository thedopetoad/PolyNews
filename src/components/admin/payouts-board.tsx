"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// Admin Payouts board. Shows every prize_payouts row grouped by week,
// newest first. Each row exposes:
//   - copy proxy address
//   - copy a full per-week manifest (boss can paste into any wallet)
//   - mark as paid (with optional tx hash)
//
// Reads from GET /api/admin/payouts, writes via POST /api/admin/payouts.
// A "Snapshot now" button calls POST /api/admin/snapshot-now to fire
// the cron logic on demand (useful before Monday rolls).

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
  status: "pending" | "paid";
  txHash: string | null;
  paidAt: string | null;
  paidBy: string | null;
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
      if (r.status === "paid") lines.push(`     Status: PAID${r.txHash ? ` (${r.txHash})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function PayoutsBoard() {
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [txInputs, setTxInputs] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      setMsg("Clipboard failed");
    }
  };

  const markPaid = async (id: string) => {
    setMarkingId(id);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "paid", txHash: txInputs[id]?.trim() || null }),
      });
      if (!r.ok) throw new Error("mark-paid failed");
      await refresh();
    } catch {
      setMsg("Mark-paid failed");
    } finally {
      setMarkingId(null);
    }
  };

  const snapshotNow = async () => {
    setSnapshotBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/snapshot-now", { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error("snapshot failed");
      const added = data?.forwarded?.payoutRowsInserted ?? 0;
      setMsg(added > 0 ? `Snapshot added ${added} payout row${added === 1 ? "" : "s"}.` : "Snapshot ran — no new rows (already snapshotted or no winners).");
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
        <div className="space-y-4">
          {byWeek.map(({ weekKey, rows }) => {
            const anyPending = rows.some((r) => r.status === "pending");
            return (
              <div key={weekKey} className="bg-[#0d1117] border border-[#21262d] rounded">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262d]">
                  <div>
                    <p className="text-xs font-semibold text-white">{weekKey}</p>
                    <p className="text-[10px] text-[#768390]">{formatRange(weekKey)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded border",
                      anyPending
                        ? "text-[#d4a843] border-[#d4a843]/30 bg-[#d4a843]/10"
                        : "text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/10",
                    )}>
                      {anyPending ? "Pending" : "All paid"}
                    </span>
                    <button
                      onClick={() => copy(buildManifest(rows, weekKey), `manifest-${weekKey}`)}
                      className="text-[10px] font-semibold bg-[#d4a843]/15 text-[#f5c542] border border-[#d4a843]/30 px-2.5 py-1 rounded hover:bg-[#d4a843]/25"
                    >
                      {copiedKey === `manifest-${weekKey}` ? "Copied manifest!" : "Copy manifest"}
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-[#21262d]">
                  {rows.map((r) => (
                    <div key={r.id} className="px-3 py-2.5 grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-2 text-xs">
                        <div className="text-[#f5c542]">{BOARD_LABEL[r.leaderboard]}</div>
                        <div className="text-[10px] text-[#768390]">{PLACE_GLYPH[r.place]} #{r.place}</div>
                      </div>
                      <div className="col-span-2 text-xs">
                        <div className="text-white truncate">{r.displayName ?? "(no name)"}</div>
                        <div className="text-[10px] text-[#484f58] truncate">{r.eoa.slice(0, 6)}…{r.eoa.slice(-4)}</div>
                      </div>
                      <div className="col-span-4 text-xs min-w-0">
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
                      <div className="col-span-1 text-xs font-semibold text-[#f5c542] tabular-nums">${r.amountUsdc}</div>
                      <div className="col-span-3 text-right">
                        {r.status === "paid" ? (
                          <div className="text-[10px]">
                            <span className="text-[#3fb950] font-semibold">PAID</span>
                            {r.txHash && (
                              <a
                                href={`https://polygonscan.com/tx/${r.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 text-[#58a6ff] hover:underline"
                              >
                                tx
                              </a>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 justify-end">
                            <input
                              value={txInputs[r.id] ?? ""}
                              onChange={(e) => setTxInputs((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder="tx hash (optional)"
                              className="w-32 bg-[#161b22] border border-[#21262d] rounded px-1.5 py-1 text-[10px] text-white placeholder:text-[#484f58]"
                            />
                            <button
                              onClick={() => markPaid(r.id)}
                              disabled={markingId === r.id}
                              className="text-[10px] font-semibold bg-[#3fb950]/15 text-[#3fb950] border border-[#3fb950]/30 px-2 py-1 rounded hover:bg-[#3fb950]/25 disabled:opacity-50"
                            >
                              {markingId === r.id ? "…" : "Mark paid"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
