"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import { useAccount, useBalance } from "wagmi";
import { useAuthStore } from "@/stores/use-auth-store";
import { LoginButton } from "@/components/layout/login-modal";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import Link from "next/link";
import { DepositModal } from "@/components/portfolio/deposit-modal";
import { WithdrawModal } from "@/components/portfolio/withdraw-modal";

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const POLYGON_CHAIN_ID = 137;

interface ClobPosition {
  asset: string;
  market: string;
  side: string;
  size: string;
  avgPrice: string;
  curPrice: number;
  pnl: number;
  question?: string;
  slug?: string;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PortfolioPage() {
  const { t } = useT();
  const { address, isConnected, user, positions: paperPositions } = useUser();
  const { isConnected: wagmiConnected, chainId } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  const isGoogleUser = !!googleAddress && !wagmiConnected;
  const isOnPolygon = chainId === POLYGON_CHAIN_ID || isGoogleUser;

  // Real USDC balance
  const { data: usdcBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: POLYGON_CHAIN_ID,
    query: { enabled: !!address && isOnPolygon },
  });
  const usdcBal = usdcBalance ? parseFloat(usdcBalance.formatted) : 0;

  // Paper portfolio value
  const paperBalance = user?.balance || 0;
  const paperPositionValue = paperPositions.reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
  const paperTotal = paperBalance + paperPositionValue;

  // Tab state
  const [tab, setTab] = useState<"positions" | "history">("positions");

