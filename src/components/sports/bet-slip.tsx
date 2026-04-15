"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { usePolymarketTrade } from "@/hooks/use-polymarket-trade";
import { LoginButton } from "@/components/layout/login-modal";
import { BridgeDepositModal } from "@/components/portfolio/bridge-deposit-modal";
import { useT } from "@/lib/i18n";
import { useSwitchChain, useBalance } from "wagmi";
import { polygon } from "wagmi/chains";

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
  negRisk?: boolean;
}

function abbrev(name: string): string {
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words[words.length - 1].slice(0, 4).toUpperCase();
}

const QUICK_AMOUNTS = [1, 5, 10, 100];

export function BetSlip({ eventTitle, eventSlug, eventEndDate, marketId, marketQuestion, outcomes, negRisk }: BetSlipProps) {
  const { address, isConnected } = useUser();
  const { placeOrder, placing, error: tradeError, canTrade, isOnPolygon } = usePolymarketTrade();
  const { switchChain } = useSwitchChain();

  // Always read USDC balance from Polygon regardless of which chain the
  // wallet is currently connected to — funds live on Polygon whether the
  // user's MetaMask/Phantom is on ETH mainnet, Solana, or anywhere else.
  const { data: usdcBalance } = useBalance({
    address: address as `0x${string}` | undefined,
    token: USDC_ADDRESS,
    chainId: polygon.id,
    query: { enabled: !!address },
  });
  const usdcBal = usdcBalance ? parseFloat(usdcBalance.formatted) : 0;
  const { t } = useT();

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [selectedOutcome, setSelectedOutcome] = useState<number>(0);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  if (outcomes.length === 0) return null;

  const selected = outcomes[selectedOutcome];
  const amountNum = parseFloat(amount) || 0;
  const shares = selected && amountNum > 0 ? amountNum / selected.price : 0;
  const payout = shares;
  const insufficientBalance = amountNum > 0 && amountNum > usdcBal;

  const handleTrade = async () => {
    if (!selected || amountNum <= 0) return;
    if (insufficientBalance) {
      setResult({ success: false, msg: `Insufficient USDC balance. You have $${usdcBal.toFixed(2)}. Deposit USDC.e on Polygon to trade.` });
      return;
    }
    setResult(null);
    const res = await placeOrder({
      tokenId: selected.tokenId,
      side,
      amount: amountNum,
      price: selected.price,
      negRisk,
    });
    if (res.success) {
      setResult({ success: true, msg: `Order filled! ${shares.toFixed(1)} shares` });
      setAmount("");
    } else {
      setResult({ success: false, msg: res.error || "Order failed" });
    }
  };

  if (!address) {
    return (
      <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-[#768390] text-center">{t.login.connectWalletToBet}</p>
        <div className="flex justify-center"><LoginButton /></div>
      </div>
    );
  }

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
        {outcomes.map((o, i) => (
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
            {abbrev(o.name)} {Math.round(o.price * 100)}¢
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

      {/* Balance + payout */}
      <div className="flex justify-between text-xs text-[#768390] px-1">
        <span>{t.betSlip.balanceLabel}: <span className="text-[#e6edf3] font-medium">${usdcBal.toFixed(2)} USDC</span></span>
        {amountNum > 0 && selected && (
          <span>{t.betSlip.payout}: <span className="text-[#3fb950] font-medium">${payout.toFixed(2)}</span></span>
        )}
      </div>

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

      {/* Trade button — auto-switches to Polygon if needed */}
      {!isOnPolygon ? (
        <button
          onClick={() => switchChain({ chainId: polygon.id })}
          className="w-full py-3 rounded-lg text-sm font-bold bg-[#8247e5] text-white hover:bg-[#7038d4] transition-all active:scale-[0.98]"
        >
          Switch to Polygon to trade
        </button>
      ) : (
        <button
          onClick={handleTrade}
          disabled={placing || amountNum <= 0 || !canTrade || insufficientBalance}
          className={cn(
            "w-full py-3 rounded-lg text-sm font-bold transition-all",
            placing
              ? "bg-[#21262d] text-[#484f58] cursor-wait"
              : insufficientBalance
                ? "bg-[#d29922]/20 text-[#d29922] cursor-not-allowed"
                : amountNum > 0
                  ? "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
                  : "bg-[#21262d] text-[#484f58] cursor-not-allowed"
          )}
        >
          {placing ? t.betSlip.confirmingInWallet : insufficientBalance ? t.betSlip.insufficientUsdc : t.betSlip.trade}
        </button>
      )}

      {/* Result / Error */}
      {result && (
        <p className={cn("text-xs font-medium text-center", result.success ? "text-[#3fb950]" : "text-[#f85149]")}>
          {result.msg}
        </p>
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
