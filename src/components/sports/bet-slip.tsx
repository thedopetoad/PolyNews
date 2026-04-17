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
import { BetConfirmModal } from "@/components/sports/bet-confirm-modal";
import { addPendingPosition } from "@/lib/pending-positions";
import { addPendingActivity } from "@/lib/pending-activity";
import { formatOdds } from "@/lib/odds-format";
import { useOddsFormat } from "@/stores/use-odds-format";
import { useUserPosition } from "@/hooks/use-user-position";
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
  /**
   * Fires when the user clicks a different outcome chip inside the slip.
   * The parent uses this to sync its own outer "odds" buttons with the
   * slip's selection so the highlighted market card always matches
   * what the bet slip is about to trade.
   */
  onOutcomeChange?: (idx: number) => void;
  negRisk?: boolean;
}

function abbrev(name: string): string {
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words[words.length - 1].slice(0, 4).toUpperCase();
}

const QUICK_AMOUNTS = [1, 5, 10, 100];

export function BetSlip({ eventTitle, eventSlug: _eventSlug, eventEndDate: _eventEndDate, marketId, marketQuestion: _marketQuestion, outcomes, initialOutcomeIdx = 0, onOutcomeChange, negRisk }: BetSlipProps) {
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

  // Look up the user's holdings for all outcomes in this market — drives
  // the SELL tab's "Shares available" indicator and the 25/50/Max chips.
  const { data: positionLookup } = useUserPosition(proxyAddress);

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [selectedOutcome, setSelectedOutcome] = useState<number>(initialOutcomeIdx);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ success: boolean; msg: string; txHashes?: string[]; side?: "BUY" | "SELL" } | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
        // estimateSlippage wants USDC for BUY, shares for SELL — and now
        // that's exactly what amountNumForSlip already means (BUY input is
        // USDC, SELL input is shares), no conversion needed.
        setSlippage(estimateSlippage(book, side, amountNumForSlip));
      })
      .catch(() => { if (!cancelled) setSlippage(null); });
    return () => { cancelled = true; };
  }, [selectedTokenId, amountNumForSlip, side]);

  if (outcomes.length === 0) return null;

  // Use live prices when available, fallback to initial price from card click
  const liveOutcomes = outcomes.map((o) => ({
    ...o,
    price: livePrices[o.tokenId] ?? o.price,
  }));

  const selected = liveOutcomes[selectedOutcome];
  const amountNum = parseFloat(amount) || 0;

  // The input means different things on each side, Polymarket-style:
  //   - BUY:  amountNum = USDC the user wants to spend.
  //   - SELL: amountNum = shares the user wants to sell.
  // Keeping them as separate semantics ends the "is $1 a dollar or a
  // share?" ambiguity — just like polymarket.com.
  const heldShares = selected && positionLookup?.byTokenId[selected.tokenId]?.size || 0;

  // Effective fill price: use slippage-walked avg if we have it (more honest
  // than mid), otherwise mid. This powers both the share count and the
  // "to win" profit so the numbers the user sees are what they'll actually get.
  const effectivePrice = slippage?.filled ? slippage.avgFillPrice : selectedPrice;
  // For BUY: convert USDC → shares. For SELL: the input IS shares.
  const shares = side === "BUY"
    ? (selected && amountNum > 0 ? amountNum / effectivePrice : 0)
    : amountNum;
  // Proceeds in USDC when SELLing (shares × price); identical to cost in BUY.
  const proceedsUsd = side === "SELL" ? shares * effectivePrice : amountNum;
  const toWin = side === "BUY" ? shares - amountNum : 0; // profit if YES resolves
  const insufficientBalance = side === "BUY" && amountNum > 0 && amountNum > usdcBal;
  const insufficientShares = side === "SELL" && shares > 0 && shares > heldShares + 0.01;

  const placeTrade = async () => {
    if (!selected || amountNum <= 0) return;
    setResult(null);
    // placeOrder always takes the CLOB-native amount:
    //   BUY  → USDC to spend
    //   SELL → shares to sell
    const orderAmount = amountNum;
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
      // Fire side-effects immediately on success instead of waiting for
      // TradeProgress.onConfirmed. The CLOB response doesn't always
      // include tx hashes — when it doesn't, TradeProgress wouldn't
      // render and the pending-position + pending-activity entries
      // would never be written, leaving the portfolio/history stale
      // until a natural refetch.
      if (side === "BUY" && selected.tokenId) {
        addPendingPosition({
          tokenId: selected.tokenId,
          marketTitle: eventTitle,
          outcomeName: selected.name,
          shares,
          avgPrice: effectivePrice,
          side: "BUY",
        });
      }
      if (res.transactionHashes && res.transactionHashes[0]) {
        addPendingActivity({
          txHash: res.transactionHashes[0],
          side,
          marketTitle: eventTitle,
          outcomeName: selected.name,
          shares,
          price: effectivePrice,
          usdcSize: side === "SELL" ? proceedsUsd : amountNum,
        });
      }
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

      {/* Buy / Sell tabs — reset amount on side flip because the input's
          unit changes (USDC ↔ shares), and keeping a stale number across
          is a footgun. */}
      <div className="flex gap-0 bg-[#0d1117] rounded-lg p-0.5">
        <button
          onClick={() => { setSide("BUY"); setAmount(""); setResult(null); }}
          className={cn(
            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors",
            side === "BUY" ? "bg-[#238636] text-white" : "text-[#768390] hover:text-white"
          )}
        >
          {t.betSlip.buy}
        </button>
        <button
          onClick={() => { setSide("SELL"); setAmount(""); setResult(null); }}
          className={cn(
            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors",
            side === "SELL" ? "bg-[#f85149] text-white" : "text-[#768390] hover:text-white"
          )}
        >
          {t.betSlip.sell}
        </button>
      </div>

      {/* Outcome buttons — with held-shares label underneath on SELL tab,
          matching polymarket.com's cash-out flow. */}
      <div className="flex gap-2">
        {liveOutcomes.map((o, i) => {
          const held = positionLookup?.byTokenId[o.tokenId]?.size || 0;
          return (
            <button
              key={o.name}
              onClick={() => { setSelectedOutcome(i); setResult(null); setAmount(""); onOutcomeChange?.(i); }}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-semibold tabular-nums transition-all border flex flex-col items-center",
                selectedOutcome === i
                  ? "bg-[#238636]/20 border-[#3fb950] text-[#3fb950]"
                  : "bg-[#0d1117] border-[#21262d] text-[#e6edf3] hover:border-[#30363d]"
              )}
            >
              <span>{abbrev(o.name)} {formatOdds(o.price, format)}</span>
              {side === "SELL" && held > 0 && (
                <span className="text-[10px] font-normal text-[#3fb950] mt-0.5">{held.toFixed(2)} shares</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Amount input — swaps semantics by side.
          BUY  → $ prefix, input is USDC to spend.
          SELL → "Shares" label, input is share count, no $ prefix. */}
      <div>
        <label className="text-[10px] text-[#484f58] uppercase tracking-wider block mb-1">
          {side === "BUY" ? t.betSlip.amount : "Shares"}
        </label>
        <div className="relative">
          {side === "BUY" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#484f58]">$</span>
          )}
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
            className={cn(
              "w-full bg-[#0d1117] border border-[#30363d] rounded-lg pr-3 py-2.5 text-lg text-white placeholder-[#30363d] focus:border-[#58a6ff] outline-none tabular-nums font-semibold",
              side === "BUY" ? "pl-7" : "pl-3"
            )}
            min={side === "BUY" ? "0.1" : "0.01"}
            step={side === "BUY" ? "0.01" : "0.01"}
          />
        </div>
      </div>

      {/* Quick amount buttons — vary by side:
          BUY  → +$1 / +$5 / +$10 / +$100 / Max-USDC
          SELL → 25% / 50% / Max of held shares (disabled at 0 shares) */}
      {side === "BUY" ? (
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
      ) : (
        <div className="flex gap-1.5">
          {[0.25, 0.5].map((frac) => (
            <button
              key={frac}
              disabled={heldShares <= 0}
              onClick={() => { setAmount((heldShares * frac).toFixed(2)); setResult(null); }}
              className={cn(
                "flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors tabular-nums",
                heldShares > 0
                  ? "bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
                  : "bg-[#21262d]/50 text-[#484f58] cursor-not-allowed"
              )}
            >
              {Math.round(frac * 100)}%
            </button>
          ))}
          <button
            disabled={heldShares <= 0}
            onClick={() => { setAmount(heldShares.toFixed(4)); setResult(null); }}
            className={cn(
              "flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors",
              heldShares > 0
                ? "bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d]"
                : "bg-[#21262d]/50 text-[#484f58] cursor-not-allowed"
            )}
          >
            Max
          </button>
        </div>
      )}

      {/* Summary rows: Balance/Shares/To win on BUY, Holdings/Receive on SELL. */}
      <div className="space-y-1 px-1">
        {side === "BUY" ? (
          <div className="flex justify-between text-xs text-[#768390]">
            <span>Balance</span>
            <span className="text-[#e6edf3] font-medium tabular-nums">${usdcBal.toFixed(2)} USDC</span>
          </div>
        ) : (
          <div className="flex justify-between text-xs text-[#768390]">
            <span>Holdings</span>
            <span className="text-[#e6edf3] font-medium tabular-nums">{heldShares.toFixed(2)} shares</span>
          </div>
        )}
        {amountNum > 0 && selected && side === "BUY" && (
          <>
            <div className="flex justify-between text-xs text-[#768390]">
              <span>Shares</span>
              <span className="text-[#e6edf3] font-medium tabular-nums">{shares.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-[#768390]">
              <span>To win</span>
              <span className="text-[#3fb950] font-semibold tabular-nums">
                ${toWin.toFixed(2)}
                <span className="text-[10px] text-[#3fb950]/60 ml-1 font-normal">(+{((toWin / amountNum) * 100).toFixed(0)}%)</span>
              </span>
            </div>
          </>
        )}
        {amountNum > 0 && selected && side === "SELL" && (
          <div className="flex justify-between text-xs text-[#768390]">
            <span>Receive</span>
            <span className="text-[#3fb950] font-semibold tabular-nums">${proceedsUsd.toFixed(2)}</span>
          </div>
        )}
      </div>

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

      {/* Insufficient balance warning (BUY) */}
      {insufficientBalance && (
        <p className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-1.5 rounded">
          {t.betSlip.insufficientUsdc}.{" "}
          <button onClick={() => setDepositOpen(true)} className="text-[#58a6ff] hover:underline">
            {t.portfolio.depositUsdc} &rarr;
          </button>
          <BridgeDepositModal open={depositOpen} onOpenChange={setDepositOpen} recipientAddress={address} />
        </p>
      )}

      {/* Insufficient shares warning (SELL) */}
      {insufficientShares && (
        <p className="text-[10px] text-[#d29922] bg-[#d29922]/10 px-2 py-1.5 rounded">
          You only have {heldShares.toFixed(2)} shares of {selected?.name} to sell.
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
        disabled={placing || amountNum <= 0 || insufficientShares}
        className={cn(
          "w-full py-3 rounded-lg text-sm font-bold transition-all",
          placing
            ? "bg-[#21262d] text-[#484f58] cursor-wait"
            : amountNum <= 0
              ? "bg-[#21262d] text-[#484f58]"
              : !tradingEnabled && setupStatus !== "checking"
                ? "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
                : insufficientBalance || insufficientShares
                  ? "bg-[#d29922]/20 text-[#d29922] hover:bg-[#d29922]/30 active:scale-[0.98]"
                  : side === "SELL"
                    ? "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
                    : "bg-[#238636] text-white hover:bg-[#2ea043] active:scale-[0.98]"
        )}
      >
        {placing
          ? t.betSlip.confirmingInWallet
          : amountNum <= 0
            ? side === "SELL" ? "Enter shares" : "Enter an amount"
            : !tradingEnabled && setupStatus !== "checking"
              ? "🔐 Enable Trading to continue"
              : insufficientBalance
                ? t.betSlip.insufficientUsdc
                : insufficientShares
                  ? `Only ${heldShares.toFixed(2)} shares held`
                  : side === "BUY"
                    ? `Buy $${amountNum.toFixed(2)} ${selected?.name || ""}`
                    : `Sell ${selected?.name || ""}`}
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
        costUsd={side === "BUY" ? amountNum : proceedsUsd}
        avgPrice={effectivePrice}
        slippageWarn={slippageWarnMsg}
        placing={placing}
      />

      {/* Result / Error — settling indicator always shows on success,
          even when CLOB didn't return tx hashes. Side-effects
          (addPendingPosition / addPendingActivity) already fired in
          placeTrade, so this block is purely presentational. */}
      {result && result.success && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-center text-[#3fb950]">{result.msg}</p>
          {result.txHashes && result.txHashes.length > 0 ? (
            <TradeProgress
              txHashes={result.txHashes}
              label={`Settling your ${result.side === "BUY" ? "buy" : "sell"}…`}
            />
          ) : (
            // Fallback when CLOB omitted transactionsHashes.
            <div className="rounded-lg px-3 py-2 text-xs border bg-[#58a6ff]/10 border-[#58a6ff]/30 text-[#58a6ff] flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin flex-shrink-0">
                <path d="M21 12a9 9 0 1 1-6.2-8.55" />
              </svg>
              <span>Settling your {result.side === "BUY" ? "buy" : "sell"}… Polymarket will reflect this shortly.</span>
            </div>
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
