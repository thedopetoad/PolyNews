"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { LoginButton } from "@/components/layout/login-modal";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { AIRDROP_AMOUNTS } from "@/lib/constants";

type MePayload = {
  totalAirdrop: number;
  balance: number;
  referralCode: string;
  referralCount: number;
  referredBy: string | null;
  dailyClaim: { claimed: boolean };
  weeklyGoals: {
    newsWatch: { progress: number; required: number; claimed: boolean };
    paperTrades: { progress: number; required: number; claimed: boolean };
  };
  oneTimeBoosts: {
    firstDeposit: { paid: boolean };
    firstSportsTrade: { paid: boolean };
  };
};

export function AirdropEarnTab() {
  const { address, isConnected } = useUser();
  const qc = useQueryClient();
  const { t } = useT();

  const meQuery = useQuery<MePayload>({
    queryKey: ["airdrop-me", address],
    queryFn: async () => {
      if (!address) throw new Error("no address");
      const r = await fetch("/api/airdrop/me", {
        headers: { Authorization: `Bearer ${address}` },
        cache: "no-store",
      });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    enabled: !!address,
    refetchInterval: 30_000,
  });

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/5 via-[#161b22] to-[#161b22] p-10 text-center">
        <p className="text-[#d4a843] font-semibold mb-2">{t.airdrop.earn.loggedOutTitle}</p>
        <p className="text-xs text-[#768390] mb-4">{t.airdrop.earn.loggedOutHint}</p>
        <div className="inline-block"><LoginButton /></div>
      </div>
    );
  }

  if (meQuery.isLoading || !meQuery.data) {
    return <div className="text-center py-12 text-xs text-[#768390]">{t.airdrop.earn.loading}</div>;
  }

  const me = meQuery.data;
  const refetch = () => qc.invalidateQueries({ queryKey: ["airdrop-me", address] });

  return (
    <div className="space-y-6">
      {/* Referral card first — the virality lever */}
      <ReferralCard
        code={me.referralCode}
        count={me.referralCount}
        referredBy={me.referredBy}
        userId={address!}
        onApplied={refetch}
      />

      {/* Unified "Earn more" wheels — daily, weekly goals, one-time boosts
          in one grid. Each tile has a circular progress ring so users can
          see at a glance what's done and what's in flight. */}
      <section>
        <h2 className="text-sm font-semibold text-[#f5c542] mb-2">{t.airdrop.earn.sectionTitle}</h2>
        <p className="text-[11px] text-[#768390] mb-3">{t.airdrop.earn.sectionSubtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <EarnTile
            title={t.airdrop.earn.dailyTitle}
            reward={AIRDROP_AMOUNTS.daily}
            description={t.airdrop.earn.dailyDesc}
            progress={me.dailyClaim.claimed ? 1 : 0}
            progressLabel={me.dailyClaim.claimed ? t.airdrop.earn.dailyClaimedToday : t.airdrop.earn.readyToClaim}
            action={
              <ClaimButton
                kind="daily"
                ready={!me.dailyClaim.claimed}
                claimed={me.dailyClaim.claimed}
                address={address!}
                onClaimed={refetch}
              />
            }
            status={me.dailyClaim.claimed ? "done" : "open"}
            resetsLabel={t.airdrop.earn.resetsAtDaily}
          />
          <EarnTile
            title={t.airdrop.earn.newsTitle}
            reward={AIRDROP_AMOUNTS.weeklyGoal}
            description={t.airdrop.earn.newsDesc}
            progress={me.weeklyGoals.newsWatch.progress / me.weeklyGoals.newsWatch.required}
            progressLabel={`${Math.floor(me.weeklyGoals.newsWatch.progress / 60)}:${String(me.weeklyGoals.newsWatch.progress % 60).padStart(2, "0")} / 5:00`}
            action={
              <ClaimButton
                kind="news_watch"
                ready={me.weeklyGoals.newsWatch.progress >= me.weeklyGoals.newsWatch.required && !me.weeklyGoals.newsWatch.claimed}
                claimed={me.weeklyGoals.newsWatch.claimed}
                address={address!}
                onClaimed={refetch}
              />
            }
            status={me.weeklyGoals.newsWatch.claimed ? "done" : "open"}
            resetsLabel={t.airdrop.earn.resetsWeekly}
          />
          <EarnTile
            title={t.airdrop.earn.tradesTitle}
            reward={AIRDROP_AMOUNTS.weeklyGoal}
            description={t.airdrop.earn.tradesDesc}
            progress={me.weeklyGoals.paperTrades.progress / me.weeklyGoals.paperTrades.required}
            progressLabel={`${me.weeklyGoals.paperTrades.progress} / 5 ${t.airdrop.earn.tradesProgress}`}
            action={
              <ClaimButton
                kind="paper_trades"
                ready={me.weeklyGoals.paperTrades.progress >= me.weeklyGoals.paperTrades.required && !me.weeklyGoals.paperTrades.claimed}
                claimed={me.weeklyGoals.paperTrades.claimed}
                address={address!}
                onClaimed={refetch}
              />
            }
            status={me.weeklyGoals.paperTrades.claimed ? "done" : "open"}
            resetsLabel={t.airdrop.earn.resetsWeekly}
          />
          <EarnTile
            title={t.airdrop.earn.firstDepositTitle}
            reward={AIRDROP_AMOUNTS.firstDeposit}
            description={t.airdrop.earn.firstDepositDesc}
            progress={me.oneTimeBoosts.firstDeposit.paid ? 1 : 0}
            progressLabel={me.oneTimeBoosts.firstDeposit.paid ? t.airdrop.earn.claimedLabel : "0 / 1"}
            status={me.oneTimeBoosts.firstDeposit.paid ? "done" : "open"}
            resetsLabel={t.airdrop.earn.oneTime}
          />
          <EarnTile
            title={t.airdrop.earn.firstSportsTitle}
            reward={AIRDROP_AMOUNTS.firstSportsTrade}
            description={t.airdrop.earn.firstSportsDesc}
            progress={me.oneTimeBoosts.firstSportsTrade.paid ? 1 : 0}
            progressLabel={me.oneTimeBoosts.firstSportsTrade.paid ? t.airdrop.earn.claimedLabel : "0 / 1"}
            status={me.oneTimeBoosts.firstSportsTrade.paid ? "done" : "open"}
            resetsLabel={t.airdrop.earn.oneTime}
          />
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tile: circular progress ring + reward pill + per-tile action.
// status: "done" (green ring, muted), "open" (gold ring, active).
// progress ∈ [0..1].
// ─────────────────────────────────────────────────────────────
function EarnTile({
  title,
  reward,
  description,
  progress,
  progressLabel,
  action,
  status,
  resetsLabel,
}: {
  title: string;
  reward: number;
  description: string;
  progress: number;
  progressLabel: string;
  action?: React.ReactNode;
  status: "done" | "open";
  resetsLabel: string;
}) {
  const pct = Math.max(0, Math.min(1, progress));
  const pctInt = Math.round(pct * 100);

  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex flex-col gap-3 transition-colors",
        status === "done"
          ? "border-[#3fb950]/25 bg-gradient-to-b from-[#3fb950]/5 via-[#161b22] to-[#161b22]"
          : "border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/5 via-[#161b22] to-[#161b22]",
      )}
    >
      <div className="flex items-start gap-3">
        <ProgressWheel pct={pct} status={status} label={pctInt === 100 ? "✓" : `${pctInt}%`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-white leading-tight">{title}</p>
            <span
              className={cn(
                "text-[11px] font-bold whitespace-nowrap px-2 py-0.5 rounded border",
                status === "done"
                  ? "text-[#3fb950] bg-[#3fb950]/10 border-[#3fb950]/20"
                  : "text-[#f5c542] bg-[#f5c542]/10 border-[#f5c542]/20",
              )}
            >
              +{reward}
            </span>
          </div>
          <p className="text-xs text-[#768390] mt-0.5 line-clamp-2">{description}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] tabular-nums">
        <span className="text-[#adbac7]">{progressLabel}</span>
        <span className="text-[#484f58]">{resetsLabel}</span>
      </div>

      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// SVG circular progress ring with animated stroke.
function ProgressWheel({ pct, status, label }: { pct: number; status: "done" | "open"; label: string }) {
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const color = status === "done" ? "#3fb950" : "#f5c542";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#21262d"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease-out" }}
        />
      </svg>
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums",
          status === "done" ? "text-[#3fb950]" : "text-[#f5c542]",
        )}
      >
        {label}
      </div>
    </div>
  );
}

