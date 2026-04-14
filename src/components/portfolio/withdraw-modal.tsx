"use client";

import Image from "next/image";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain, useSignTypedData } from "wagmi";
import { parseUnits } from "viem";
import { useAuthStore } from "@/stores/use-auth-store";
import { useEnsureWagmi } from "@/hooks/use-ensure-wagmi";
import {
  SUPPORTED_CHAINS,
  tokensForChain,
  getRelayQuote,
  submitRelayPermit,
  formatAmount,
  POLYGON_USDC,
  POLYGON_CHAIN_ID,
  type RelayQuote,
  type SupportedChain,
  type SupportedToken,
} from "@/lib/relay";

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** USDC.e balance on Polygon (display + max button) */
  usdcBalance: number;
}

// Relay's `sign` payload shape for an EIP-712 permit step.
interface RelayPermitData {
  sign: {
    signatureKind: string;
    types: Record<string, { name: string; type: string }[]>;
    domain: Record<string, unknown>;
    primaryType: string;
    value: Record<string, unknown>;
  };
  post: {
    endpoint: string;
    method: string;
    body: { kind: string; requestId: string; api: "bridge" | "swap" | "user-swap" };
  };
}

export function WithdrawModal({ open, onOpenChange, usdcBalance }: WithdrawModalProps) {
  const { address: wagmiAddress, chainId: connectedChainId } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  const userAddress = wagmiAddress || (googleAddress as `0x${string}` | null) || undefined;
  const { switchChainAsync } = useSwitchChain();
  const ensureWagmi = useEnsureWagmi();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: txHash, sendTransactionAsync, reset: resetTx } = useSendTransaction();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  // Inputs
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [chain, setChain] = useState<SupportedChain>(() => SUPPORTED_CHAINS.find((c) => c.id === 792703809) || SUPPORTED_CHAINS[0]);
  const [token, setToken] = useState<SupportedToken>(() => tokensForChain(792703809)[0]);
  const [chainMenuOpen, setChainMenuOpen] = useState(false);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);

  // Quote + execution
  const [quote, setQuote] = useState<RelayQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [success, setSuccess] = useState(false);

  const amountNum = parseFloat(amount || "0");
  const validAmount = amountNum > 0;
  const overBalance = amountNum > usdcBalance + 0.000001;
  const validRecipient = recipient.trim().length > 0;

  // Swap token to the equivalent on the new chain when chain changes — same
  // symbol, new address. See deposit-modal.tsx for the full explanation.
  useEffect(() => {
    const valid = tokensForChain(chain.id);
    if (valid.length === 0) return;
    const match = valid.find((t) => t.symbol === token.symbol) || valid[0];
    if (match.address !== token.address) setToken(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.id]);

  // Debounced quote fetch — usePermit gives us the hybrid approve+permit flow
  // for USDC.e. First withdrawal sends one approve tx (paid by the MATIC that
  // came in with the deposit's topupGas); all subsequent withdrawals are just
  // the signature step (fully gasless).
  useEffect(() => {
    if (!open || !userAddress || !validAmount || !validRecipient) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const amountSmallest = parseUnits(amount, 6).toString();
        const q = await getRelayQuote({
          user: userAddress,
          recipient: recipient.trim(),
          originChainId: POLYGON_CHAIN_ID,
          originCurrency: POLYGON_USDC,
          destinationChainId: chain.id,
          destinationCurrency: token.address,
          amount: amountSmallest,
          tradeType: "EXACT_INPUT",
          usePermit: true,
        });
        if (!controller.signal.aborted) setQuote(q);
      } catch (err) {
        if (!controller.signal.aborted) setQuoteError((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, userAddress, amount, recipient, chain.id, token.address, validAmount, validRecipient]);

  const handleUseConnected = useCallback(() => {
    if (userAddress) setRecipient(userAddress);
  }, [userAddress]);

  const handleMax = useCallback(() => {
    const floored = Math.floor(usdcBalance * 1_000_000) / 1_000_000;
    setAmount(floored.toString());
  }, [usdcBalance]);

  const handleWithdraw = useCallback(async () => {
    if (!quote || !userAddress) return;
    setExecError(null);
    setExecuting(true);
    try {
      await ensureWagmi();

      for (let i = 0; i < quote.steps.length; i++) {
        const step = quote.steps[i];
        setStepIndex(i);

        // ── Transaction step (one-time approve, needs a tiny bit of MATIC) ─
        if (step.kind === "transaction") {
          for (const item of step.items || []) {
            if (item.status === "complete") continue;
            const { to, data, value, chainId } = item.data;
            if (!to || !data) continue;
            const target = chainId ?? POLYGON_CHAIN_ID;
            if (connectedChainId !== target) {
              await switchChainAsync({ chainId: target });
            }
            await sendTransactionAsync({
              to: to as `0x${string}`,
              data: data as `0x${string}`,
              value: value ? BigInt(value) : BigInt(0),
            });
          }
          continue;
        }

        // ── Signature step (gasless — user signs, Relay submits) ──────────
        if (step.kind === "signature") {
          for (const item of step.items || []) {
            if (item.status === "complete") continue;
            const permit = item.data as unknown as RelayPermitData;
            if (!permit?.sign || !permit?.post) {
              throw new Error("Malformed permit data from Relay");
            }
            const signature = await signTypedDataAsync({
              domain: permit.sign.domain as Parameters<typeof signTypedDataAsync>[0]["domain"],
              types: permit.sign.types as Parameters<typeof signTypedDataAsync>[0]["types"],
              primaryType: permit.sign.primaryType,
              message: permit.sign.value as Parameters<typeof signTypedDataAsync>[0]["message"],
            });
            await submitRelayPermit({
              signature,
              kind: permit.post.body.kind,
              requestId: permit.post.body.requestId,
              api: permit.post.body.api,
            });
          }
          continue;
        }

        throw new Error(`Unknown step kind "${step.kind}"`);
      }
      setSuccess(true);
    } catch (err) {
      setExecError((err as Error).message || "Transaction failed");
    } finally {
      setExecuting(false);
    }
  }, [quote, userAddress, connectedChainId, ensureWagmi, switchChainAsync, sendTransactionAsync, signTypedDataAsync]);

  const handleClose = (next: boolean) => {
    if (!next) {
      setChainMenuOpen(false);
      setTokenMenuOpen(false);
      setBreakdownOpen(false);
      setRecipient("");
      setAmount("");
      setQuote(null);
      setQuoteError(null);
      setExecError(null);
      setStepIndex(0);
      setSuccess(false);
      resetTx();
    }
    onOpenChange(next);
  };

  const availableTokens = tokensForChain(chain.id);

  const receiveFormatted = useMemo(() => {
    if (!quote) return "-";
    const out = quote.details?.currencyOut;
    if (!out?.amount) return "-";
    return formatAmount(out.amount, out.currency?.decimals ?? token.decimals);
  }, [quote, token.decimals]);

  const receiveUsd = quote?.details?.currencyOut?.amountUsd;
  const networkCostUsd = useMemo(() => {
    if (!quote?.fees) return "0.00";
    const { gas, relayer, relayerService, app } = quote.fees;
    const sum = [gas, relayer, relayerService, app]
      .map((f) => parseFloat(f?.amountUsd || "0"))
      .reduce((a, b) => a + b, 0);
    return sum.toFixed(2);
  }, [quote]);
  const priceImpact = quote?.details?.totalImpact?.percent
    ? `${parseFloat(quote.details.totalImpact.percent).toFixed(2)}%`
    : "-";
  const slippageTolerance = quote?.details?.slippageTolerance?.destination?.percent
    ? `${parseFloat(quote.details.slippageTolerance.destination.percent).toFixed(2)}%`
    : "Auto · 0.50%";

  // Show a hint about the one-time approve so users understand the signature
  // count. Relay's quote tells us if an approve step is present.
  const hasApproveStep = quote?.steps.some((s) => s.kind === "transaction") ?? false;

  const canWithdraw = !!quote && !quoteLoading && !executing && !confirming && validAmount && validRecipient && !overBalance;
  const buttonLabel = !validRecipient
    ? "Enter Recipient Address"
    : !validAmount
      ? "Enter Amount"
      : overBalance
        ? "Exceeds balance"
        : quoteLoading
          ? "Fetching quote…"
          : executing
            ? `Step ${stepIndex + 1}/${quote?.steps.length ?? 1}…`
            : confirming
              ? "Confirming…"
              : success
                ? "Sent — bridging via Relay"
                : "Withdraw";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Withdraw</DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          {/* Recipient */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-white">Recipient address</label>
              {userAddress && (
                <button
                  onClick={handleUseConnected}
                  className="flex items-center gap-1 text-[10px] font-medium bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded-full px-2 py-0.5 transition-colors"
                >
                  <span className="w-3 h-3 rounded-full bg-[#8b5cf6]" /> Use connected
                </button>
              )}
            </div>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Enter recipient address"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff]"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">Amount</label>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 focus-within:border-[#58a6ff]">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="flex-1 bg-transparent text-xl font-medium text-white placeholder:text-[#484f58] focus:outline-none tabular-nums"
                />
                <span className="text-xs font-semibold text-[#768390]">USDC</span>
                <button
                  onClick={handleMax}
                  className="text-[10px] font-semibold text-[#58a6ff] hover:text-[#79c0ff] bg-[#58a6ff]/10 rounded px-1.5 py-0.5"
                >
                  Max
                </button>
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px] text-[#484f58]">
                <span>${amountNum.toFixed(2)}</span>
                <span>Balance: {usdcBalance.toFixed(2)} USDC</span>
              </div>
            </div>
          </div>

          {/* Token + Chain */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-[11px] font-semibold text-white mb-1.5 block">Receive token</label>
              <button
                type="button"
                onClick={() => { setTokenMenuOpen((v) => !v); setChainMenuOpen(false); }}
                className="w-full flex items-center justify-between bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white hover:border-[#484f58] transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Logo src={token.icon} alt={token.symbol} />
                  <span className="font-medium">{token.symbol}</span>
                </span>
                <ChevronDown />
              </button>
              {tokenMenuOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {availableTokens.map((t) => (
                    <button
                      key={t.symbol}
                      onClick={() => { setToken(t); setTokenMenuOpen(false); }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-white hover:bg-[#21262d] transition-colors text-left"
                    >
                      <span className="flex items-center gap-2">
                        <Logo src={t.icon} alt={t.symbol} />
                        <span className="font-medium">{t.symbol}</span>
                      </span>
                      {t.symbol === token.symbol && <Check />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <label className="text-[11px] font-semibold text-white mb-1.5 block">Receive chain</label>
              <button
                type="button"
                onClick={() => { setChainMenuOpen((v) => !v); setTokenMenuOpen(false); }}
                className="w-full flex items-center justify-between bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white hover:border-[#484f58] transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Logo src={chain.icon} alt={chain.name} />
                  <span className="font-medium">{chain.name}</span>
                </span>
                <ChevronDown />
              </button>
              {chainMenuOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {SUPPORTED_CHAINS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setChain(c); setChainMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-white hover:bg-[#21262d] transition-colors text-left"
                    >
                      <Logo src={c.icon} alt={c.name} />
                      <span className="font-medium">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-[#768390]">You will receive</span>
            {quoteLoading ? (
              <span className="text-[#484f58]">calculating…</span>
            ) : quoteError ? (
              <span className="text-[#f85149] text-[10px] max-w-[60%] text-right truncate" title={quoteError}>{quoteError}</span>
            ) : (
              <span className="text-white font-semibold tabular-nums">
                {receiveFormatted} {token.symbol} {receiveUsd && <span className="text-[#484f58] font-normal ml-1">${parseFloat(receiveUsd).toFixed(2)}</span>}
              </span>
            )}
          </div>

          <button
            onClick={() => setBreakdownOpen((v) => !v)}
            className="w-full flex items-center justify-between text-[11px] text-[#768390] hover:text-[#adbac7] transition-colors"
          >
            <span>Transaction breakdown</span>
            <ChevronDown className={breakdownOpen ? "rotate-180" : ""} />
          </button>
          {breakdownOpen && (
            <div className="space-y-1.5 text-[11px] pt-1 border-t border-[#21262d]">
              <Row label="Network cost" value={`$${networkCostUsd}`} />
              <Row label="Price impact" value={priceImpact} />
              <Row label="Max slippage" value={slippageTolerance} />
              {hasApproveStep && (
                <Row label="This withdrawal" value="1 approve tx + 1 signature" />
              )}
              {!hasApproveStep && (
                <Row label="This withdrawal" value="Gasless (1 signature)" />
              )}
            </div>
          )}

          {execError && <p className="text-[11px] text-[#f85149]">{execError}</p>}
          {success && (
            <div className="text-[11px] text-[#3fb950] bg-[#3fb950]/10 px-3 py-2 rounded-lg">
              Submitted! Relay is bridging — funds should arrive at the destination in under a minute.
            </div>
          )}

          <button
            onClick={handleWithdraw}
            disabled={!canWithdraw}
            className="w-full py-3 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed"
          >
            {buttonLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Logo({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="w-6 h-6 rounded-full bg-[#21262d] overflow-hidden flex-shrink-0">
      <Image src={src} alt={alt} width={24} height={24} unoptimized className="w-6 h-6 object-cover" />
    </span>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#768390]">{label}</span>
      <span className="text-white tabular-nums">{value}</span>
    </div>
  );
}
function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-[#768390] transition-transform ${className}`}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#3fb950]">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
