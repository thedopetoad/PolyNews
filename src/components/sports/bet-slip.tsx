"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { usePolymarketTrade } from "@/hooks/use-polymarket-trade";
import { usePolymarketSetup } from "@/hooks/use-polymarket-setup";
import { LoginButton } from "@/components/layout/login-modal";
import { BridgeDepositModal } from "@/components/portfolio/bridge-deposit-modal";
import { EnableTradingModal } from "@/components/sports/enable-trading-modal";
import { TradeProgress } from "@/components/sports/trade-progress";
import { OrderBook } from "@/components/sports/order-book";
import { BetConfirmModal } from "@/components/sports/bet-confirm-modal";
import { formatOdds } from "@/lib/odds-format";
import { useOddsFormat } from "@/stores/use-odds-format";
import { useT } from "@/lib/i18n";
import { useSwitchChain, useBalance } from "wagmi";
import { polygon } from "wagmi/chains";
import { deriveProxyAddress } from "@/lib/relay";
import { estimateSlippage, SlippageEstimate } from "@/lib/slippage";

// USDC.e on Polygon — required for Polymarket CLOB (their CLOB uses USDC.e as
// collateral, orders against native USDC get rejected).
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;

interface BetOutcome {
  name: string;
  price: number;
  tokenId: string;
}

interface BetSlipProps {
  eventTitle: string;
  eventSlug: string;
  eventEndDate: string;
  marketId: string;
  marketQuestion: string;
  outcomes: BetOutcome[];
  /**
   * Which outcome index the user clicked on the game card. Pre-selects
   * that outcome in the slip so clicking "ORIO" on the card shows ORIO
   * in the slip instead of defaulting to index 0. Syncs on change, so
   * clicking a different card outcome flips the slip to match.
   */
  initialOutcomeIdx?: number;
  negRisk?: boolean;
}

function abbrev(name: string): string {
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words[words.length - 1].slice(0, 4).toUpperCase();
}

const QUICK_AMOUNTS = [1, 5, 10, 100];