// Unified claim button for daily + weekly. Locked for one-time boosts
// (server fires those automatically on qualifying actions).
function ClaimButton({
  kind,
  ready,
  claimed,
  address,
  onClaimed,
}: {
  kind: "daily" | "news_watch" | "paper_trades";
  ready: boolean;
  claimed: boolean;
  address: string;
  onClaimed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { t: tt } = useT();

  const claim = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (kind === "daily") {
        const r = await fetch("/api/airdrop", {
          method: "POST",
          headers: { Authorization: `Bearer ${address}`, "Content-Type": "application/json" },
          body: JSON.stringify({ userId: address, type: "daily" }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || "Claim failed");
      } else {
        const r = await fetch("/api/airdrop/claim-weekly", {
          method: "POST",
          headers: { Authorization: `Bearer ${address}`, "Content-Type": "application/json" },
          body: JSON.stringify({ goal: kind }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || "Claim failed");
      }
      onClaimed();
    } catch (e: unknown) {
      setErr((e as Error)?.message || "Claim failed");
    } finally {
      setBusy(false);
    }
  };

  if (claimed) {
    return (
      <div className="text-[11px] font-semibold text-[#3fb950] bg-[#3fb950]/10 border border-[#3fb950]/20 rounded px-2 py-1.5 text-center">
        {tt.airdrop.earn.claimedLabel}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={claim}
        disabled={busy || !ready}
        className={cn(
          "w-full text-xs font-semibold px-3 py-1.5 rounded transition-colors",
          ready && !busy
            ? "bg-gradient-to-r from-[#f5c542] to-[#d4a843] text-[#0d1117] hover:from-[#f8d155] hover:to-[#e0b247] shadow-[0_0_12px_rgba(212,168,67,0.25)]"
            : "bg-[#21262d] text-[#484f58] cursor-not-allowed",
        )}
      >
        {busy ? tt.airdrop.earn.claiming : ready ? tt.airdrop.earn.claimReward : tt.airdrop.earn.inProgress}
      </button>
      {err && <p className="text-[10px] text-[#f85149] mt-1 text-center">{err}</p>}
    </>
  );
}

function ReferralCard({
  code, count, referredBy, userId, onApplied,
}: { code: string; count: number; referredBy: string | null; userId: string; onApplied: () => void }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const { t: tt } = useT();
  const copy = (text: string, kind: "code" | "link") => {
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rounded-lg border border-[#d4a843]/30 bg-gradient-to-br from-[#d4a843]/15 via-[#d4a843]/5 to-transparent p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{tt.airdrop.referralCard.heading}</p>
          <p className="text-xs text-[#adbac7]/80 mt-1">
            {tt.airdrop.referralCard.body}{" "}
            <span className="text-[#f5c542] font-bold">+{AIRDROP_AMOUNTS.referralBonus} {tt.airdrop.referralCard.referralBonusSuffix}</span>{" "}
            {tt.airdrop.referralCard.referralsRule}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">{tt.airdrop.referralCard.referredSoFar}</p>
          <p className="text-2xl font-bold text-[#f5c542] tabular-nums">{count}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
        <button
          onClick={() => copy(code, "code")}
          className="rounded-md border border-[#d4a843]/30 bg-[#161b22] p-3 text-left hover:border-[#d4a843]/60 transition-colors"
        >
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">{tt.airdrop.referralCard.yourCode}</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm font-mono font-semibold text-white">{code}</span>
            <span className="text-[10px] text-[#d4a843]/80">{copied === "code" ? tt.airdrop.referralCard.copied : tt.airdrop.referralCard.copy}</span>
          </div>
        </button>
        <button
          onClick={() =>
            copy(typeof window !== "undefined" ? `${window.location.origin}?ref=${code}` : "", "link")
          }
          className="rounded-md border border-[#d4a843]/30 bg-[#161b22] p-3 text-left hover:border-[#d4a843]/60 transition-colors"
        >
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">{tt.airdrop.referralCard.shareLink}</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-white truncate">polystream.vercel.app/?ref={code}</span>
            <span className="text-[10px] text-[#d4a843]/80 ml-2">{copied === "link" ? tt.airdrop.referralCard.copied : tt.airdrop.referralCard.copy}</span>
          </div>
        </button>
      </div>

      <ReferralCodeInput userId={userId} referredBy={referredBy} onApplied={onApplied} />
    </div>
  );
}

function ReferralCodeInput({ userId, referredBy, onApplied }: { userId: string; referredBy: string | null; onApplied: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { t: tt } = useT();

  if (referredBy) {
    return (
      <div className="mt-3 text-[11px] text-[#d4a843]/80">
        {tt.airdrop.referralCard.referredBy} <span className="font-mono text-[#f5c542]">{referredBy}</span>
      </div>
    );
  }

  const apply = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/airdrop", {
        method: "POST",
        headers: { Authorization: `Bearer ${userId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "apply-referral", referralCode: code.trim().toUpperCase() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || tt.airdrop.referralCard.applyFailed);
      setMsg({ ok: true, text: tt.airdrop.referralCard.applied });
      onApplied();
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error)?.message || tt.airdrop.referralCard.applyFailed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-[#d4a843]/15">
      <p className="text-[11px] text-[#adbac7]/80 mb-1.5">{tt.airdrop.referralCard.haveFriendsCode}</p>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 16))}
          placeholder="PS-XXXXXXXX"
          maxLength={16}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          className="flex-1 min-w-0 bg-[#0d1117] border border-[#21262d] rounded px-2.5 py-1.5 text-xs text-white font-mono uppercase placeholder:text-[#484f58] focus:outline-none focus:border-[#d4a843]/50"
        />
        <button
          onClick={apply}
          disabled={busy}
          className="text-xs font-semibold bg-[#d4a843]/20 text-[#f5c542] border border-[#d4a843]/30 px-3 py-1.5 rounded hover:bg-[#d4a843]/30"
        >
          {busy ? "…" : tt.airdrop.referralCard.apply}
        </button>
      </div>
      {msg && (
        <p className={cn("text-[11px] mt-1.5", msg.ok ? "text-[#3fb950]" : "text-[#f85149]")}>{msg.text}</p>
      )}
    </div>
  );
}