  // Deposit/Withdraw modals
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // Referral count
  const [referralCount, setReferralCount] = useState<number>(0);
  useEffect(() => {
    if (!address) return;
    fetch(`/api/user/referrals?userId=${address}`, {
      headers: { Authorization: `Bearer ${address}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setReferralCount(d.count); })
      .catch(() => {});
  }, [address]);

  // Copy feedback
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">{t.portfolio.title}</h1>
        <div className="text-xs text-[#484f58] font-mono">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </div>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Real USDC */}
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">{t.portfolio.availableToTrade}</p>
            <span className="text-[10px] text-[#3fb950] bg-[#3fb950]/10 px-1.5 py-0.5 rounded font-medium">USDC</span>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">{formatUsd(usdcBal)}</p>
          <p className="text-xs text-[#484f58] mt-1">{t.portfolio.polygonNetwork}</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setDepositOpen(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[#58a6ff]/10 text-[#58a6ff] hover:bg-[#58a6ff]/20 transition-colors"
            >
              {t.portfolio.deposit}
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors"
            >
              {t.portfolio.withdraw}
            </button>
          </div>
          <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />
          <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} usdcBalance={usdcBal} />
        </div>

        {/* Paper Portfolio */}
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">{t.portfolio.paperPortfolio}</p>
            <span className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-1.5 py-0.5 rounded font-medium">AIRDROP</span>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">
            {paperTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-[#484f58] mt-1">
            {paperBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} cash + {paperPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} in positions
          </p>
          <Link
            href="/trade"
            className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-md text-xs font-medium bg-[#d29922]/10 text-[#d29922] hover:bg-[#d29922]/20 transition-colors"
          >
            Paper Trade
          </Link>
        </div>

        {/* Profit/Loss placeholder */}
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">{t.portfolio.profitLoss}</p>
            <div className="flex gap-1">
              {["1D", "1W", "1M", "ALL"].map((period) => (
                <button key={period} className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded font-medium",
                  period === "ALL" ? "bg-[#58a6ff]/15 text-[#58a6ff]" : "text-[#484f58] hover:text-[#768390]"
                )}>
                  {period}
                </button>
              ))}
            </div>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">{formatUsd(0)}</p>
          <p className="text-xs text-[#484f58] mt-1">{t.portfolio.pastDay}</p>
        </div>
      </div>

      {/* Referral Program */}
      {user && (
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-5 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white mb-1">Referral Program</p>
              <p className="text-xs text-[#768390]">
                Share your code and earn <span className="text-[#3fb950] font-semibold">5,000 AIRDROP</span> for every friend who signs up and claims their bonus.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 font-mono text-sm text-[#e6edf3] select-all">
              {user.referralCode}
            </div>
            <button
              onClick={() => handleCopy(user.referralCode, "code")}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-[#238636] text-white hover:bg-[#2ea043] transition-colors whitespace-nowrap"
            >
              {copied === "code" ? "Copied!" : "Copy Code"}
            </button>
            <button
              onClick={() => handleCopy(`${window.location.origin}?ref=${user.referralCode}`, "link")}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors whitespace-nowrap"
            >
              {copied === "link" ? "Copied!" : "Copy Link"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3 text-center">
            <div className="bg-[#0d1117] rounded-lg p-3">
              <p className="text-lg font-bold text-[#3fb950]">{referralCount}</p>
              <p className="text-[10px] text-[#484f58]">Friends referred</p>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-3">
              <p className="text-lg font-bold text-white">5,000</p>
              <p className="text-[10px] text-[#484f58]">AIRDROP per referral</p>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-3">
              <p className="text-lg font-bold text-white">100</p>
              <p className="text-[10px] text-[#484f58]">Daily claim</p>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-3">
              <p className="text-lg font-bold text-white">1,000</p>
              <p className="text-[10px] text-[#484f58]">Signup bonus</p>
            </div>
          </div>

          {/* Enter referral code — only if not already referred */}
          <ReferralCodeInput userId={user.id} referredBy={user.referredBy} />
        </div>
      )}

      {/* Tabs: Positions / History */}
      <div className="flex gap-0 border-b border-[#21262d] mb-4">
        <button
          onClick={() => setTab("positions")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors",
            tab === "positions" ? "text-white border-b-2 border-[#58a6ff]" : "text-[#768390] hover:text-[#adbac7]"
          )}
        >
          {t.portfolio.positions}
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors",
            tab === "history" ? "text-white border-b-2 border-[#58a6ff]" : "text-[#768390] hover:text-[#adbac7]"
          )}
        >
          {t.portfolio.history}
        </button>
      </div>

      {/* Positions Tab */}
      {tab === "positions" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-5">{t.portfolio.market}</div>
            <div className="col-span-2 text-right">{t.portfolio.avgNow}</div>
            <div className="col-span-2 text-right">{t.portfolio.shares}</div>
            <div className="col-span-1 text-right">{t.portfolio.toWin}</div>
            <div className="col-span-2 text-right">{t.portfolio.value}</div>
          </div>

          {paperPositions.length === 0 ? (
            <div className="text-center py-12">
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
                const toWin = pos.shares;
                return (
                  <div key={pos.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                    <div className="col-span-5">
                      <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                      <p className="text-[10px] text-[#484f58] mt-0.5">{pos.outcome}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}¢</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pos.shares.toFixed(1)}</span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className="text-xs text-[#3fb950] tabular-nums">{toWin.toFixed(1)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{value.toFixed(0)} <span className="text-[#484f58]">AIRDROP</span></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-1">Side</div>
            <div className="col-span-5">Market</div>
            <div className="col-span-2 text-right">Shares</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">When</div>
          </div>

          <TradeHistory address={address} />
        </div>
      )}
    </div>
  );
}

function ReferralCodeInput({ userId, referredBy }: { userId: string; referredBy: string | null }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Already referred — show who referred them
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
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:opacity-50 whitespace-nowrap"
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

function TradeHistory({ address }: { address: string | null }) {
  const { trades } = useUser();

  if (trades.length === 0) {
    return <p className="text-sm text-[#484f58] text-center py-12">No trade history</p>;
  }

  return (
    <div className="divide-y divide-[#21262d]">
      {trades.map((t) => {
        const time = new Date(t.createdAt);
        const timeStr = time.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        return (
          <div key={t.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
            <div className="col-span-1">
              <span className={cn("text-xs font-semibold", t.side === "buy" ? "text-[#3fb950]" : "text-[#f85149]")}>
                {t.side.toUpperCase()}
              </span>
            </div>
            <div className="col-span-5">
              <p className="text-[13px] text-[#e6edf3] leading-snug line-clamp-1">{t.marketQuestion}</p>
              <p className="text-[10px] text-[#484f58]">{t.outcome}</p>
            </div>
            <div className="col-span-2 text-right">
              <span className="text-xs text-[#e6edf3] tabular-nums">{t.shares.toFixed(1)}</span>
            </div>
            <div className="col-span-2 text-right">
              <span className="text-xs text-[#e6edf3] tabular-nums">{Math.round(t.price * 100)}¢</span>
            </div>
            <div className="col-span-2 text-right">
              <span className="text-[10px] text-[#484f58]">{timeStr}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
