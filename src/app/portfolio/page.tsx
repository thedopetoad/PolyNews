"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import { useAccount, useBalance } from "wagmi";
import { LoginButton } from "@/components/layout/login-modal";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import { DepositModal } from "@/components/portfolio/deposit-modal";
import { WithdrawModal } from "@/components/portfolio/withdraw-modal";

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const POLYGON_CHAIN_ID = 137;

function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PortfolioPage() {
  const { t } = useT();
  const { address, isConnected, user, positions: paperPositions, trades } = useUser();
  const { chainId } = useAccount();
  const isOnPolygon = chainId === POLYGON_CHAIN_ID;

  const { data: usdcBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: POLYGON_CHAIN_ID,
    query: { enabled: !!address && isOnPolygon },
  });
  const usdcBal = usdcBalance ? parseFloat(usdcBalance.formatted) : 0;

  const paperBalance = user?.balance || 0;
  const paperPositionValue = paperPositions.reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
  const paperTotal = paperBalance + paperPositionValue;

  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // Referral
  const [referralCount, setReferralCount] = useState<number>(0);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [showReferral, setShowReferral] = useState(false);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/user/referrals?userId=${address}`, {
      headers: { Authorization: `Bearer ${address}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setReferralCount(d.count); })
      .catch(() => {});
  }, [address]);

  const handleCopy = (text: string, type: "code" | "link") => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!isConnected) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <h1 className="text-2xl font-bold text-white mb-2">{t.portfolio.title}</h1>
        <p className="text-[#768390] mb-6">{t.portfolio.connectToView}</p>
        <LoginButton />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* ── Top: 2-column hero ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Left — Portfolio + Deposit/Withdraw */}
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#768390] font-medium">{t.portfolio.title}</span>
              <span className="text-[10px] text-[#484f58] font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#484f58] uppercase tracking-wider">{t.portfolio.availableToTrade}</p>
              <p className="text-sm font-semibold text-[#3fb950] tabular-nums">{formatUsd(usdcBal)}</p>
            </div>
          </div>

          <p className="text-4xl font-bold text-white tabular-nums mb-1">{formatUsd(usdcBal + paperTotal)}</p>
          <p className="text-xs text-[#484f58] mb-5">
            {formatUsd(usdcBal)} USDC + {paperTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} AIRDROP
          </p>

          {/* Deposit / Withdraw — Polymarket-style prominent buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setDepositOpen(true)}
              className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold bg-[#2563eb] text-white hover:bg-[#1d4ed8] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              {t.portfolio.deposit}
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold border border-[#30363d] text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              {t.portfolio.withdraw}
            </button>
          </div>
        </div>

        {/* Right — Profit/Loss */}
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#3fb950]" />
              <span className="text-sm text-[#768390] font-medium">{t.portfolio.profitLoss}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-0.5">
                {["1D", "1W", "1M", "ALL"].map((period) => (
                  <button key={period} className={cn(
                    "text-[10px] px-2 py-1 rounded font-medium transition-colors",
                    period === "ALL" ? "bg-[#21262d] text-white" : "text-[#484f58] hover:text-[#768390]"
                  )}>
                    {period}
                  </button>
                ))}
              </div>
              <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-[#484f58] hover:text-[#768390] transition-colors">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z"/></svg>
                Polymarket
              </a>
            </div>
          </div>

          <p className="text-4xl font-bold text-white tabular-nums mb-1">
            {formatUsd(0)}
            <span className="text-sm font-normal text-[#484f58] ml-2">
              <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7v10" /></svg>
            </span>
          </p>
          <p className="text-xs text-[#484f58] mb-4">All-Time</p>

          {/* Mini chart placeholder */}
          <div className="h-20 flex items-end gap-px">
            {Array.from({ length: 40 }, (_, i) => {
              const h = 20 + Math.sin(i * 0.3) * 15 + Math.random() * 10;
              return <div key={i} className="flex-1 rounded-t-sm bg-[#58a6ff]/20 hover:bg-[#58a6ff]/40 transition-colors" style={{ height: `${h}%` }} />;
            })}
          </div>
        </div>
      </div>

      {/* ── Paper Portfolio — compact bar ── */}
      <div className="flex items-center justify-between rounded-lg border border-[#21262d] bg-[#161b22] px-5 py-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">AIRDROP</span>
          <span className="text-sm text-white font-semibold tabular-nums">{paperTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <span className="text-xs text-[#484f58]">{paperBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} {t.portfolio.cash} + {paperPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} {t.portfolio.inPositions}</span>
        </div>
        <Link href="/trade" className="text-xs text-[#58a6ff] hover:underline font-medium">Paper Trade &rarr;</Link>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-0 border-b border-[#21262d] mb-4">
        {(["positions", "history"] as const).map((t2) => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium transition-colors capitalize",
              tab === t2 ? "text-white border-b-2 border-[#58a6ff]" : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            {t2 === "positions" ? t.portfolio.positions : t.portfolio.history}
          </button>
        ))}
      </div>

      {/* ── Positions ── */}
      {tab === "positions" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-5">{t.portfolio.market}</div>
            <div className="col-span-2 text-right">{t.portfolio.avgNow}</div>
            <div className="col-span-2 text-right">{t.portfolio.shares}</div>
            <div className="col-span-1 text-right">{t.portfolio.toWin}</div>
            <div className="col-span-2 text-right">{t.portfolio.value}</div>
          </div>

          {paperPositions.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-[#484f58]">{t.portfolio.noPositions}</p>
              <div className="flex gap-3 justify-center mt-3">
                <Link href="/trade" className="text-xs text-[#58a6ff] hover:underline">Paper Trade</Link>
                <Link href="/sports" className="text-xs text-[#58a6ff] hover:underline">Sports Betting</Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {paperPositions.map((pos) => {
                const value = pos.shares * pos.avgPrice;
                return (
                  <div key={pos.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                    <div className="col-span-5">
                      <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                      <p className="text-[10px] text-[#484f58] mt-0.5">{pos.outcome}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}&cent;</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pos.shares.toFixed(1)}</span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className="text-xs text-[#3fb950] tabular-nums">{pos.shares.toFixed(1)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{value.toFixed(0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {tab === "history" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-1">{t.portfolio.side}</div>
            <div className="col-span-5">{t.portfolio.market}</div>
            <div className="col-span-2 text-right">{t.portfolio.shares}</div>
            <div className="col-span-2 text-right">{t.portfolio.price}</div>
            <div className="col-span-2 text-right">{t.portfolio.when}</div>
          </div>

          {trades.length === 0 ? (
            <p className="text-sm text-[#484f58] text-center py-16">{t.portfolio.noTradeHistory}</p>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {trades.map((tr) => {
                const time = new Date(tr.createdAt);
                const timeStr = time.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                return (
                  <div key={tr.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                    <div className="col-span-1">
                      <span className={cn("text-xs font-semibold", tr.side === "buy" ? "text-[#3fb950]" : "text-[#f85149]")}>
                        {tr.side.toUpperCase()}
                      </span>
                    </div>
                    <div className="col-span-5">
                      <p className="text-[13px] text-[#e6edf3] leading-snug line-clamp-1">{tr.marketQuestion}</p>
                      <p className="text-[10px] text-[#484f58]">{tr.outcome}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums">{tr.shares.toFixed(1)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums">{Math.round(tr.price * 100)}&cent;</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-[10px] text-[#484f58]">{timeStr}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Referral Program (collapsible) ── */}
      {user && (
        <div className="mt-6">
          <button
            onClick={() => setShowReferral(!showReferral)}
            className="flex items-center gap-2 text-sm text-[#768390] hover:text-white transition-colors mb-3"
          >
            <svg className={cn("w-3 h-3 transition-transform", showReferral && "rotate-90")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            Referral Program
            {referralCount > 0 && <span className="text-[10px] text-[#3fb950] bg-[#3fb950]/10 px-1.5 py-0.5 rounded font-medium">{referralCount} referred</span>}
          </button>

          {showReferral && (
            <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5">
              <p className="text-xs text-[#768390] mb-3">
                Share your code and earn <span className="text-[#3fb950] font-semibold">5,000 AIRDROP</span> for every friend who signs up and claims their bonus.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 font-mono text-sm text-[#e6edf3] select-all">
                  {user.referralCode}
                </div>
                <button
                  onClick={() => handleCopy(user.referralCode, "code")}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#238636] text-white hover:bg-[#2ea043] transition-colors whitespace-nowrap"
                >
                  {copied === "code" ? "Copied!" : "Copy Code"}
                </button>
                <button
                  onClick={() => handleCopy(`${window.location.origin}?ref=${user.referralCode}`, "link")}
                  className="px-3 py-2 rounded-lg text-xs font-semibold border border-[#30363d] text-[#e6edf3] hover:bg-[#21262d] transition-colors whitespace-nowrap"
                >
                  {copied === "link" ? "Copied!" : "Copy Link"}
                </button>
              </div>
              <div className="mt-3 flex gap-3">
                <div className="flex items-center gap-2 bg-[#0d1117] rounded-lg px-3 py-2">
                  <span className="text-sm font-bold text-[#3fb950]">{referralCount}</span>
                  <span className="text-[10px] text-[#484f58]">referred</span>
                </div>
                <div className="flex items-center gap-2 bg-[#0d1117] rounded-lg px-3 py-2">
                  <span className="text-sm font-bold text-white">5,000</span>
                  <span className="text-[10px] text-[#484f58]">per referral</span>
                </div>
              </div>
              <ReferralCodeInput userId={user.id} referredBy={user.referredBy} />
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />
      <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} usdcBalance={usdcBal} />
    </div>
  );
}

function ReferralCodeInput({ userId, referredBy }: { userId: string; referredBy: string | null }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (referredBy) {
    return (
      <div className="mt-3 pt-3 border-t border-[#21262d]">
        <p className="text-[10px] text-[#484f58]">Referred by: <span className="text-[#768390] font-mono">{referredBy}</span></p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/airdrop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userId}` },
        body: JSON.stringify({ userId, type: "apply-referral", referralCode: code.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, msg: "Referral applied! Your friend will receive 5,000 AIRDROP when you claim your signup bonus." });
        setCode("");
      } else {
        setResult({ ok: false, msg: data.error || "Invalid code" });
      }
    } catch {
      setResult({ ok: false, msg: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[#21262d]">
      <p className="text-xs text-[#768390] mb-2">Have a friend&apos;s referral code?</p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="PS-XXXXXXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#58a6ff] outline-none font-mono uppercase"
          maxLength={11}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || !code.trim()}
          className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {submitting ? "Applying..." : "Apply Code"}
        </button>
      </div>
      {result && (
        <p className={cn("text-xs mt-2", result.ok ? "text-[#3fb950]" : "text-[#f85149]")}>{result.msg}</p>
      )}
    </div>
  );
}
