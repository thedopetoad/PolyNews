"use client";

/**
 * Withdraw modal — gasless USDC.e transfer from user's Polymarket proxy wallet.
 *
 * Uses @polymarket/builder-relayer-client which handles:
 *   1. Fetching relay nonce from relayer-v2.polymarket.com
 *   2. Building + signing the proxy transaction (user signs via wagmi wallet / Magic)
 *   3. Submitting with builder HMAC headers (remote-signed via /api/polymarket/builder-headers)
 *   4. Polling for on-chain confirmation
 *
 * Supports same-chain (Polygon address) and cross-chain (via bridge.polymarket.com).
 */

import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccount, useWalletClient } from "wagmi";
import { parseUnits, isAddress, createWalletClient, custom } from "viem";
import { polygon } from "viem/chains";
import { RelayClient, RelayerTxType } from "@polymarket/builder-relayer-client";
import { useAuthStore } from "@/stores/use-auth-store";
import { getMagic } from "@/lib/magic";
import { RELAYER_URL, USDC_E, deriveProxyAddress, encodeUsdcTransfer } from "@/lib/relay";

const BRIDGE_API = "https://bridge.polymarket.com";

// Destination chains for cross-chain withdrawals.
// minUsd matches bridge.polymarket.com's minCheckoutUsd for each destination.
// Polygon same-chain is a direct USDC.e transfer (no bridge), so the floor is
// just "more than zero" — keep it at 0 so the UI doesn't block small transfers.
const DEST_CHAINS = [
  { id: "polygon", label: "Polygon (same chain)", chainId: null, minUsd: 0 },
  { id: "ethereum", label: "Ethereum", chainId: "1", tokenAddr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", minUsd: 7 },
  { id: "base", label: "Base", chainId: "8453", tokenAddr: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", minUsd: 2 },
  { id: "solana", label: "Solana", chainId: "1151111081099710", tokenAddr: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", minUsd: 2 },
] as const;

type Status = "idle" | "signing" | "submitting" | "polling" | "success" | "error";

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usdcBalance: number;
  userAddress: string | null;
  /**
   * Fires the moment the user clicks "Withdraw" (before signing). The
   * portfolio page starts the pending-withdraw indicator immediately so the
   * bar is visible throughout the signing + relay flow.
   */
  onWithdrawStarted?: (chainName: string) => void;
  /**
   * Fires if the withdraw fails during signing/submission so the portfolio
   * can dismiss the indicator it started in onWithdrawStarted.
   */
  onWithdrawFailed?: () => void;
}

export function WithdrawModal({ open, onOpenChange, usdcBalance, userAddress, onWithdrawStarted, onWithdrawFailed }: WithdrawModalProps) {
  // Explicitly scope the wallet client to Polygon so wagmi doesn't return
  // undefined when the connected wallet is currently on a different chain
  // (e.g. Phantom in Solana mode still exposes window.ethereum for signing).
  const { data: walletClient } = useWalletClient({ chainId: polygon.id });
  const { isConnected: wagmiConnected } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [destChain, setDestChain] = useState("polygon");
  const [status, setStatus] = useState<Status>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // User explicitly accepted the "below bridge minimum" risk for this submit.
  // Resets when they change amount or destination.
  const [acceptBelowMin, setAcceptBelowMin] = useState(false);

  const isMagicUser = !!googleAddress;
  // Gate on connection state, not walletClient presence — the latter can race
  // during chain switches and be undefined even though the user is signed in.
  // We'll build a walletClient on-demand inside handleWithdraw if needed.
  const canWithdraw = !!(userAddress && (wagmiConnected || isMagicUser));
  const selectedDest = DEST_CHAINS.find((c) => c.id === destChain)!;
  const isCrossChain = destChain !== "polygon";

  const handleWithdraw = useCallback(async () => {
    if (!userAddress) return;

    setError(null);
    setTxHash(null);

    // Validate
    if (!recipient) { setError("Enter a recipient address"); return; }
    if (!isCrossChain && !isAddress(recipient)) { setError("Invalid Polygon address"); return; }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { setError("Enter a valid amount"); return; }
    if (amountNum > usdcBalance) { setError("Amount exceeds balance"); return; }
    // Below bridge minimum — require explicit acknowledgment instead of a hard
    // block, since some users may prefer to try rather than deposit more.
    if (selectedDest.minUsd > 0 && amountNum < selectedDest.minUsd && !acceptBelowMin) {
      setError(`Minimum withdraw to ${selectedDest.label.replace(" (same chain)", "")} is $${selectedDest.minUsd}. Check the acknowledgment box to proceed anyway.`);
      return;
    }

    const amountRaw = parseUnits(amount, 6); // USDC.e has 6 decimals

    // Start the pending indicator BEFORE signing so the bar is visible
    // throughout the whole flow. It'll auto-complete when the user's
    // Polystream USDC.e balance drops (i.e. the relay tx settles). Map
    // internal id → human name for the label.
    const CHAIN_NAMES: Record<string, string> = {
      polygon: "Polygon",
      ethereum: "Ethereum",
      base: "Base",
      solana: "Solana",
    };
    const chainName = CHAIN_NAMES[destChain] ?? selectedDest.label;
    onWithdrawStarted?.(chainName);

    try {
      setStatus("signing");

      // Build the RelayClient with remote builder config (HMAC secrets stay server-side)
      // Use dynamic require to get BuilderConfig from the relayer client's own dependency
      // to avoid version mismatch with the top-level @polymarket/builder-signing-sdk
      const { BuilderConfig } = await import("@polymarket/builder-signing-sdk");
      const builderConfig = new BuilderConfig({
        remoteBuilderConfig: {
          url: `${window.location.origin}/api/polymarket/builder-headers`,
        },
      });

      // Get signer: walletClient for browser wallets, or wrap Magic's
      // rpcProvider into a viem WalletClient for Google users.
      // Magic's provider supports personal_sign which is what the relay needs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let signer: any = walletClient;
      if (!signer && isMagicUser) {
        const magic = getMagic();
        if (!magic) throw new Error("Magic not initialized");
        signer = createWalletClient({
          account: userAddress as `0x${string}`,
          chain: polygon,
          transport: custom(magic.rpcProvider),
        });
      }
      // Fallback for wagmi-connected wallets whose walletClient hasn't
      // materialised (e.g. Phantom while its UI is on Solana). The injected
      // ethereum provider can still personal_sign, which is all the relay needs.
      if (!signer && wagmiConnected) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const injected = (window as any).ethereum;
        if (!injected) throw new Error("No injected wallet provider found");
        signer = createWalletClient({
          account: userAddress as `0x${string}`,
          chain: polygon,
          transport: custom(injected),
        });
      }
      if (!signer) throw new Error("No wallet signer available");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const relayClient = new RelayClient(
        RELAYER_URL,
        137, // Polygon
        signer,
        builderConfig as any,
        RelayerTxType.PROXY, // Polymarket uses proxy wallets, not Safe wallets
      );

      // CRITICAL GAS FIX: The relay hub checks `require(gasleft() > signedGasLimit)`.
      // If the signed gasLimit is too high (e.g. 10M default), the relay hub reverts
      // with "Not enough gasleft()" because the relay hub itself consumes some gas
      // before the check. The signed gasLimit must be LESS than the tx gas limit.
      //
      // The SDK's ViemSigner has a class method `estimateGas` that calls
      // `this.publicClient.estimateGas`. We need to patch BOTH the signer's method
      // AND the publicClient to ensure our 3M value is used.
      // Polymarket's own example uses ~650K for single transfers.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internalSigner = (relayClient as any).signer;
      if (internalSigner) {
        // Patch the class method
        internalSigner.estimateGas = async () => BigInt(3_000_000);
        // Patch the publicClient it uses internally
        if (internalSigner.publicClient) {
          internalSigner.publicClient.estimateGas = async () => BigInt(3_000_000);
        }
      }

      let transferTo = recipient;

      // For cross-chain: get bridge deposit address first
      if (isCrossChain && selectedDest.chainId) {
        setStatus("submitting");
        const bridgeRes = await fetch(`${BRIDGE_API}/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: deriveProxyAddress(userAddress),
            toChainId: selectedDest.chainId,
            toTokenAddress: selectedDest.tokenAddr,
            recipientAddr: recipient,
          }),
        });

        if (!bridgeRes.ok) {
          const err = await bridgeRes.text();
          throw new Error(`Bridge error: ${err}`);
        }

        const bridgeData = await bridgeRes.json();
        // Always use the EVM deposit address — the relay transfer happens on Polygon.
        // The bridge receives USDC.e at this EVM address and forwards to the
        // destination chain (Ethereum, Base, Solana, etc.) automatically.
        transferTo = bridgeData.address?.evm;
        if (!transferTo) throw new Error("No bridge address returned");
      }

      // Execute the relay: encode USDC.e transfer → sign → submit → poll
      setStatus("signing");
      const transferData = encodeUsdcTransfer(transferTo, amountRaw);

      const response = await relayClient.execute(
        [{ to: USDC_E, data: transferData, value: "0" }],
        `Withdraw ${amount} USDC.e${isCrossChain ? ` to ${selectedDest.label}` : ""}`,
      );

      setStatus("polling");

      // The relay submission already returned a tx hash. Capture it BEFORE
      // we await wait() so that even if confirmation polling times out or
      // throws, we can still show the user the hash and mark the withdraw
      // as submitted. Without this, on-chain successes were being reported
      // to the user as failures (third withdraw bug, tx 0x41245c…).
      const submittedHash = response.transactionHash || null;

      try {
        const confirmed = await response.wait();
        const hash = confirmed?.transactionHash || submittedHash;
        setTxHash(hash);
        setStatus("success");
      } catch (waitErr) {
        // Submission succeeded; only confirmation polling failed. Surface
        // the tx hash so the user can verify on Polygonscan, but don't
        // call onWithdrawFailed — the pending-bridge indicator will
        // auto-complete when the proxy USDC.e balance drops.
        console.warn("Withdraw wait() failed but tx was submitted:", waitErr);
        if (submittedHash) {
          setTxHash(submittedHash);
          setStatus("success");
        } else {
          throw waitErr;
        }
      }
    } catch (err) {
      console.error("Withdraw failed:", err);
      setError((err as Error).message || "Withdrawal failed");
      setStatus("error");
      onWithdrawFailed?.();
    }
  }, [userAddress, walletClient, wagmiConnected, isMagicUser, recipient, amount, usdcBalance, isCrossChain, selectedDest, destChain, onWithdrawStarted, onWithdrawFailed]);

  const handleClose = (next: boolean) => {
    if (!next && status !== "signing" && status !== "submitting" && status !== "polling") {
      setRecipient("");
      setAmount("");
      setDestChain("polygon");
      setStatus("idle");
      setTxHash(null);
      setError(null);
      setAcceptBelowMin(false);
    }
    onOpenChange(next);
  };

  const isProcessing = status === "signing" || status === "submitting" || status === "polling";

  // Pre-submit min-amount check — shown as a non-blocking amber hint while
  // the user is still typing, and enforced at submission time by handleWithdraw.
  const amountNum = parseFloat(amount) || 0;
  const belowMin = amountNum > 0 && selectedDest.minUsd > 0 && amountNum < selectedDest.minUsd;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Withdraw USDC.e</DialogTitle>
          <p className="text-xs text-[#768390]">Gasless transfer from your Polymarket proxy wallet</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          {/* Balance */}
          <div className="flex items-center justify-between bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5">
            <span className="text-xs text-[#768390]">Available</span>
            <span className="text-sm text-white font-semibold tabular-nums">${usdcBalance.toFixed(2)} USDC.e</span>
          </div>

          {/* Destination chain */}
          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">Destination</label>
            <div className="grid grid-cols-2 gap-2">
              {DEST_CHAINS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setDestChain(c.id); setAcceptBelowMin(false); }}
                  disabled={isProcessing}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    destChain === c.id
                      ? "border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff]"
                      : "border-[#30363d] bg-[#0d1117] text-[#768390] hover:border-[#484f58]"
                  } disabled:opacity-50`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">
              Recipient address {isCrossChain ? `(${selectedDest.label})` : "(Polygon)"}
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={destChain === "solana" ? "So1..." : "0x..."}
              disabled={isProcessing}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff] disabled:opacity-50"
            />
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-white">Amount (USDC.e)</label>
              {selectedDest.minUsd > 0 && (
                <span className="text-[11px] text-[#d29922] font-medium">
                  Min ${selectedDest.minUsd} to {selectedDest.label.replace(" (same chain)", "")}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAcceptBelowMin(false); }}
                placeholder="0.00"
                step="0.01"
                min="0"
                disabled={isProcessing}
                className={`w-full bg-[#0d1117] border rounded-lg px-3 py-2.5 pr-16 text-sm text-white placeholder:text-[#484f58] focus:outline-none disabled:opacity-50 transition-colors ${
                  belowMin ? "border-[#d29922] focus:border-[#d29922]" : "border-[#30363d] focus:border-[#58a6ff]"
                }`}
              />
              <button
                onClick={() => { setAmount(usdcBalance.toFixed(2)); setAcceptBelowMin(false); }}
                disabled={isProcessing}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#58a6ff] hover:text-[#79c0ff] px-2 py-0.5 rounded bg-[#58a6ff]/10 disabled:opacity-50"
              >
                Max
              </button>
            </div>
            {belowMin && (
              <div className="mt-1.5 space-y-1.5">
                <p className="text-[11px] text-[#d29922] flex items-start gap-1.5 leading-snug">
                  <WarningIcon />
                  <span>
                    Below ${selectedDest.minUsd}, the bridge may not deliver to {selectedDest.label.replace(" (same chain)", "")}. Your funds could get stuck at the bridge address with no refund path. Safer to withdraw to Polygon first.
                  </span>
                </p>
                <label className="flex items-start gap-1.5 text-[11px] text-[#d29922] cursor-pointer select-none leading-snug">
                  <input
                    type="checkbox"
                    checked={acceptBelowMin}
                    onChange={(e) => setAcceptBelowMin(e.target.checked)}
                    disabled={isProcessing}
                    className="mt-[1px] accent-[#d29922]"
                  />
                  <span>I understand this may not be delivered and accept the risk.</span>
                </label>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[#f85149] bg-[#f85149]/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Success */}
          {status === "success" && txHash && (
            <div className="text-xs text-[#3fb950] bg-[#3fb950]/10 px-3 py-2.5 rounded-lg">
              Withdrawal complete!{" "}
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline"
              >
                View on Polygonscan &rarr;
              </a>
              {isCrossChain && (
                <p className="mt-1 text-[#768390]">Cross-chain bridge will deliver to {selectedDest.label} shortly.</p>
              )}
            </div>
          )}

          {/* Withdraw button */}
          {status !== "success" && (
            <button
              onClick={handleWithdraw}
              disabled={isProcessing || !canWithdraw || (belowMin && !acceptBelowMin)}
              className={`w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                belowMin && acceptBelowMin
                  ? "bg-[#d29922] hover:bg-[#bb8317]"
                  : "bg-[#58a6ff] hover:bg-[#4d8fea]"
              }`}
            >
              {status === "signing" ? "Sign in wallet..." :
               status === "submitting" ? "Setting up bridge..." :
               status === "polling" ? "Confirming on-chain..." :
               !canWithdraw ? "Connect wallet to withdraw" :
               belowMin && !acceptBelowMin ? `Check box to withdraw below $${selectedDest.minUsd}` :
               belowMin ? "Withdraw anyway (risky)" :
               "Withdraw"}
            </button>
          )}

          {/* Info */}
          <p className="text-[10px] text-[#484f58] leading-snug">
            {isCrossChain
              ? `Funds are relayed from your Polymarket proxy wallet to bridge.polymarket.com, then bridged to ${selectedDest.label}. No gas fees.`
              : "Funds are relayed gaslessly from your Polymarket proxy wallet to the recipient on Polygon. No gas fees."
            }
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WarningIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 mt-0.5"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
