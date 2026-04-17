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
import { TradeProgress } from "@/components/sports/trade-progress";
import { SellPositionModal } from "@/components/portfolio/sell-position-modal";
import { loadPendingPositions, removePendingPosition, type PendingPosition } from "@/lib/pending-positions";
import { addPendingActivity, loadPendingActivity, removePendingActivity, type PendingActivity } from "@/lib/pending-activity";
import { addClosedPosition, loadClosedPositions, removeClosedPosition } from "@/lib/closed-positions";
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
  // Polymarket /positions response shape. Fields sit at the TOP LEVEL —
  // earlier we wrongly nested `slug` under a `market` object, so every
  // position came through with eventSlug === null and the title-click Link
  // silently fell back to a plain <p>.  We want `eventSlug` specifically
  // (event, not market) because /api/sports/game?slug= resolves against
  // Gamma's /events endpoint.
  interface PolyPosition {
    title: string;
    slug: string;           // market slug
    eventSlug?: string;     // event slug (what we want for the sports page link)
    eventId?: string;
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

  interface PolyActivity {
    proxyWallet: string;
    timestamp: number;
    conditionId: string;
    type: string;
    size: number;
    usdcSize: number;
    transactionHash: string;
    price: number;
    asset: string;
    side: string;
    outcomeIndex: number;
    title: string;
    slug?: string;
  }
  const { data: polyActivity } = useQuery<PolyActivity[]>({
    queryKey: ["polymarket-activity", proxyAddress],
    queryFn: async () => {
      if (!proxyAddress) return [];
      const res = await fetch(`/api/polymarket/activity?user=${proxyAddress}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.activity || [];
    },
    enabled: !!proxyAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Pending BUYs whose onchain confirmation landed but /positions hasn't
  // yet reflected them. Hydrated from localStorage on mount (so a user who
  // places a trade then navigates to portfolio sees the skeleton even
  // though this component just mounted). Cleared as /positions catches up
  // OR when the TTL expires.
  const [pendingPositions, setPendingPositions] = useState<PendingPosition[]>(() => loadPendingPositions());
  // Same idea for /activity lag: trades that just confirmed onchain but
  // haven't shown up in Polymarket's /activity data-api yet. Rendered as
  // skeleton rows in the History tab until /activity returns the matching
  // tx hash. 3min TTL inside the store.
  const [pendingActivity, setPendingActivity] = useState<PendingActivity[]>(() => loadPendingActivity());

  // On mount: kick off aggressive polling so the pending skeletons don't
  // linger any longer than needed.
  useEffect(() => {
    if (pendingPositions.length === 0) return;
    const delays = [1500, 3500, 7000, 15000, 30000];
    const timers = delays.map((d) => setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["polymarket-positions"] });
      queryClient.invalidateQueries({ queryKey: ["polymarket-activity"] });
    }, d));
    return () => { timers.forEach(clearTimeout); };
    // Only run when the pending-set identity changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPositions.length]);

  // Positions whose close has already settled onchain. Shared with the
  // bet slip via src/lib/closed-positions.ts so a full-close SELL from
  // /sports/game also hides the row here immediately. 2min TTL, same
  // entries cleared when /positions stops returning them.
  const [closedLocally, setClosedLocally] = useState<Set<string>>(() => loadClosedPositions());

  // Wrapper that both writes to the shared store AND refreshes local state.
  // Everywhere we used addClosedLocal(id) previously still works.
  const addClosedLocal = (id: string) => {
    addClosedPosition(id);
    setClosedLocally((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Listen for writes from OTHER places (bet slip on game view, Sell modal).
  // `storage` event only fires cross-tab, so we also poll localStorage every
  // few seconds to catch same-tab writes — cheaper than lifting the store
  // to a global zustand/context and good enough for a portfolio page.
  useEffect(() => {
    const syncFromStorage = () => setClosedLocally(loadClosedPositions());
    window.addEventListener("storage", syncFromStorage);
    const t = setInterval(syncFromStorage, 2500);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
      clearInterval(t);
    };
  }, []);

  // Real positions — Polymarket data API only, no DB fallback
  const realPositions = (polyPositions || [])
    // Hide positions we know we already closed but /positions hasn't caught up
    .filter((p) => !closedLocally.has(p.asset || p.conditionId))
    .map((p) => ({
      id: p.asset || p.conditionId,
      userId: address || "",
      marketId: p.conditionId,
      marketQuestion: p.title || "",
      outcome: p.outcome || "Yes",
      shares: p.size,
      avgPrice: p.avgPrice,
      clobTokenId: p.asset || null,
      marketEndDate: null,
      // Prefer eventSlug (real event) over slug (market). Falls back to
      // slug because for simple binary sports markets the two are equal.
      eventSlug: p.eventSlug || p.slug || null,
      tradeType: "real" as const,
      clobOrderId: null,
      createdAt: "",
      updatedAt: "",
      _curPrice: p.curPrice,
      _cashPnl: p.cashPnl,
      _percentPnl: p.percentPnl,
      _currentValue: p.currentValue,
    }));

  // Sum the current-mark value of all real positions — Polymarket's
  // /positions API already does the per-position math (currentValue), so
  // we just add. Falls back to shares × avgPrice for entries lacking
  // curPrice (rare).
  const realPositionsValue = realPositions.reduce((sum, p) => {
    const ext = p as typeof p & { _currentValue?: number };
    return sum + (ext._currentValue ?? p.shares * p.avgPrice);
  }, 0);

  // When a pending position shows up in /positions, remove it from the
  // pending list (both state and localStorage). This is what flips the
  // skeleton row into the real row seamlessly.
  useEffect(() => {
    if (pendingPositions.length === 0) return;
    if (!polyPositions) return;
    const returnedIds = new Set(polyPositions.map((p) => p.asset || p.conditionId));
    const arrived = pendingPositions.filter((p) => returnedIds.has(p.tokenId));
    if (arrived.length > 0) {
      for (const p of arrived) removePendingPosition(p.tokenId);
      setPendingPositions((prev) => prev.filter((p) => !returnedIds.has(p.tokenId)));
    }
  }, [polyPositions, pendingPositions]);

  // Sweep expired pending entries (TTL hit) every few seconds while the page
  // is open — keeps the skeleton from sticking forever if /positions never
  // produces a match (e.g. zero-fill edge cases). Same for activity.
  useEffect(() => {
    const t = setInterval(() => {
      setPendingPositions(loadPendingPositions());
      setPendingActivity(loadPendingActivity());
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // When a pending activity entry shows up in /activity (matched by tx
  // hash), remove it from state + storage so the skeleton disappears.
  useEffect(() => {
    if (pendingActivity.length === 0) return;
    if (!polyActivity) return;
    const returnedHashes = new Set(polyActivity.map((a) => a.transactionHash?.toLowerCase()));
    const arrived = pendingActivity.filter((p) => returnedHashes.has(p.txHash.toLowerCase()));
    if (arrived.length > 0) {
      for (const p of arrived) removePendingActivity(p.txHash);
      setPendingActivity((prev) =>
        prev.filter((p) => !returnedHashes.has(p.txHash.toLowerCase())),
      );
    }
  }, [polyActivity, pendingActivity]);

  // When pendingActivity goes from empty → populated (user just closed a
  // position from elsewhere and came back to portfolio), kick the same
  // aggressive refetch cadence against /activity.
  useEffect(() => {
    if (pendingActivity.length === 0) return;
    const delays = [1500, 3500, 7000, 15000, 30000];
    const timers = delays.map((d) => setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["polymarket-activity"] });
    }, d));
    return () => { timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingActivity.length]);

  // Once the /positions API catches up and stops returning a locally-closed
  // position, drop it from both state and localStorage so the filter doesn't
  // grow forever. Requires polyPositions to have actually loaded (length > 0
  // OR a definitive empty response) — otherwise the initial undefined state
  // would wrongly clear entries before /positions had a chance to return them.
  useEffect(() => {
    if (closedLocally.size === 0) return;
    if (!polyPositions) return; // query hasn't loaded yet
    const stillReturned = new Set(
      polyPositions.map((p) => p.asset || p.conditionId),
    );
    const gone = [...closedLocally].filter((id) => !stillReturned.has(id));
    if (gone.length > 0) {
      setClosedLocally((prev) => {
        const next = new Set(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      for (const id of gone) removeClosedPosition(id);
    }
  }, [polyPositions, closedLocally]);

  // Paper portfolio value
  const paperBalance = user?.balance || 0;
  const paperPositionValue = paperOnlyPositions.reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
  const paperTotal = paperBalance + paperPositionValue;

  // Tab state
  const [tab, setTab] = useState<"positions" | "history">("positions");
  // Expandable position + close
  const [closingPos, setClosingPos] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<{ id: string; msg: string; ok: boolean; txHashes?: string[] } | null>(null);
  // Position currently being sold through the slider modal. null = modal closed.
  const [sellingPos, setSellingPos] = useState<{
    id: string;
    tokenId: string;
    marketQuestion: string;
    outcome: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    eventSlug: string | null;
  } | null>(null);
  const { placeOrder, placing: placingOrder } = usePolymarketTrade();
  const queryClient = useQueryClient();

  /**
   * Execute a SELL for a subset of a position's shares. Shared between the
   * SellPositionModal's cash-out button and any future inline close paths.
   * Handles: wire-up of TradeProgress, closedLocally optimistic-hide,
   * "already closed" detection, and refetches.
   */
  const executeSell = async (p: {
    posId: string;
    tokenId: string;
    shares: number; // amount of shares to sell (can be partial)
    totalShares: number; // total shares in the position, for "full close" detection
    marketQuestion: string;
    price: number;
  }) => {
    setClosingPos(p.posId);
    setCloseResult(null);
    const res = await placeOrder({
      tokenId: p.tokenId,
      side: "SELL",
      amount: p.shares,
      price: p.price,
    });
    if (res.success) {
      const isFullClose = p.shares >= p.totalShares - 0.01;
      setCloseResult({
        id: p.posId,
        msg: isFullClose ? `Sold ${p.shares.toFixed(2)} shares` : `Sold ${p.shares.toFixed(2)} of ${p.totalShares.toFixed(2)} shares`,
        ok: true,
        txHashes: res.transactionHashes,
      });

      // Fire ALL follow-up actions immediately instead of waiting for
      // TradeProgress.onConfirmed. Previously we wired onConfirmed to
      // addClosedLocal / addPendingActivity / refetches — but that
      // callback only fires if TradeProgress renders, which only happens
      // when the CLOB returned tx hashes. On trades where the CLOB
      // response omitted transactionsHashes (some fills, certain
      // negRisk paths), none of these would run and the row got stuck.
      if (isFullClose) addClosedLocal(p.posId);
      if (res.transactionHashes && res.transactionHashes[0]) {
        addPendingActivity({
          txHash: res.transactionHashes[0],
          side: "SELL",
          marketTitle: p.marketQuestion,
          outcomeName: "", // populated by /activity when it catches up
          shares: p.shares,
          price: p.price,
          usdcSize: p.shares * p.price,
        });
      }
      // Aggressive polling — /positions lags ~10-30s, /activity similar.
      [500, 2000, 5000, 10000, 20000].forEach((d) =>
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["polymarket-positions"] });
          queryClient.invalidateQueries({ queryKey: ["polymarket-activity"] });
        }, d),
      );
    } else {
      const errText = (res.error || "").toLowerCase();
      const isAlreadyClosed =
        errText.includes("not enough shares") ||
        errText.includes("may have already been closed") ||
        errText.includes("not enough balance");
      if (isAlreadyClosed) {
        addClosedLocal(p.posId);
        [500, 2000, 5000, 10000].forEach((d) =>
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["polymarket-positions"] });
            queryClient.invalidateQueries({ queryKey: ["polymarket-activity"] });
          }, d),
        );
        setCloseResult({ id: p.posId, msg: "Already closed — refreshing…", ok: true });
      } else {
        setCloseResult({ id: p.posId, msg: res.error || "Sell failed", ok: false });
      }
    }
    setClosingPos(null);
    setSellingPos(null); // close modal either way
  };
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
        {/* Real Trading card — Polymarket-style: big "Total Portfolio"
            (USDC + position values) on the left, "Available to trade" (just
            USDC) tucked top-right. */}
        <button
          type="button"
          onClick={() => setPortfolioMode("real")}
          className={cn(
            // `flex flex-col justify-start` forces content to start at the
            // top of the stretched grid cell. Without it, the button's
            // user-agent vertical-center behavior kicks in on cards with
            // less content (Real has no subtext row, unlike Paper/P&L),
            // pushing the label block down ~15px vs the sibling cards.
            "rounded-xl border bg-[#161b22] p-5 text-left transition-all flex flex-col items-stretch justify-start",
            portfolioMode === "real"
              ? "border-[#58a6ff]/40 animate-pulse-glow-blue"
              : "border-[#21262d] hover:border-[#30363d] cursor-pointer"
          )}
        >
          {/* Top row mirrors Paper/P&L layout exactly: label on the left,
              a padded badge on the right. Paper has AIRDROP, P&L has USDC,
              Real has the "available to trade" USDC balance as a pill.
              Identical row height means the TOTAL PORTFOLIO label sits at
              the same Y as PAPER PORTFOLIO and UNREALIZED P&L. */}
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Total Portfolio</p>
            <span className="text-[10px] text-[#58a6ff] bg-[#58a6ff]/10 px-1.5 py-0.5 rounded font-medium tabular-nums">
              {formatUsd(usdcBal)} available
            </span>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">{formatUsd(usdcBal + realPositionsValue)}</p>
          {/* mt-auto pushes the action row to the bottom of the flex card
              so Deposit/Withdraw line up with Paper Trade on the sibling
              card (Paper has an extra subtext row that would otherwise
              make its action sit lower). */}
          <div className="flex gap-2 mt-auto pt-3" onClick={(e) => e.stopPropagation()}>
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
            "rounded-xl border bg-[#161b22] p-5 text-left transition-all flex flex-col items-stretch justify-start",
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
          {/* Bottom-align with sibling cards' action rows (mt-auto) so
              Paper Trade sits at the same vertical as Real's
              Deposit/Withdraw buttons. */}
          <div className="mt-auto pt-3" onClick={(e) => e.stopPropagation()}>
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
          "rounded-xl border bg-[#161b22] p-5 transition-all flex flex-col items-stretch justify-start",
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
            <div className="col-span-4">{t.portfolio.market}</div>
            <div className="col-span-2 text-right">Avg → Now</div>
            <div className="col-span-1 text-right">Traded</div>
            <div className="col-span-1 text-right">To Win</div>
            <div className="col-span-2 text-right">Value</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {realPositions.length === 0 && pendingPositions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#484f58]">No real positions yet</p>
              <p className="text-xs text-[#484f58] mt-1">
                Place a trade on the <Link href="/sports" className="text-[#58a6ff] hover:underline">Sports page</Link> to see positions here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {/* Skeleton rows for trades that just settled onchain but
                  haven't appeared in /positions yet. The shimmer pulse
                  reassures the user the trade is in-flight. */}
              {pendingPositions.map((p) => (
                <PendingPositionRow key={p.tokenId} pending={p} />
              ))}
              {realPositions.map((pos) => {
                const ext = pos as typeof pos & { _curPrice?: number; _cashPnl?: number; _percentPnl?: number; _currentValue?: number };
                const hasPoly = ext._curPrice !== undefined;
                const live = livePrices[pos.marketId];
                const livePrice = hasPoly ? ext._curPrice! : (live ? (pos.outcome === "Yes" ? live.yesPrice : live.noPrice) : pos.avgPrice);
                const value = hasPoly && ext._currentValue !== undefined ? ext._currentValue : pos.shares * livePrice;
                const pnl = hasPoly && ext._cashPnl !== undefined ? ext._cashPnl : (livePrice - pos.avgPrice) * pos.shares;
                const pnlPct = hasPoly && ext._percentPnl !== undefined ? ext._percentPnl : (pos.avgPrice > 0 ? ((livePrice - pos.avgPrice) / pos.avgPrice) * 100 : 0);
                const isClosing = closingPos === pos.id;
                const result = closeResult?.id === pos.id ? closeResult : null;
                // Close has been submitted and (usually) matched by the CLOB,
                // but settlement is still in-flight. Dim the row so the user
                // knows it's on its way out and doesn't try to close it again.
                const settling = !!(result?.ok && result.txHashes && result.txHashes.length > 0);

                return (
                  <div key={pos.id} className={cn(settling && "opacity-60")}>
                    <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors">
                      {/* Market + outcome pill + shares label (Polymarket layout).
                          Title is a link to the game detail page on our site —
                          powered by slug lookup since /positions doesn't give
                          us an eventId. Falls back to a plain title when there's
                          no slug. */}
                      <div className="col-span-4 min-w-0">
                        {pos.eventSlug ? (
                          <Link
                            href={`/sports/game?slug=${encodeURIComponent(pos.eventSlug)}`}
                            className="group inline-block max-w-full"
                          >
                            <span className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1 group-hover:text-[#58a6ff] group-hover:underline transition-colors">
                              {pos.marketQuestion}
                            </span>
                          </Link>
                        ) : (
                          <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pos.marketQuestion}</p>
                        )}
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <span className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded",
                            pos.outcome === "Yes" ? "bg-[#3fb950]/15 text-[#3fb950]" :
                            pos.outcome === "No"  ? "bg-[#f85149]/15 text-[#f85149]" :
                                                     "bg-[#58a6ff]/15 text-[#58a6ff]"
                          )}>
                            {pos.outcome} {Math.round(pos.avgPrice * 100)}¢
                          </span>
                          <span className="text-[10px] text-[#484f58] tabular-nums">{pos.shares.toFixed(1)} shares</span>
                        </div>
                      </div>
                      {/* AVG → NOW */}
                      <div className="col-span-2 text-right">
                        <span className="text-xs text-[#768390] tabular-nums">{Math.round(pos.avgPrice * 100)}¢</span>
                        <span className="text-[10px] text-[#484f58] mx-0.5">→</span>
                        <span className={cn("text-xs font-medium tabular-nums", (hasPoly || live) ? "text-[#e6edf3]" : "text-[#484f58]")}>
                          {Math.round(livePrice * 100)}¢
                        </span>
                      </div>
                      {/* TRADED = cost basis (shares × avgPrice) */}
                      <div className="col-span-1 text-right">
                        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{formatUsd(pos.shares * pos.avgPrice)}</span>
                      </div>
                      {/* TO WIN = total payout if YES resolves (each share = $1) */}
                      <div className="col-span-1 text-right">
                        <span className="text-xs text-[#3fb950] tabular-nums font-medium">{formatUsd(pos.shares)}</span>
                      </div>
                      {/* VALUE = current mark, with P&L and % underneath */}
                      <div className="col-span-2 text-right">
                        <span className="text-xs text-[#e6edf3] tabular-nums font-semibold">{formatUsd(value)}</span>
                        <div className={cn("text-[10px] tabular-nums leading-tight", pnl >= 0 ? "text-[#3fb950]" : "text-[#f85149]")}>
                          {pnl >= 0 ? "+" : ""}{formatUsd(pnl)} <span className="opacity-60">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
                        </div>
                      </div>
                      {/* ACTION = Sell button that opens the Polymarket-style modal */}
                      <div className="col-span-2 text-right">
                        <button
                          disabled={isClosing || settling}
                          onClick={() => {
                            if (!pos.clobTokenId) {
                              console.error("[Sell] No tokenId for position", pos.id);
                              setCloseResult({ id: pos.id, msg: "No token ID — can't sell", ok: false });
                              return;
                            }
                            setSellingPos({
                              id: pos.id,
                              tokenId: pos.clobTokenId,
                              marketQuestion: pos.marketQuestion,
                              outcome: pos.outcome,
                              shares: pos.shares,
                              avgPrice: pos.avgPrice,
                              currentPrice: livePrice,
                              eventSlug: pos.eventSlug,
                            });
                          }}
                          className={cn(
                            "px-4 py-1.5 rounded text-xs font-semibold transition-colors",
                            isClosing || settling
                              ? "bg-[#21262d] text-[#484f58] cursor-wait"
                              : "bg-[#58a6ff] text-white hover:bg-[#4d8fea]"
                          )}
                        >
                          {isClosing ? "Selling…" : settling ? "Settling…" : "Sell"}
                        </button>
                      </div>
                    </div>
                    {/* Close result — always shows a settling indicator on
                        success, even when the CLOB response didn't include
                        tx hashes. All side-effects (addClosedLocal,
                        addPendingActivity, /positions refetch cadence)
                        already fire inside executeSell, so this block is
                        purely presentational now. */}
                    {result && (
                      <div className="px-4 py-2 bg-[#0d1117] border-t border-[#21262d] space-y-2">
                        <p className={cn("text-xs font-medium", result.ok ? "text-[#3fb950]" : "text-[#f85149]")}>{result.msg}</p>
                        {result.ok && result.txHashes && result.txHashes.length > 0 ? (
                          <TradeProgress txHashes={result.txHashes} label="Settling your close…" />
                        ) : result.ok ? (
                          // Fallback settling indicator for the no-hashes path.
                          <div className="rounded-lg px-3 py-2 text-xs border bg-[#58a6ff]/10 border-[#58a6ff]/30 text-[#58a6ff] flex items-center gap-2">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin flex-shrink-0">
                              <path d="M21 12a9 9 0 1 1-6.2-8.55" />
                            </svg>
                            <span>Settling your close… Polymarket will reflect this shortly.</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sell slider modal — opened by Sell buttons on real position rows.
          Shares all the closedLocally / TradeProgress plumbing via executeSell. */}
      {sellingPos && (
        <SellPositionModal
          open={!!sellingPos}
          onClose={() => { if (!placingOrder) setSellingPos(null); }}
          outcomeName={sellingPos.outcome}
          marketTitle={sellingPos.marketQuestion}
          shares={sellingPos.shares}
          avgPrice={sellingPos.avgPrice}
          currentPrice={sellingPos.currentPrice}
          placing={placingOrder || closingPos === sellingPos.id}
          marketHref={sellingPos.eventSlug ? `/sports/game?slug=${encodeURIComponent(sellingPos.eventSlug)}` : undefined}
          onCashOut={(sharesToSell) =>
            executeSell({
              posId: sellingPos.id,
              tokenId: sellingPos.tokenId,
              shares: sharesToSell,
              totalShares: sellingPos.shares,
              marketQuestion: sellingPos.marketQuestion,
              price: sellingPos.currentPrice,
            })
          }
        />
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

      {/* History Tab — Real */}
      {tab === "history" && portfolioMode === "real" && (
        <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] text-[#484f58] uppercase tracking-wider border-b border-[#21262d]">
            <div className="col-span-1">Side</div>
            <div className="col-span-4">Market</div>
            <div className="col-span-2 text-right">Shares</div>
            <div className="col-span-2 text-right">Price / Total</div>
            <div className="col-span-2 text-right">When</div>
            <div className="col-span-1 text-right">Tx</div>
          </div>
          {(!polyActivity || polyActivity.length === 0) && pendingActivity.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📜</div>
              <p className="text-sm font-medium text-[#e6edf3]">No trades yet</p>
              <p className="text-xs text-[#484f58] mt-1">
                Place a trade on the <Link href="/sports" className="text-[#58a6ff] hover:underline">Sports page</Link> to see history here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {/* Pending in-flight trades — shown above the real list with a
                  shimmer and "Settling onchain…" label until /activity
                  returns the matching tx hash. */}
              {pendingActivity.map((p) => (
                <PendingActivityRow key={p.txHash} pending={p} />
              ))}
              {(polyActivity || []).map((a, i) => {
                const when = new Date(a.timestamp * 1000);
                const elapsed = Date.now() - a.timestamp * 1000;
                const hours = elapsed / 3600000;
                const whenLabel =
                  elapsed < 60000 ? "just now" :
                  elapsed < 3600000 ? `${Math.floor(elapsed / 60000)}m ago` :
                  hours < 24 ? `${Math.floor(hours)}h ago` :
                  when.toLocaleDateString();
                return (
                  <div
                    key={`${a.transactionHash}-${i}`}
                    className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[#1c2128]/50 transition-colors"
                  >
                    <div className="col-span-1">
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded",
                        a.side === "BUY" ? "bg-[#3fb950]/15 text-[#3fb950]" : "bg-[#f85149]/15 text-[#f85149]"
                      )}>
                        {a.side}
                      </span>
                    </div>
                    <div className="col-span-4">
                      <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{a.title}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{a.size.toFixed(2)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{Math.round(a.price * 100)}¢</span>
                      <span className="text-[10px] text-[#484f58] ml-1 tabular-nums">{formatUsd(a.usdcSize)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-[11px] text-[#768390] tabular-nums">{whenLabel}</span>
                    </div>
                    <div className="col-span-1 text-right">
                      <a
                        href={`https://polygonscan.com/tx/${a.transactionHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`View ${a.transactionHash.slice(0, 10)}… on Polygonscan`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-[#58a6ff] bg-[#58a6ff]/10 hover:bg-[#58a6ff]/20 transition-colors tabular-nums"
                      >
                        {a.transactionHash.slice(0, 6)}
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 17L17 7M10 7h7v7" />
                        </svg>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

/**
 * Skeleton row for a trade that confirmed onchain but whose position
 * hasn't yet appeared in Polymarket's /positions data-api (10-30s lag).
 * Matches the grid layout of real position rows so the transition to the
 * real row is seamless. Animated shimmer signals "in flight".
 */
function PendingPositionRow({ pending }: { pending: PendingPosition }) {
  const cost = pending.shares * pending.avgPrice;
  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center animate-pulse">
      <div className="col-span-3">
        <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pending.marketTitle}</p>
        <p className="text-[10px] text-[#484f58] mt-0.5 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#58a6ff] animate-ping" />
          Arriving…
        </p>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-xs text-[#768390] tabular-nums">{Math.round(pending.avgPrice * 100)}¢</span>
        <span className="text-[10px] text-[#484f58] mx-0.5">→</span>
        <span className="text-xs text-[#484f58] tabular-nums">…</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pending.shares.toFixed(2)}</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-xs text-[#484f58] tabular-nums">pending</span>
      </div>
      <div className="col-span-1 text-right">
        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">${cost.toFixed(2)}</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-[#58a6ff] bg-[#58a6ff]/10 border border-[#58a6ff]/25 px-2 py-1 rounded">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.2-8.55" />
          </svg>
          Settling
        </span>
      </div>
    </div>
  );
}

/**
 * Skeleton history row for an in-flight trade — the tx confirmed onchain
 * but Polymarket's /activity data-api hasn't caught up. Matches the real
 * history row's 12-col layout so swap-in is seamless when /activity
 * returns the entry.
 */
function PendingActivityRow({ pending }: { pending: PendingActivity }) {
  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center animate-pulse">
      <div className="col-span-1">
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded",
          pending.side === "BUY" ? "bg-[#3fb950]/15 text-[#3fb950]" : "bg-[#f85149]/15 text-[#f85149]"
        )}>
          {pending.side}
        </span>
      </div>
      <div className="col-span-4">
        <p className="text-[13px] text-[#e6edf3] font-medium leading-snug line-clamp-1">{pending.marketTitle}</p>
        <p className="text-[10px] text-[#58a6ff] mt-0.5 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#58a6ff] animate-ping" />
          Settling onchain…
        </p>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{pending.shares.toFixed(2)}</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-xs text-[#e6edf3] tabular-nums font-medium">{Math.round(pending.price * 100)}¢</span>
        <span className="text-[10px] text-[#484f58] ml-1 tabular-nums">${pending.usdcSize.toFixed(2)}</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-[11px] text-[#768390] tabular-nums">just now</span>
      </div>
      <div className="col-span-1 text-right">
        <a
          href={`https://polygonscan.com/tx/${pending.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`View ${pending.txHash.slice(0, 10)}… on Polygonscan`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-[#58a6ff] bg-[#58a6ff]/10 hover:bg-[#58a6ff]/20 transition-colors tabular-nums"
        >
          {pending.txHash.slice(0, 6)}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17L17 7M10 7h7v7" />
          </svg>
        </a>
      </div>
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
