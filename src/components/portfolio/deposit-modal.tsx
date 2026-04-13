"use client";

import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const LiFiWidget = dynamic(
  () => import("@lifi/widget").then((m) => m.LiFiWidget),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-12 text-[#768390] text-sm">Loading bridge...</div> }
);

const POLYGON_USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const widgetConfig = {
  toChain: 137,
  toToken: POLYGON_USDC,
  appearance: "dark" as const,
  theme: {
    palette: {
      primary: { main: "#58a6ff" },
      secondary: { main: "#3fb950" },
      background: { default: "#0d1117", paper: "#161b22" },
      text: { primary: "#e6edf3", secondary: "#768390" },
    },
    shape: { borderRadius: 12, borderRadiusSecondary: 8 },
  },
  variant: "compact" as const,
  subvariant: "default" as const,
  hiddenUI: ["appearance" as const, "poweredBy" as const],
  // Allow all chains as source (Solana, Ethereum, Arbitrum, etc.)
  // Don't restrict to wagmi chains — let LI.FI handle wallet connections for non-EVM
  chainTypes: ["EVM" as const, "SVM" as const],
  walletConfig: { usePartialWalletManagement: true },
};

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Deposit to Polygon</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <LiFiWidget integrator="polystream" config={widgetConfig} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
