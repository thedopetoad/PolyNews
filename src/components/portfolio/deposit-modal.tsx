"use client";

import Image from "next/image";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { parseUnits } from "viem";
import { useEnsureWagmi } from "@/hooks/use-ensure-wagmi";
import {
  SUPPORTED_CHAINS,
  tokensForChain,
  getRelayQuote,
  formatAmount,
  buildRelaySolanaTx,
  POLYGON_USDC,
  POLYGON_CHAIN_ID,
  type RelayQuote,
  type SupportedChain,
  type SupportedToken,
} from "@/lib/relay";

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** User's Polygon EVM address — where bridged USDC lands */
  recipientAddress: string | null;
}

// Kinds we can sign today. BTC/Tron still need deposit-address flow (Relay API key).
const SIGNABLE_KINDS = new Set(["evm", "svm"]);

export function DepositModal({ open, onOpenChange, recipientAddress }: DepositModalProps) {
  // EVM wallet (wagmi)
  const { address: evmAddress, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const ensureWagmi = useEnsureWagmi();

  // Solana wallet (@solana/wallet-adapter-react)
  const { connection } = useConnection();
  const { publicKey: solPubkey, wallet: solWallet, wallets: solWallets, select: selectSolWallet, connect: connectSolWallet, sendTransaction: sendSolTx } = useWallet();

  // UI state
  const [chain, setChain] = useState<SupportedChain>(SUPPORTED_CHAINS[0]);
  const [token, setToken] = useState<SupportedToken>(tokensForChain(SUPPORTED_CHAINS[0].id)[0]);
  const [amount, setAmount] = useState("");
  const [chainMenuOpen, setChainMenuOpen] = useState(false);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const [solPickerOpen, setSolPickerOpen] = useState(false);

  // Quote + execution state
  const [quote, setQuote] = useState<RelayQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [solSignature, setSolSignature] = useState<string | null>(null);

  const { data: evmTxHash, sendTransactionAsync, reset: resetTx } = useSendTransaction();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: evmTxHash });

  const amountNum = parseFloat(amount || "0");
  const validAmount = amountNum > 0;
  const chainSupported = SIGNABLE_KINDS.has(chain.kind);

  // Source-chain address used as `user` in the Relay quote — whichever wallet
  // is currently connected for this chain's VM.
  const sourceAddress = chain.kind === "svm" ? solPubkey?.toBase58() ?? null : evmAddress ?? null;

  const solWalletsInstalled = useMemo(
    () => solWallets.filter(
      (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
    ),
    [solWallets],
  );

  // When chain changes, swap the token to the equivalent one on the new chain.
  // Same symbol = keep user's selection but use the NEW chain's address (e.g.
  // "USDC" → Polygon USDC on Polygon, Solana USDC mint on Solana). Not just
  // "reset if symbol missing" — the address would be stale otherwise, which
  // triggers Relay's INVALID_INPUT_CURRENCY.
  useEffect(() => {
    const valid = tokensForChain(chain.id);
    if (valid.length === 0) return;
    const match = valid.find((t) => t.symbol === token.symbol) || valid[0];
    if (match.address !== token.address) setToken(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.id]);

  // Debounced quote fetch
  useEffect(() => {
    if (!open || !recipientAddress || !sourceAddress || !validAmount || !chainSupported) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const amountSmallest = parseUnits(amount, token.decimals).toString();
        const q = await getRelayQuote({
          user: sourceAddress,                      // the account signing on source chain
          recipient: recipientAddress,              // destination Polygon EVM address
          originChainId: chain.id,
          destinationChainId: POLYGON_CHAIN_ID,
          originCurrency: token.address,
          destinationCurrency: POLYGON_USDC,
          amount: amountSmallest,
          tradeType: "EXACT_INPUT",
          // DO NOT enable topupGas — Relay charges a flat ~$2 relayer fee for
          // it regardless of deposit size, which wipes out small deposits
          // (e.g. $2.53 → $0.48). Users source their own MATIC (just ~$0.01
          // needed for the one-time Relay depository approve; after that,
          // every withdrawal is gasless via EIP-3009 permit signatures).
        });
        if (!controller.signal.aborted) setQuote(q);
      } catch (err) {
        if (!controller.signal.aborted) setQuoteError((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, recipientAddress, sourceAddress, amount, chain.id, token.address, token.decimals, validAmount, chainSupported]);

  const handleConnectSol = useCallback(async (adapterName: string) => {
    try {
      selectSolWallet(adapterName as Parameters<typeof selectSolWallet>[0]);
      // WalletProvider with autoConnect=false means we must call connect() explicitly
      // after select triggers. Give React a tick to flush the selection, then connect.
      await new Promise((r) => setTimeout(r, 0));
      await connectSolWallet();
      setSolPickerOpen(false);
    } catch (err) {
      setExecError((err as Error).message || "Failed to connect Solana wallet");
    }
  }, [selectSolWallet, connectSolWallet]);

  const handleDeposit = useCallback(async () => {
    if (!quote || !recipientAddress) return;
    setExecError(null);
    setExecuting(true);
    try {
      for (let i = 0; i < quote.steps.length; i++) {
        const step = quote.steps[i];
        setStepIndex(i);
        if (step.kind !== "transaction") continue;

        for (const item of step.items || []) {
          if (item.status === "complete") continue;
          const data = item.data;

          // ── Solana path ──────────────────────────────────────────────
          if (chain.kind === "svm") {
            if (!solPubkey) throw new Error("Solana wallet not connected");
            const tx = await buildRelaySolanaTx(connection, solPubkey, data);
            const sig = await sendSolTx(tx, connection, { skipPreflight: false, preflightCommitment: "confirmed" });
            setSolSignature(sig);
            // Wait for confirmation — Relay starts filling once it sees the deposit
            await connection.confirmTransaction(sig, "confirmed");
            continue;
          }

          // ── EVM path ────────────────────────────────────────────────
          if (!data.to || !data.data) continue;
          // Re-establish wagmi Magic connection if it dropped (Google users)
          await ensureWagmi();
          const targetChain = data.chainId ?? chain.id;
          if (connectedChainId !== targetChain) {
            await switchChainAsync({ chainId: targetChain });
          }
          await sendTransactionAsync({
            to: data.to as `0x${string}`,
            data: data.data as `0x${string}`,
            value: data.value ? BigInt(data.value) : BigInt(0),
          });
        }
      }
    } catch (err) {
      setExecError((err as Error).message || "Transaction failed");
    } finally {
      setExecuting(false);
    }
  }, [quote, recipientAddress, chain.kind, chain.id, solPubkey, connection, sendSolTx, connectedChainId, switchChainAsync, sendTransactionAsync, ensureWagmi]);

  const handleClose = (next: boolean) => {
    if (!next) {
      setChainMenuOpen(false);
      setTokenMenuOpen(false);
      setSolPickerOpen(false);
      setBreakdownOpen(false);
      setAmount("");
      setQuote(null);
      setQuoteError(null);
      setExecError(null);
      setStepIndex(0);
      setSolSignature(null);
      resetTx();
    }
    onOpenChange(next);
  };

  const availableTokens = tokensForChain(chain.id);

  // Derived display
  const receiveFormatted = useMemo(() => {
    if (!quote) return "-";
    const out = quote.details?.currencyOut;
    if (!out?.amount) return "-";
    return formatAmount(out.amount, out.currency?.decimals ?? 6);
  }, [quote]);
  const receiveUsd = quote?.details?.currencyOut?.amountUsd;
  const networkCostUsd = useMemo(() => {
    if (!quote?.fees) return "0.00";
    const { gas, relayer, relayerService, app } = quote.fees;
    return [gas, relayer, relayerService, app]
      .map((f) => parseFloat(f?.amountUsd || "0"))
      .reduce((a, b) => a + b, 0)
      .toFixed(2);
  }, [quote]);
  const priceImpact = quote?.details?.totalImpact?.percent
    ? `${parseFloat(quote.details.totalImpact.percent).toFixed(2)}%`
    : "-";

  // Button state machine
  const needsSolanaConnect = chain.kind === "svm" && !solPubkey;
  const canDeposit = !!quote && !quoteLoading && !executing && !confirming && validAmount && chainSupported && !!sourceAddress;

  let buttonLabel = "Deposit";
  let buttonAction: () => void = handleDeposit;
  let buttonDisabled = !canDeposit;

  if (!chainSupported) {
    buttonLabel = `${chain.name} requires API key`;
    buttonDisabled = true;
  } else if (needsSolanaConnect) {
    buttonLabel = solPickerOpen ? "Select a Solana wallet below" : "Connect Solana wallet";
    buttonAction = () => setSolPickerOpen(true);
    buttonDisabled = false;
  } else if (!sourceAddress) {
    buttonLabel = "Connect wallet";
    buttonDisabled = true;
  } else if (!validAmount) {
    buttonLabel = "Enter Amount";
    buttonDisabled = true;
  } else if (quoteLoading) {
    buttonLabel = "Fetching quote…";
    buttonDisabled = true;
  } else if (executing) {
    buttonLabel = `Signing (${stepIndex + 1}/${quote?.steps.length ?? 1})…`;
    buttonDisabled = true;
  } else if (confirming) {
    buttonLabel = "Confirming…";
    buttonDisabled = true;
  } else if (isSuccess || solSignature) {
    buttonLabel = "Sent — bridging via Relay";
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Transfer Crypto</DialogTitle>
          <p className="text-xs text-[#768390]">PolyStream Balance: Polygon USDC</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          {/* Token + Chain */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-[11px] font-semibold text-white mb-1.5 block">Supported token</label>
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
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-white">Supported chain</label>
                <span className="text-[10px] text-[#484f58]">Min ${chain.min}</span>
              </div>
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
                  {SUPPORTED_CHAINS.map((c) => {
                    const supported = SIGNABLE_KINDS.has(c.kind);
                    return (
                      <button
                        key={c.id}
                        onClick={() => { setChain(c); setChainMenuOpen(false); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-[#21262d] transition-colors text-left"
                      >
                        <span className="flex items-center gap-2">
                          <Logo src={c.icon} alt={c.name} />
                          <span className={`font-medium ${supported ? "text-white" : "text-[#484f58]"}`}>{c.name}</span>
                        </span>
                        <span className="text-[10px] text-[#484f58]">
                          {supported ? `Min $${c.min}` : "soon"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
                  disabled={!chainSupported}
                  className="flex-1 bg-transparent text-xl font-medium text-white placeholder:text-[#484f58] focus:outline-none tabular-nums disabled:opacity-50"
                />
                <span className="text-xs font-semibold text-[#768390]">{token.symbol}</span>
              </div>
            </div>
          </div>

          {!chainSupported && (
            <div className="text-[11px] text-[#d29922] bg-[#d29922]/10 px-3 py-2 rounded-lg leading-snug">
              {chain.name} deposits require a Relay API key (pending approval, usually 72h).
            </div>
          )}

          {/* Solana wallet picker */}
          {chain.kind === "svm" && solPickerOpen && (
            <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2 space-y-1">
              <p className="text-[11px] text-[#768390] px-2 py-1">Select a Solana wallet</p>
              {solWalletsInstalled.length === 0 ? (
                <p className="text-[11px] text-[#484f58] px-2 py-2">No Solana wallets detected. Install Phantom or Solflare and reload.</p>
              ) : (
                solWalletsInstalled.map((w) => (
                  <button
                    key={w.adapter.name}
                    onClick={() => handleConnectSol(w.adapter.name)}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-[#21262d] text-sm text-white text-left"
                  >
                    <Image src={w.adapter.icon} alt={w.adapter.name} width={20} height={20} unoptimized className="w-5 h-5 rounded" />
                    <span>{w.adapter.name}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {chain.kind === "svm" && solPubkey && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[#768390]">From Solana</span>
              <span className="text-[#adbac7] font-mono">
                {solWallet?.adapter.name} · {solPubkey.toBase58().slice(0, 6)}…{solPubkey.toBase58().slice(-4)}
              </span>
            </div>
          )}

          {chainSupported && sourceAddress && (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#768390]">You will receive</span>
                {quoteLoading ? (
                  <span className="text-[#484f58]">calculating…</span>
                ) : quoteError ? (
                  <span className="text-[#f85149] text-[10px] max-w-[60%] text-right truncate" title={quoteError}>{quoteError}</span>
                ) : (
                  <span className="text-white font-semibold tabular-nums">
                    {receiveFormatted} USDC {receiveUsd && <span className="text-[#484f58] font-normal ml-1">${parseFloat(receiveUsd).toFixed(2)}</span>}
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
                </div>
              )}
            </>
          )}

          {execError && <p className="text-[11px] text-[#f85149]">{execError}</p>}
          {(isSuccess || solSignature) && (
            <div className="text-[11px] text-[#3fb950] bg-[#3fb950]/10 px-3 py-2 rounded-lg">
              Submitted! Bridging via Relay — USDC should arrive on Polygon in under a minute.
              {solSignature && (
                <>
                  {" "}
                  <a href={`https://solscan.io/tx/${solSignature}`} target="_blank" rel="noopener noreferrer" className="underline">View on Solscan →</a>
                </>
              )}
            </div>
          )}

          <button
            onClick={buttonAction}
            disabled={buttonDisabled}
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
