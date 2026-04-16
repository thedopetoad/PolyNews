"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePolymarketSetup } from "@/hooks/use-polymarket-setup";

interface EnableTradingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after enableTrading() confirms onchain success + verifies approvals.
   * Parent should use this to re-check its own setup state so the UI reflects
   * the newly-enabled trading state without a full page reload.
   */
  onSuccess?: () => void;
}

/**
 * Blocking modal shown before a user can place their first trade on
 * Polymarket. Handles the "Enable Trading" setup — deploys their proxy
 * wallet and approves USDC.e + outcome tokens on all 4 exchange
 * contracts in a single relayed transaction (gas-free, one wallet
 * signature).
 *
 * Matches polymarket.com's own Enable Trading modal flow:
 * 1) Deploy Proxy Wallet
 * 2) Sign to Generate API Keys (already happens automatically on first trade)
 * 3) Approve Tokens
 *
 * We bundle all 7 approvals into one relayer call, so in practice the
 * user only signs once.
 */
export function EnableTradingModal({ open, onOpenChange, onSuccess }: EnableTradingModalProps) {
  const { enableTrading, isApproving, error, status, proxyDeployed, usdcApproved, tokensApproved } = usePolymarketSetup();
  const [dismissed, setDismissed] = useState(false);

  if (!open || dismissed) return null;

  const handleEnable = async () => {
    const ok = await enableTrading();
    if (ok) {
      // Notify parent so sibling hooks (e.g. bet-slip) re-check setup state
      onSuccess?.();
      // Close modal a beat after success so the user sees the checkmark
      setTimeout(() => onOpenChange(false), 800);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isApproving) onOpenChange(false);
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-[#30363d] bg-[#161b22] p-6 shadow-[0_0_40px_-10px_rgba(88,166,255,0.3)]">
        {/* Close button */}
        {!isApproving && (
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 text-[#484f58] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Header */}
        <div className="mb-6">
          <div className="text-4xl mb-3">🔐</div>
          <h2 className="text-xl font-bold text-white mb-1">Enable Trading</h2>
          <p className="text-sm text-[#768390]">
            One-time setup to let Polymarket execute trades from your proxy wallet. Gas-free.
          </p>
        </div>

        {/* Steps — each reflects actual on-chain status */}
        <div className="space-y-3 mb-6">
          <Step
            num={1}
            title="Deploy Proxy Wallet"
            desc={proxyDeployed ? "✓ Already deployed — your proxy wallet is live on Polygon." : "Smart contract wallet that holds your USDC.e and executes trades."}
            done={proxyDeployed}
            active={isApproving && !proxyDeployed}
          />
          <Step
            num={2}
            title="Approve USDC.e"
            desc={usdcApproved ? "✓ Already approved on all 4 exchange contracts." : "Allow Polymarket's 4 exchange contracts to trade your stablecoin."}
            done={usdcApproved}
            active={isApproving && !usdcApproved}
          />
          <Step
            num={3}
            title="Approve Outcome Tokens"
            desc={tokensApproved ? "✓ Already approved on all 3 exchange contracts." : "Allow the exchange contracts to move your position tokens."}
            done={tokensApproved}
            active={isApproving && !tokensApproved}
          />
        </div>

        {error && (
          <p className="text-xs text-[#f85149] bg-[#f85149]/10 px-3 py-2 rounded mb-4">
            {error}
          </p>
        )}

        {status === "ready" ? (
          <button
            onClick={() => {
              // Fire onSuccess when the modal was ALREADY in ready state
              // (e.g. user opens it on a wallet that's already set up and
              // just clicks continue). Harmless if called twice.
              onSuccess?.();
              onOpenChange(false);
            }}
            className="w-full py-3 rounded-lg text-sm font-bold bg-[#238636] text-white hover:bg-[#2ea043] transition-colors"
          >
            ✓ Trading enabled — continue
          </button>
        ) : (
          <>
            <button
              onClick={handleEnable}
              disabled={isApproving}
              className={cn(
                "w-full py-3 rounded-lg text-sm font-bold transition-all",
                isApproving
                  ? "bg-[#21262d] text-[#484f58] cursor-wait"
                  : "bg-[#58a6ff] text-white hover:bg-[#4d8fea] active:scale-[0.98]"
              )}
            >
              {isApproving ? "Approving... sign in your wallet" : "Enable Trading"}
            </button>
            <p className="text-[10px] text-[#484f58] text-center mt-3">
              Polymarket&apos;s relayer covers gas. You&apos;ll sign one message in your wallet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Step({ num, title, desc, done, active }: { num: number; title: string; desc: string; done: boolean; active: boolean }) {
  return (
    <div className="flex gap-3">
      <div className={cn(
        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold",
        done
          ? "bg-[#238636] text-white"
          : active
            ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40 animate-pulse"
            : "bg-[#21262d] text-[#768390] border border-[#30363d]"
      )}>
        {done ? "✓" : num}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-[#e6edf3]">{title}</p>
        <p className="text-[11px] text-[#768390] leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