export function BetSlip({ eventTitle: _eventTitle, eventSlug: _eventSlug, eventEndDate: _eventEndDate, marketId, marketQuestion: _marketQuestion, outcomes, initialOutcomeIdx = 0, negRisk }: BetSlipProps) {
  const { address } = useUser();
  const { placeOrder, placing, error: tradeError, isOnPolygon } = usePolymarketTrade();
  const { status: setupStatus, isReady: tradingEnabled, refresh: refreshSetup } = usePolymarketSetup();
  const { switchChain } = useSwitchChain();
  const { format } = useOddsFormat();

  // Funds live in the Polymarket proxy wallet (derived from the EOA), not
  // in the EOA itself. Read from both and sum — matches the portfolio page.
  const proxyAddress = address ? deriveProxyAddress(address) : undefined;
  const { data: proxyUsdcBalance } = useBalance({
    address: proxyAddress as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: polygon.id,
    query: { enabled: !!proxyAddress },
  });
  const { data: eoaUsdcBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: polygon.id,
    query: { enabled: !!address },
  });
  const proxyBal = proxyUsdcBalance ? parseFloat(proxyUsdcBalance.formatted) : 0;
  const eoaBal = eoaUsdcBalance ? parseFloat(eoaUsdcBalance.formatted) : 0;
  const usdcBal = proxyBal + eoaBal;
  const { t } = useT();

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [selectedOutcome, setSelectedOutcome] = useState<number>(initialOutcomeIdx);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ success: boolean; msg: string; txHashes?: string[]; side?: "BUY" | "SELL" } | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showBook, setShowBook] = useState(false);

  // Sync selection with parent — card click on a different outcome should
  // flip the slip. Also resets on marketId change (a different row / market
  // in the same section shouldn't carry stale selection or result state).
  useEffect(() => {
    setSelectedOutcome(initialOutcomeIdx);
    setResult(null);
  }, [initialOutcomeIdx, marketId]);

  // Live-refresh prices every 5s so the bet slip always shows current odds
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const refreshPrices = useCallback(async () => {
    for (const o of outcomes) {
      if (!o.tokenId) continue;
      try {
        const res = await fetch(`/api/polymarket/prices?token_id=${o.tokenId}`);
        if (!res.ok) continue;
        const data = await res.json();
        const mid = parseFloat(data.mid);
        if (mid > 0 && mid < 1) {
          setLivePrices((prev) => ({ ...prev, [o.tokenId]: mid }));
        }
      } catch {}
    }
  }, [outcomes]);

  useEffect(() => {
    refreshPrices();
    const interval = setInterval(refreshPrices, 5000);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  // Fetch orderbook for the selected outcome to show slippage estimate
  const [slippage, setSlippage] = useState<SlippageEstimate | null>(null);
  const amountNumForSlip = parseFloat(amount) || 0;
  const selectedTokenId = outcomes[selectedOutcome]?.tokenId;
  const selectedPrice = outcomes[selectedOutcome]?.price ?? 0.5;
  useEffect(() => {
    if (!selectedTokenId || amountNumForSlip <= 0) {
      setSlippage(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/polymarket/book?token_id=${selectedTokenId}`)
      .then((r) => r.json())
      .then((book) => {
        if (cancelled) return;
        // For SELL, amount is shares; for BUY, amount is USDC
        const orderAmount = side === "SELL" ? amountNumForSlip / selectedPrice : amountNumForSlip;
        setSlippage(estimateSlippage(book, side, orderAmount));
      })
      .catch(() => { if (!cancelled) setSlippage(null); });
    return () => { cancelled = true; };
  }, [selectedTokenId, amountNumForSlip, side, selectedPrice]);

  if (outcomes.length === 0) return null;

  // Use live prices when available, fallback to initial price from card click
  const liveOutcomes = outcomes.map((o) => ({
    ...o,
    price: livePrices[o.tokenId] ?? o.price,
  }));

  const selected = liveOutcomes[selectedOutcome];
  const amountNum = parseFloat(amount) || 0;
  // Effective fill price: use slippage-walked avg if we have it (more honest
  // than mid), otherwise mid. This powers both the share count and the
  // "to win" profit so the numbers the user sees are what they'll actually get.
  const effectivePrice = slippage?.filled ? slippage.avgFillPrice : selectedPrice;
  const shares = selected && amountNum > 0 ? amountNum / effectivePrice : 0;
  const toWin = side === "BUY" ? shares - amountNum : 0; // profit if YES resolves
  const insufficientBalance = amountNum > 0 && amountNum > usdcBal;

  const placeTrade = async () => {
    if (!selected || amountNum <= 0) return;
    setResult(null);
    // For BUY, amount is USDC to spend. For SELL, amount is shares to sell.
    const orderAmount = side === "SELL" ? amountNum / selected.price : amountNum;
    const res = await placeOrder({
      tokenId: selected.tokenId,
      side,
      amount: orderAmount,
      price: selected.price,
      negRisk,
    });
    if (res.success) {
      setResult({
        success: true,
        msg: `${side === "BUY" ? "Bought" : "Sold"} ${shares.toFixed(2)} shares of ${selected.name}`,
        txHashes: res.transactionHashes,
        side,
      });
      setAmount("");
      setConfirmOpen(false);
    } else {
      setResult({ success: false, msg: res.error || "Order failed" });
      setConfirmOpen(false);
    }
  };

  const handleTradeClick = async () => {
    if (!selected || amountNum <= 0) return;
    // Auto-switch to Polygon if needed — no separate button required.
    if (!isOnPolygon) {
      try {
        await switchChain({ chainId: polygon.id });
        setResult({ success: false, msg: "Switched to Polygon — tap Trade again." });
        return;
      } catch {
        setResult({ success: false, msg: "Please switch to Polygon in your wallet." });
        return;
      }
    }
    if (insufficientBalance) {
      setResult({ success: false, msg: `Insufficient USDC balance. You have $${usdcBal.toFixed(2)}.` });
      return;
    }
    // Open confirm modal — actual placeOrder fires from its Confirm button.
    setConfirmOpen(true);
  };

  if (!address) {
    return (
      <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-[#768390] text-center">{t.login.connectWalletToBet}</p>
        <div className="flex justify-center"><LoginButton /></div>
      </div>
    );
  }

  const slippageWarnMsg =
    slippage && slippage.filled && slippage.warn
      ? `Expected fill ~${formatOdds(slippage.avgFillPrice, format)} (${slippage.slippagePct.toFixed(1)}% from best). Thin liquidity on this market.`
      : slippage && !slippage.filled && amountNum > 0
        ? "Not enough liquidity on the order book to fill this size."
        : null;

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Outcome name */}
      <p className="text-xs text-[#58a6ff] font-medium">{selected?.name}</p>

      {/* Buy / Sell tabs */}
      <div className="flex gap-0 bg-[#0d1117] rounded-lg p-0.5">
        <button
          onClick={() => setSide("BUY")}
          className={cn(
            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors",
            side === "BUY" ? "bg-[#238636] text-white" : "text-[#768390] hover:text-white"
          )}
        >
          {t.betSlip.buy}
        </button>
        <button
          onClick={() => setSide("SELL")}
          className={cn(
            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors",
            side === "SELL" ? "bg-[#f85149] text-white" : "text-[#768390] hover:text-white"
          )}
        >
          {t.betSlip.sell}
        </button>
      </div>

      {/* Outcome buttons */}
      <div className="flex gap-2">
        {liveOutcomes.map((o, i) => (
          <button
            key={o.name}
            onClick={() => { setSelectedOutcome(i); setResult(null); }}
            className={cn(
              "flex-1 py-2 rounded-lg text-xs font-semibold tabular-nums transition-all border",
              selectedOutcome === i
                ? "bg-[#238636]/20 border-[#3fb950] text-[#3fb950]"
                : "bg-[#0d1117] border-[#21262d] text-[#e6edf3] hover:border-[#30363d]"
            )}
          >
            {abbrev(o.name)} {formatOdds(o.price, format)}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div>
        <label className="text-[10px] text-[#484f58] uppercase tracking-wider block mb-1">{t.betSlip.amount}</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#484f58]">$</span>
          <input
            type="number"
            placeholder="0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setResult(null); }}
            onKeyDown={(e) => {
              // Enter submits — runs the same gate as clicking the trade button.
              if (e.key === "Enter" && amountNum > 0 && !placing) {
                if (!tradingEnabled && setupStatus !== "checking") setEnableOpen(true);
                else handleTradeClick();
              }
            }}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-7 pr-3 py-2.5 text-lg text-white placeholder-[#30363d] focus:border-[#58a6ff] outline-none tabular-nums font-semibold"
            min="0.1"
            step="0.01"
          />
        </div>
      </div>

      {/* Quick amount buttons */}
      <div className="flex gap-1.5">
        {QUICK_AMOUNTS.map((q) => (
          <button
            key={q}
            onClick={() => { setAmount(String((amountNum || 0) + q)); setResult(null); }}
            className="flex-1 py-1.5 rounded-md text-[11px] font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors tabular-nums"
          >
            +${q}
          </button>
        ))}
        <button
          onClick={() => { setAmount(String(Math.floor(usdcBal * 100) / 100)); setResult(null); }}
          className="flex-1 py-1.5 rounded-md text-[11px] font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors"
        >
          {t.betSlip.max}
        </button>
      </div>

      {/* Balance + Shares + To win (Polymarket-style break-out) */}
      <div className="space-y-1 px-1">
        <div className="flex justify-between text-xs text-[#768390]">
          <span>Balance</span>
          <span className="text-[#e6edf3] font-medium tabular-nums">${usdcBal.toFixed(2)} USDC</span>
        </div>
        {amountNum > 0 && selected && (
          <>
            <div className="flex justify-between text-xs text-[#768390]">
              <span>Shares</span>
              <span className="text-[#e6edf3] font-medium tabular-nums">{shares.toFixed(2)}</span>
            </div>
            {side === "BUY" && (
              <div className="flex justify-between text-xs text-[#768390]">
                <span>To win</span>
                <span className="text-[#3fb950] font-semibold tabular-nums">
                  ${toWin.toFixed(2)}
                  {amountNum > 0 && <span className="text-[10px] text-[#3fb950]/60 ml-1 font-normal">(+{((toWin / amountNum) * 100).toFixed(0)}%)</span>}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toggle: Show order book depth */}
      {selectedTokenId && (
        <button
          onClick={() => setShowBook((v) => !v)}
          className="w-full text-left text-[10px] text-[#58a6ff] hover:text-[#79c0ff] transition-colors flex items-center gap-1 px-1"
        >
          {showBook ? "▾ Hide order book" : "▸ Show order book"}
        </button>
      )}
      {showBook && selectedTokenId && (
        <OrderBook tokenId={selectedTokenId} side={side} />
      )}

      {/* Slippage warning */}
      {slippage && amountNum > 0 && !slippage.filled && (
        <p className="text-[10px] text-[#f85149] bg-[#f85149]/10 px-2 py-1.5 rounded">
          ⚠️ Not enough liquidity on the orderbook to fill this size. Try a smaller amount.
        </p>
      )}
      {slippage && slippage.filled && slippage.warn && (
        <p className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-1.5 rounded">
          ⚠️ High slippage: expected fill ~{formatOdds(slippage.avgFillPrice, format)} ({slippage.slippagePct.toFixed(1)}% from best price). Thin liquidity on this market.
        </p>
      )}

      {/* Insufficient balance warning */}
      {insufficientBalance && (
        <p className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-1.5 rounded">
          {t.betSlip.insufficientUsdc}.{" "}
          <button onClick={() => setDepositOpen(true)} className="text-[#58a6ff] hover:underline">
            {t.portfolio.depositUsdc} &rarr;
          </button>
          <BridgeDepositModal open={depositOpen} onOpenChange={setDepositOpen} recipientAddress={address} />
        </p>
      )}

      {/* Trade button — opens Enable Trading modal if needed, else the
          confirm modal, which in turn fires placeOrder. */}
      <button
        onClick={() => {
          if (!tradingEnabled && setupStatus !== "checking") {
            setEnableOpen(true);
            return;
          }
          handleTradeClick();
        }}
        disabled={placing || amountNum <= 0}
        className={cn(
          "w-full py-3 rounded-lg text-sm font-bold transition-all",
          placing
            ? "bg-[#21262d] text-[#484f58] cursor-wait"
            : amountNum <= 0
              ? "bg-[#21262d] text-[#484f58]"
              : !tradingEnabled && setupStatus !== "checking"
                ? "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
                : insufficientBalance
                  ? "bg-[#d29922]/20 text-[#d29922] hover:bg-[#d29922]/30 active:scale-[0.98]"
                  : "bg-[#238636] text-white hover:bg-[#2ea043] active:scale-[0.98]"
        )}
      >
        {placing
          ? t.betSlip.confirmingInWallet
          : amountNum <= 0
            ? "Enter an amount"
            : !tradingEnabled && setupStatus !== "checking"
              ? "🔐 Enable Trading to continue"
              : insufficientBalance
                ? t.betSlip.insufficientUsdc
                : side === "BUY"
                  ? `Buy $${amountNum.toFixed(2)} ${selected?.name || ""}`
                  : `Sell $${amountNum.toFixed(2)} ${selected?.name || ""}`}
      </button>
      <EnableTradingModal
        open={enableOpen}
        onOpenChange={setEnableOpen}
        onSuccess={refreshSetup}
      />
      <BetConfirmModal
        open={confirmOpen}
        onCancel={() => !placing && setConfirmOpen(false)}
        onConfirm={placeTrade}
        side={side}
        outcomeName={selected?.name || ""}
        shares={shares}
        costUsd={amountNum}
        avgPrice={effectivePrice}
        slippageWarn={slippageWarnMsg}
        placing={placing}
      />

      {/* Result / Error */}
      {result && result.success && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-center text-[#3fb950]">{result.msg}</p>
          {result.txHashes && result.txHashes.length > 0 && (
            <TradeProgress
              txHashes={result.txHashes}
              label={`Settling your ${result.side === "BUY" ? "buy" : "sell"}…`}
            />
          )}
        </div>
      )}
      {result && !result.success && (
        <p className="text-xs font-medium text-center text-[#f85149]">{result.msg}</p>
      )}
      {tradeError && !result && (
        <p className="text-xs text-[#f85149] text-center">{tradeError}</p>
      )}

      {/* Terms */}
      <p className="text-[9px] text-[#484f58] text-center">
        {t.betSlip.byTrading}{" "}
        <a href="https://polymarket.com/tos" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">{t.betSlip.termsOfUse}</a>
      </p>
    </div>
  );
}
