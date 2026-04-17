"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { LoginButton } from "@/components/layout/login-modal";
import { cn } from "@/lib/utils";
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
        <p className="text-[#d4a843] font-semibold mb-2">Log in to start earning AIRDROP</p>
        <p className="text-xs text-[#768390] mb-4">Connect a wallet or sign in with Google.</p>
        <div className="inline-block"><LoginButton /></div>
      </div>
    );
  }

  if (meQuery.isLoading || !meQuery.data) {
    return <div className="text-center py-12 text-xs text-[#768390]">Loading your progress…</div>;
  }

  const me = meQuery.data;

  const refetch = () => qc.invalidateQueries({ queryKey: ["airdrop-me", address] });

  return (
    <div className="space-y-6">
      {/* Top banner: lifetime total */}
      <div className="rounded-lg border border-[#d4a843]/30 bg-gradient-to-r from-[#d4a843]/15 via-[#d4a843]/5 to-transparent p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">Your AIRDROP total</p>
          <p className="text-3xl font-bold bg-gradient-to-r from-[#f5c542] to-[#d4a843] bg-clip-text text-transparent tabular-nums">
            {me.totalAirdrop.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">Available to trade</p>
          <p className="text-xl font-semibold text-white tabular-nums">
            {Math.round(me.balance).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Daily claim */}
      <DailyClaimCard claimed={me.dailyClaim.claimed} address={address!} onClaimed={refetch} />

      {/* Weekly goals */}
      <section>
        <h2 className="text-sm font-semibold text-[#f5c542] mb-2">Weekly goals</h2>
        <p className="text-[11px] text-[#768390] mb-3">Resets every Monday at 00:00 UTC. Both goals can be earned again next week.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <WeeklyGoalCard
            title="Watch 5 minutes of news"
            description="Keep the News tab open while you read. Counts while the tab is visible."
            reward={AIRDROP_AMOUNTS.weeklyGoal}
            progress={me.weeklyGoals.newsWatch.progress}
            required={me.weeklyGoals.newsWatch.required}
            formatProgress={(s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} / 5:00`}
            claimed={me.weeklyGoals.newsWatch.claimed}
            goal="news_watch"
            address={address!}
            onClaimed={refetch}
          />
          <WeeklyGoalCard
            title="Make 5 paper trades"
            description="Any paper trade on the Trade tab counts — BTC 5-min rapid trades, AI consensus, or sports."
            reward={AIRDROP_AMOUNTS.weeklyGoal}
            progress={me.weeklyGoals.paperTrades.progress}
            required={me.weeklyGoals.paperTrades.required}
            formatProgress={(n) => `${n} / 5 trades`}
            claimed={me.weeklyGoals.paperTrades.claimed}
            goal="paper_trades"
            address={address!}
            onClaimed={refetch}
          />
        </div>
      </section>

      {/* One-time boosts */}
      <section>
        <h2 className="text-sm font-semibold text-[#f5c542] mb-2">One-time boosts</h2>
        <p className="text-[11px] text-[#768390] mb-3">These fire automatically once you qualify — no claim needed.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoostCard
            title="First real-money deposit"
            description="Bridge any amount of USDC to your Polymarket proxy wallet."
            reward={AIRDROP_AMOUNTS.firstDeposit}
            paid={me.oneTimeBoosts.firstDeposit.paid}
          />
          <BoostCard
            title="First sports bet"
            description="Place your first real-money sports trade via the bet slip."
            reward={AIRDROP_AMOUNTS.firstSportsTrade}
            paid={me.oneTimeBoosts.firstSportsTrade.paid}
          />
        </div>
      </section>

      {/* Referral card — the virality loop */}
      <ReferralCard
        code={me.referralCode}
        count={me.referralCount}
        referredBy={me.referredBy}
        userId={address!}
        onApplied={refetch}
      />
    </div>
  );
}

function DailyClaimCard({ claimed, address, onClaimed }: { claimed: boolean; address: string; onClaimed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/airdrop", {
        method: "POST",
        headers: { Authorization: `Bearer ${address}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: address, type: "daily" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "failed");
      setMsg(`+${AIRDROP_AMOUNTS.daily} AIRDROP claimed!`);
      onClaimed();
    } catch (e: unknown) {
      setMsg((e as Error)?.message || "Claim failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-r from-[#d4a843]/10 to-transparent p-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-sm font-semibold text-white">Daily claim</p>
        <p className="text-xs text-[#adbac7]/80 mt-0.5">Come back every 24 hours for <span className="text-[#f5c542] font-semibold">+{AIRDROP_AMOUNTS.daily} AIRDROP</span>.</p>
        {msg && <p className="text-[11px] text-[#d4a843] mt-1">{msg}</p>}
      </div>
      <button
        onClick={claim}
        disabled={busy || claimed}
        className={cn(
          "px-4 py-2 rounded-md text-sm font-semibold transition-colors",
          claimed
            ? "bg-[#21262d] text-[#484f58] cursor-not-allowed"
            : "bg-gradient-to-r from-[#f5c542] to-[#d4a843] text-[#0d1117] hover:from-[#f8d155] hover:to-[#e0b247] shadow-[0_0_20px_rgba(212,168,67,0.3)]",
        )}
      >
        {busy ? "Claiming…" : claimed ? "Claimed today" : `Claim +${AIRDROP_AMOUNTS.daily}`}
      </button>
    </div>
  );
}

function WeeklyGoalCard({
  title, description, reward, progress, required, formatProgress, claimed, goal, address, onClaimed,
}: {
  title: string;
  description: string;
  reward: number;
  progress: number;
  required: number;
  formatProgress: (p: number) => string;
  claimed: boolean;
  goal: "news_watch" | "paper_trades";
  address: string;
  onClaimed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pct = Math.min(100, (progress / required) * 100);
  const ready = progress >= required && !claimed;

  const claim = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/airdrop/claim-weekly", {
        method: "POST",
        headers: { Authorization: `Bearer ${address}`, "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Claim failed");
      onClaimed();
    } catch (e: unknown) {
      setErr((e as Error)?.message || "Claim failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-[#768390] mt-0.5">{description}</p>
        </div>
        <span className="text-xs text-[#f5c542] font-bold whitespace-nowrap bg-[#f5c542]/10 border border-[#f5c542]/20 px-2 py-0.5 rounded">
          +{reward}
        </span>
      </div>
      <div className="mt-3">
        <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              claimed ? "bg-[#3fb950]" : ready ? "bg-gradient-to-r from-[#f5c542] to-[#d4a843]" : "bg-[#d4a843]/60",
            )}
            style={{ width: claimed ? "100%" : `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-[#768390] tabular-nums">{formatProgress(progress)}</span>
          {claimed ? (
            <span className="text-[11px] font-semibold text-[#3fb950]">Claimed this week</span>
          ) : ready ? (
            <button
              onClick={claim}
              disabled={busy}
              className="text-xs font-semibold bg-gradient-to-r from-[#f5c542] to-[#d4a843] text-[#0d1117] px-3 py-1 rounded hover:from-[#f8d155] hover:to-[#e0b247]"
            >
              {busy ? "Claiming…" : "Claim"}
            </button>
          ) : (
            <span className="text-[10px] text-[#484f58]">In progress</span>
          )}
        </div>
        {err && <p className="text-[10px] text-[#f85149] mt-1">{err}</p>}
      </div>
    </div>
  );
}

function BoostCard({ title, description, reward, paid }: { title: string; description: string; reward: number; paid: boolean }) {
  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4 flex items-start gap-3">
      <div
        className={cn(
          "mt-0.5 h-7 w-7 rounded-full border flex items-center justify-center shrink-0",
          paid ? "border-[#3fb950]/40 bg-[#3fb950]/10" : "border-[#d4a843]/30 bg-[#d4a843]/5",
        )}
      >
        {paid ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <span className="text-[#f5c542] text-xs font-bold">+</span>
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">{title}</p>
          <span className={cn(
            "text-xs font-bold whitespace-nowrap px-2 py-0.5 rounded border",
            paid
              ? "text-[#3fb950] bg-[#3fb950]/10 border-[#3fb950]/20"
              : "text-[#f5c542] bg-[#f5c542]/10 border-[#f5c542]/20",
          )}>
            {paid ? "Claimed" : `+${reward}`}
          </span>
        </div>
        <p className="text-xs text-[#768390] mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ReferralCard({
  code, count, referredBy, userId, onApplied,
}: { code: string; count: number; referredBy: string | null; userId: string; onApplied: () => void }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = (text: string, kind: "code" | "link") => {
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rounded-lg border border-[#d4a843]/30 bg-gradient-to-br from-[#d4a843]/15 via-[#d4a843]/5 to-transparent p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Invite friends — biggest AIRDROP win</p>
          <p className="text-xs text-[#adbac7]/80 mt-1">
            Every friend who signs up and claims their bonus earns you{" "}
            <span className="text-[#f5c542] font-bold">+{AIRDROP_AMOUNTS.referralBonus} AIRDROP</span>.
            Referrals rule the leaderboard.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">Referred so far</p>
          <p className="text-2xl font-bold text-[#f5c542] tabular-nums">{count}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
        <button
          onClick={() => copy(code, "code")}
          className="rounded-md border border-[#d4a843]/30 bg-[#161b22] p-3 text-left hover:border-[#d4a843]/60 transition-colors"
        >
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">Your code</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm font-mono font-semibold text-white">{code}</span>
            <span className="text-[10px] text-[#d4a843]/80">{copied === "code" ? "Copied!" : "Copy"}</span>
          </div>
        </button>
        <button
          onClick={() =>
            copy(typeof window !== "undefined" ? `${window.location.origin}?ref=${code}` : "", "link")
          }
          className="rounded-md border border-[#d4a843]/30 bg-[#161b22] p-3 text-left hover:border-[#d4a843]/60 transition-colors"
        >
          <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">Share link</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-white truncate">polystream.vercel.app/?ref={code}</span>
            <span className="text-[10px] text-[#d4a843]/80 ml-2">{copied === "link" ? "Copied!" : "Copy"}</span>
          </div>
        </button>
      </div>

      {/* Apply someone else's code — one-time */}
      <ReferralCodeInput userId={userId} referredBy={referredBy} onApplied={onApplied} />
    </div>
  );
}

function ReferralCodeInput({ userId, referredBy, onApplied }: { userId: string; referredBy: string | null; onApplied: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (referredBy) {
    return (
      <div className="mt-3 text-[11px] text-[#d4a843]/80">
        Referred by <span className="font-mono text-[#f5c542]">{referredBy}</span>
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
      if (!r.ok) throw new Error(data?.error || "Failed");
      setMsg({ ok: true, text: `Applied! Your friend earns ${AIRDROP_AMOUNTS.referralBonus} when you claim your signup bonus.` });
      onApplied();
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error)?.message || "Failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-[#d4a843]/15">
      <p className="text-[11px] text-[#adbac7]/80 mb-1.5">Have a friend&apos;s code?</p>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="PS-XXXXXXXX"
          className="flex-1 min-w-0 bg-[#0d1117] border border-[#21262d] rounded px-2.5 py-1.5 text-xs text-white font-mono uppercase placeholder:text-[#484f58] focus:outline-none focus:border-[#d4a843]/50"
        />
        <button
          onClick={apply}
          disabled={busy}
          className="text-xs font-semibold bg-[#d4a843]/20 text-[#f5c542] border border-[#d4a843]/30 px-3 py-1.5 rounded hover:bg-[#d4a843]/30"
        >
          {busy ? "…" : "Apply"}
        </button>
      </div>
      {msg && (
        <p className={cn("text-[11px] mt-1.5", msg.ok ? "text-[#3fb950]" : "text-[#f85149]")}>{msg.text}</p>
      )}
    </div>
  );
}
