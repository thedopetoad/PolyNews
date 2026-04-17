"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Editor for the 9 leaderboard prize strings. Free-form text
// (so toad can write "$25", "TBD", "0.01 ETH", etc.). Empty string
// on save deletes the row → UI falls back to "TBD" pill.

const PRIZE_BOARDS: { id: "total" | "weeklyRef" | "weeklyGain"; label: string; subtitle: string }[] = [
  { id: "total", label: "All-Time Airdrop", subtitle: "Rewarded at Monday 00:00 UTC roll" },
  { id: "weeklyRef", label: "Weekly Referrals", subtitle: "Rewarded at Monday 00:00 UTC roll" },
  { id: "weeklyGain", label: "Biggest Gainers", subtitle: "Rewarded at Monday 00:00 UTC roll" },
];

export function PrizeEditor() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/prizes", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.prizes) return;
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.prizes)) {
          flat[k] = (v as string | null) ?? "";
        }
        setValues(flat);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/prizes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Save failed");
      setMsg(`Saved — ${data.updated} fields updated. Cache flushes in ~60s.`);
    } catch (e: unknown) {
      setMsg((e as Error)?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#161b22] border border-[#d4a843]/30 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="text-[#f5c542]">★</span>
          Leaderboard Prizes
        </h2>
        <div className="flex items-center gap-3">
          {msg && <span className={cn("text-[11px]", msg.startsWith("Saved") ? "text-[#3fb950]" : "text-[#f85149]")}>{msg}</span>}
          <button
            onClick={save}
            disabled={saving || loading}
            className="text-xs font-semibold bg-gradient-to-r from-[#f5c542] to-[#d4a843] text-[#0d1117] px-3 py-1.5 rounded hover:from-[#f8d155] hover:to-[#e0b247] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-[#768390] text-center py-4">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRIZE_BOARDS.map((b) => (
            <div key={b.id} className="bg-[#0d1117] border border-[#21262d] rounded p-3">
              <p className="text-xs font-semibold text-[#f5c542]">{b.label}</p>
              <p className="text-[10px] text-[#768390] mb-2">{b.subtitle}</p>
              {[1, 2, 3].map((place) => {
                const key = `airdrop_prize_${b.id}_${place}`;
                const glyph = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
                return (
                  <div key={place} className="flex items-center gap-2 mt-1.5">
                    <span className="w-6 text-sm">{glyph}</span>
                    <input
                      value={values[key] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder="TBD"
                      className="flex-1 bg-[#161b22] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder:text-[#484f58] focus:outline-none focus:border-[#d4a843]/50"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-[#484f58] mt-2">
        Free text — write anything like &ldquo;$25&rdquo; or &ldquo;0.01 ETH&rdquo;. Empty a field to reset it to &ldquo;TBD&rdquo;.
      </p>
    </div>
  );
}
