"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useUser } from "@/hooks/use-user";
import { usePositionLivePrices } from "@/hooks/use-live-prices";
import { usePolymarketTrade } from "@/hooks/use-polymarket-trade";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBalance } from "wagmi";
import { useAuthStore } from "@/stores/use-auth-store";
import { LoginButton } from "@/components/layout/login-modal";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { POLYMARKET_BASE_URL } from "@/lib/constants";
import Link from "next/link";
import { BridgeDepositModal } from "@/components/portfolio/bridge-deposit-modal";
import { WithdrawModal } from "@/components/portfolio/withdraw-modal";
import { PendingBridgeIndicator } from "@/components/portfolio/pending-bridge-indicator";
import { DidYouSendModal } from "@/components/portfolio/did-you-send-modal";
import { deriveProxyAddress } from "@/lib/relay";
import { usePendingBridge } from "@/hooks/use-pending-bridge";

// USDC.e on Polygon — required for Polymarket CLOB trading. See src/lib/relay.ts.
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
  const googleAddress = useAuthStore((s) => s.googleAddress);

  // Polymarket proxy wallet address (where deposited USDC.e actually lives)
  const proxyAddress = address ? deriveProxyAddress(address) : undefined;

  // Pending bridge tracker — faux system driven by the Polygon balance
  // changes we can see locally. No source/destination chain polling.
  const { state: bridgeState, startPending, complete: completeBridge, dismiss: dismissPending } = usePendingBridge();

  // Read USDC.e balance from the proxy wallet (not the EOA).
  // We always read from Polygon regardless of which chain the connected wallet
  // is on — the balance is held on Polygon whether the user is currently
  // signed into Phantom/MetaMask on Solana, Ethereum, or anywhere else.
  // While a bridge is in flight we poll every 8s so the indicator auto-dismisses
  // as soon as funds land; otherwise we rely on react-query's default staleness.
  const refetchInterval = bridgeState ? 8_000 : false;
  const { data: proxyUsdcBalance } = useBalance({
    address: proxyAddress as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: POLYGON_CHAIN_ID,
    query: { enabled: !!proxyAddress, refetchInterval },
  });
  // Also check EOA balance as fallback
  const { data: eoaUsdcBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: POLYGON_CHAIN_ID,
    query: { enabled: !!address, refetchInterval },
  });
  const proxyBal = proxyUsdcBalance ? parseFloat(proxyUsdcBalance.formatted) : 0;
  const eoaBal = eoaUsdcBalance ? parseFloat(eoaUsdcBalance.formatted) : 0;
  const usdcBal = proxyBal + eoaBal;

  // Transition to the "completed" celebration when the USDC.e balance moves
  // in the expected direction:
  //   - Deposit: balance goes UP (funds arrived)
  //   - Withdraw: balance goes DOWN (relay tx settled, funds left)
  const prevBalRef = useRef<number>(usdcBal);
  useEffect(() => {
    const delta = usdcBal - prevBalRef.current;
    if (bridgeState?.kind === "pending") {
      if (bridgeState.type === "deposit" && delta > 0.001) {
        completeBridge("deposit", bridgeState.chain);
      } else if (bridgeState.type === "withdraw" && delta < -0.001) {
        completeBridge("withdraw", bridgeState.chain);
      }
    }
    prevBalRef.current = usdcBal;
  }, [usdcBal, bridgeState, completeBridge]);

  // Paper positions only — real positions come exclusively from Polymarket's data API
  const paperOnlyPositions = paperPositions.filter((p) => p.tradeType !== "real");

  // Fetch REAL positions from Polymarket's data API (source of truth).
  // No DB fallback — if the data API says 0 positions, that's the truth.
  interface PolyPosition {
    title: string;
    market: { slug: string; question: string };
    outcome: string;
    size: number;
    avgPrice: number;
    curPrice: number;
    initialValue: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    conditionId: string;
    asset: string;
    proxyWallet: string;
  }
  const { data: polyPositions } = useQuery<PolyPosition[]>({
    queryKey: ["polymarket-positions", proxyAddress],
    queryFn: async () => {
      if (!proxyAddress) return [];
      const res = await fetch(`/api/polymarket/positions?user=${proxyAddress}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.positions || [];
    },
    enabled: !!proxyAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Real positions — Polymarket data API only, no DB fallback
  const realPositions = (polyPositions || []).map((p) => ({
    id: p.asset || p.conditionId,
    userId: address || "",
    marketId: p.conditionId,
    marketQuestion: p.title || p.market?.question || "",
    outcome: p.outcome || "Yes",
    shares: p.size,
    avgPrice: p.avgPrice,
    clobTokenId: p.asset || null,
    marketEndDate: null,
    eventSlug: p.market?.slug || null,
    tradeType: "real" as const,
    clobOrderId: null,
    createdAt: "",
    updatedAt: "",
    _curPrice: p.curPrice,
    _cashPnl: p.cashPnl,
    _percentPnl: p.percentPnl,
    _currentValue: p.currentValue,
  }));

  // Paper portfolio value
  const paperBalance = user?.balance || 0;
  const paperPositionValue = paperOnlyPositions.reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
  const paperTotal = paperBalance + paperPositionValue;

  // Tab state
  const [tab, setTab] = useState<"positions" | "history">("positions");
  // Expandable position + close
  const [expandedPos, setExpandedPos] = useState<string | null>(null);
  const [closingPos, setClosingPos] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const { placeOrder } = usePolymarketTrade();
  const queryClient = useQueryClient();
  // Mode: "real" shows USDC.e positions, "paper" shows AIRDROP positions
  const [portfolioMode, setPortfolioMode] = useState<"real" | "paper">("real");

  // Live prices for ALL positions (paper + real) so we can show real-time P&L
  const allPositionsWithToken = paperPositions.filter((p) => p.clobTokenId);
  const priceTargets = useMemo(() =>
    allPositionsWithToken.map((p) => ({
      id: p.marketId,
      tokenId: p.clobTokenId!,
      fallbackYes: p.avgPrice,
      fallbackNo: 1 - p.avgPrice,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPositionsWithToken.length]
  );
  const { prices: livePrices } = usePositionLivePrices(priceTargets);

  // Paper P&L
  const paperPnl = useMemo(() => {
    let total = 0;
    for (const pos of paperOnlyPositions) {
      const live = livePrices[pos.marketId];
      const livePrice = live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice;
      total += (livePrice - pos.avgPrice) * pos.shares;
    }
    return total;
  }, [paperOnlyPositions, livePrices]);

  // Real P&L — prefer Polymarket data API values when available
  const realPnl = useMemo(() => {
    let total = 0;
    for (const pos of realPositions) {
      const ext = pos as typeof pos & { _cashPnl?: number };
      if (ext._cashPnl !== undefined) {
        total += ext._cashPnl;
      } else {
        const live = livePrices[pos.marketId];
        const livePrice = live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice;
        total += (livePrice - pos.avgPrice) * pos.shares;
      }
    }
    return total;
  }, [realPositions, livePrices]);

  // Deposit + Withdraw modals
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // After the deposit modal closes, we don't know if the user actually sent.
  // Ask them, so a bogus "awaiting deposit" doesn't appear if they were
  // only peeking at the address.
  const [confirmDeposit, setConfirmDeposit] = useState<{ chain: string } | null>(null);

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
  const [referralExpanded, setReferralExpanded] = useState(false);
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

      {/* Balance Cards — click to toggle between Real and Paper views.
          Active card pulses with a glow to show the link to positions below. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* USDC.e / Real Trading card */}
        <button
          type="button"
          onClick={() => setPortfolioMode("real")}
          className={cn(
            "rounded-xl border bg-[#161b22] p-5 text-left transition-all",
            portfolioMode === "real"
              ? "border-[#58a6ff]/40 animate-pulse-glow-blue"
              : "border-[#21262d] hover:border-[#30363d] cursor-pointer"
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">{t.portfolio.availableToTrade}</p>
            <span className="text-[10px] text-[#3fb950] bg-[#3fb950]/10 px-1.5 py-0.5 rounded font-medium">USDC.e</span>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">{formatUsd(usdcBal)}</p>
          <p className="text-xs text-[#484f58] mt-1">Held on Polymarket · Polygon</p>
          <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
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
          {bridgeState && (
            <PendingBridgeIndicator state={bridgeState} onDismiss={dismissPending} />
          )}
        </button>
        {/* Modals live outside the button to avoid nested-interactive issues */}
        <BridgeDepositModal
          open={depositOpen}
          onOpenChange={setDepositOpen}
          recipientAddress={address}
          onDepositInitiated={(chain) => setConfirmDeposit({ chain })}
        />
        <DidYouSendModal
          open={confirmDeposit !== null}
          onOpenChange={(o) => { if (!o) setConfirmDeposit(null); }}
          onAnswer={(yes) => {
            if (yes && confirmDeposit) startPending("deposit", confirmDeposit.chain);
            setConfirmDeposit(null);
          }}
        />
        <WithdrawModal
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          usdcBalance={usdcBal}
          userAddress={address}
          onWithdrawStarted={(chain) => startPending("withdraw", chain)}
          onWithdrawFailed={dismissPending}
        />

        {/* Paper Portfolio / AIRDROP card */}
        <button
          type="button"
          onClick={() => setPortfolioMode("paper")}
          className={cn(
            "rounded-xl border bg-[#161b22] p-5 text-left transition-all",
            portfolioMode === "paper"
              ? "border-[#d29922]/40 animate-pulse-glow-green"
              : "border-[#21262d] hover:border-[#30363d] cursor-pointer"
          )}
        >
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
          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
            <Link
              href="/trade"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[#d29922]/10 text-[#d29922] hover:bg-[#d29922]/20 transition-colors"
            >
              Paper Trade
            </Link>
          </div>
        </button>

        {/* Profit/Loss card — updates based on active mode */}
        <div className={cn(
          "rounded-xl border bg-[#161b22] p-5 transition-all",
          portfolioMode === "real"
            ? "border-[#58a6ff]/30"
            : "border-[#d29922]/30"
        )}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">
              {portfolioMode === "real" ? "Unrealized P&L" : "Paper P&L"}
            </p>
            <span className={cn(
              "text-[9px] px-1.5 py-0.5 rounded font-medium",
              portfolioMode === "real"
                ? "bg-[#58a6ff]/15 text-[#58a6ff]"
                : "bg-[#d29922]/15 text-[#d29922]"
            )}>
              {portfolioMode === "real" ? "USDC" : "AIRDROP"}
            </span>
          </div>
          {portfolioMode === "real" ? (
            <>
              <p className={cn("text-3xl font-bold tabular-nums", realPnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                {realPnl >= 0 ? "+" : ""}{formatUsd(realPnl)}
              </p>
              <p className="text-xs text-[#484f58] mt-1">
                {realPositions.length > 0
                  ? `Across ${realPositions.length} position${realPositions.length !== 1 ? "s" : ""}`
                  : "Place a trade on Sports to track P&L"}
              </p>
            </>
          ) : (
            <>
              <p className={cn("text-3xl font-bold tabular-nums", paperPnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                {paperPnl >= 0 ? "+" : ""}{paperPnl.toFixed(0)} <span className="text-lg">AIRDROP</span>
              </p>
              <p className="text-xs text-[#484f58] mt-1">
                Across {paperOnlyPositions.length} position{paperOnlyPositions.length !== 1 ? "s" : ""}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Referral Program */}
      {user && (
        <div className="rounded-xl border border-[#21262d] bg-[#161b22] mb-8">
          <button
            type="button"
            onClick={() => setReferralExpanded((v) => !v)}
            aria-expanded={referralExpanded}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-[#1c2128]/40 transition-colors rounded-xl"
          >
            <div>
              <p className="text-sm font-semibold text-white mb-1">Referral Program</p>
              <p className="text-xs text-[#768390]">
                Share your code and earn <span className="text-[#3fb950] font-semibold">5,000 AIRDROP</span> for every friend who signs up and claims their bonus.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3 px-3 py-1.5 rounded-full bg-[#21262d] border border-[#30363d] text-[#adbac7] hover:bg-[#30363d] hover:text-white transition-colors">
              <span className="text-xs font-semibold">
                {referralExpanded ? "Hide" : "Show details"}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn("transition-transform", referralExpanded && "rotate-180")}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>
          {referralExpanded && (
            <div className="px-5 pb-5">
              <div className="flex items-center gap-3">
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
      {tab === "positions" && portfolioMode === "real" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-3">{t.portfolio.market}</div>
            <div className="col-span-2 text-right">Avg → Now</div>
            <div className="col-span-2 text-right">{t.portfolio.shares}</div>
            <div className="col-span-2 text-right">P&L</div>
            <div className="col-span-1 text-right">Value</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {realPositions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#484f58]">No real positions yet</p>
              <p className="text-xs text-[#484f58] mt-1">
                Place a trade on the <Link href="/sports" className="text-[#58a6ff] hover:underline">Sports page</Link> to see positions here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {realPositions.map((pos) => {
                const ext = pos as typeof pos & { _curPrice?: number; _cashPnl?: number; _percentPnl?: number; _currentValue?: number };
                const hasPoly = ext._curPrice !== undefined;
                const live = livePrices[pos.marketId];
                const livePrice = hasPoly ? ext._curPrice! : (live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice);
                const value = hasPoly && ext._currentValue !== undefined ? ext._currentValue : pos.shares * livePrice;
                const pnl = hasPoly && ext._cashPnl !== undefined ? ext._cashPnl : (livePrice - pos.avgPrice) * pos.shares;
                const pnlPct = hasPoly && ext._percentPnl !== undefined ? ext._percentPnl : (pos.avgPrice > 0 ? ((livePrice - pos.avgPrice) / pos.avgPrice) * 100 : 0);
                const isExpanded = expandedPos === pos.id;
                const isClosing = closingPos === pos.id;
                const result = closeResult?.id === pos.id ? closeResult : null;

                return (
                  <div key={pos.id}>
                    <div
                      className={cn("grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors cursor-pointer", isExpanded && "bg-[#1c2128]/30")}
                      onClick={() => setExpandedPos(isExpanded ? null : pos.id)}
                    >
                      <div className="col-span-3">
                        <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                        <p className="text-[10px] text-[#484f58] mt-0.5">{pos.outcome}</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}¢</span>
                        <span className="text-[10px] text-[#484f58] mx-0.5">→</span>
                        <span className={cn("text-xs font-medium tabular-nums", (hasPoly || live) ? "text-[#e6edf3]" : "text-[#484f58]")}>
                          {Math.round(livePrice * 100)}¢
                        </span>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pos.shares.toFixed(1)}</span>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className={cn("text-xs font-medium tabular-nums", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                          {pnl >= 0 ? "+" : ""}{formatUsd(pnl)}
                        </span>
                        <span className={cn("text-[10px] ml-1 tabular-nums", pnl >= 0 ? "text-[#3fb950]/60" : "text-[#f85149]/60")}>
                          ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="col-span-1 text-right">
                        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{formatUsd(value)}</span>
                      </div>
                      <div className="col-span-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          disabled={isClosing}
                          onClick={async () => {
                            if (!pos.clobTokenId) {
                              console.error("[Close] No tokenId for position", pos.id);
                              setCloseResult({ id: pos.id, msg: "No token ID — can't close", ok: false });
                              return;
                            }
                            console.log("[Close] Selling", pos.shares, "shares of", pos.marketQuestion, "tokenId:", pos.clobTokenId, "price:", livePrice);
                            setClosingPos(pos.id);
                            setCloseResult(null);
                            const res = await placeOrder({
                              tokenId: pos.clobTokenId,
                              side: "SELL",
                              amount: value,
                              price: livePrice,
                            });
                            console.log("[Close] Result:", JSON.stringify(res));
                            if (res.success) {
                              setCloseResult({ id: pos.id, msg: `Closed! Sold ${pos.shares.toFixed(1)} shares (${res.status || "processing"})`, ok: true });
                              setTimeout(() => queryClient.invalidateQueries({ queryKey: ["polymarket-positions"] }), 3000);
                            } else {
                              setCloseResult({ id: pos.id, msg: res.error || "Close failed", ok: false });
                            }
                            setClosingPos(null);
                          }}
                          className={cn(
                            "px-3 py-1 rounded text-[11px] font-semibold transition-colors",
                            isClosing
                              ? "bg-[#21262d] text-[#484f58] cursor-wait"
                              : "bg-[#f85149]/15 text-[#f85149] hover:bg-[#f85149]/25"
                          )}
                        >
                          {isClosing ? "Closing..." : "Close"}
                        </button>
                      </div>
                    </div>
                    {/* Close result shown even when collapsed */}
                    {result && !isExpanded && (
                      <div className="px-4 py-2 bg-[#0d1117] border-t border-[#21262d]">
                        <p className={cn("text-xs font-medium", result.ok ? "text-[#3fb950]" : "text-[#f85149]")}>{result.msg}</p>
                      </div>
                    )}
                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-4 py-3 bg-[#0d1117] border-t border-[#21262d] space-y-2">
                        <div className="flex gap-6 text-xs text-[#768390]">
                          <span>Bought at: <span className="text-[#e6edf3]">{Math.round(pos.avgPrice * 100)}¢</span></span>
                          <span>Current: <span className="text-[#e6edf3]">{Math.round(livePrice * 100)}¢</span></span>
                          <span>Shares: <span className="text-[#e6edf3]">{pos.shares.toFixed(2)}</span></span>
                          <span>Cost: <span className="text-[#e6edf3]">{formatUsd(pos.shares * pos.avgPrice)}</span></span>
                          <span>Value: <span className="text-[#e6edf3]">{formatUsd(value)}</span></span>
                        </div>
                        {pos.eventSlug && (
                          <a href={`https://polymarket.com/event/${pos.eventSlug}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#58a6ff] hover:underline">
                            View on Polymarket →
                          </a>
                        )}
                        {result && (
                          <p className={cn("text-xs font-medium", result.ok ? "text-[#3fb950]" : "text-[#f85149]")}>{result.msg}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "positions" && portfolioMode === "paper" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-4">{t.portfolio.market}</div>
            <div className="col-span-2 text-right">Avg → Now</div>
            <div className="col-span-2 text-right">{t.portfolio.shares}</div>
            <div className="col-span-2 text-right">P&L</div>
            <div className="col-span-2 text-right">{t.portfolio.value}</div>
          </div>

          {paperOnlyPositions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#484f58]">{t.portfolio.noPositions}</p>
              <div className="flex gap-3 justify-center mt-3">
                <Link href="/trade" className="text-xs text-[#58a6ff] hover:underline">Paper Trade</Link>
                <Link href="/sports" className="text-xs text-[#58a6ff] hover:underline">Sports Betting</Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {paperOnlyPositions.map((pos) => {
                const live = livePrices[pos.marketId];
                const livePrice = live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice;
                const value = pos.shares * livePrice;
                const pnl = (livePrice - pos.avgPrice) * pos.shares;
                const pnlPct = pos.avgPrice > 0 ? ((livePrice - pos.avgPrice) / pos.avgPrice) * 100 : 0;
                return (
                  <div key={pos.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                    <div className="col-span-4">
                      <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                      <p className="text-[10px] text-[#484f58] mt-0.5">{pos.outcome}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}¢</span>
                      <span className="text-[10px] text-[#484f58] mx-0.5">→</span>
                      <span className={cn("text-xs font-medium tabular-nums", live ? "text-[#e6edf3]" : "text-[#484f58]")}>
                        {Math.round(livePrice * 100)}¢
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pos.shares.toFixed(1)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className={cn("text-xs font-medium tabular-nums", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}
                      </span>
                      <span className={cn("text-[10px] ml-1 tabular-nums", pnl >= 0 ? "text-[#3fb950]/60" : "text-[#f85149]/60")}>
                        ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)
                      </span>
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
      {tab === "history" && portfolioMode === "real" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📜</div>
            <p className="text-sm font-medium text-[#e6edf3]">Trade History</p>
            <p className="text-xs text-[#484f58] mt-1">Real trade history will appear here once you place trades on Sports.</p>
          </div>
        </div>
      )}

      {tab === "history" && portfolioMode === "paper" && (
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
