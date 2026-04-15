"use client";

/**
 * Shown after the user closes the bridge deposit modal — we can't otherwise
 * tell whether they actually sent funds, so we just ask. "Yes" starts the
 * delivery bar; "No" drops it and avoids a bogus indicator if they were
 * only peeking at the address.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chainName: string;
  onAnswer: (yes: boolean) => void;
}

export function DidYouSendModal({ open, onOpenChange, chainName, onAnswer }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Did you send funds?</DialogTitle>
          <p className="text-xs text-[#768390] mt-1">
            If you sent {chainName} to your deposit address, we&apos;ll track it and let
            you know when it lands on Polymarket.
          </p>
        </DialogHeader>
        <div className="px-5 pb-5 pt-4 flex gap-2">
          <button
            onClick={() => onAnswer(false)}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors"
          >
            No
          </button>
          <button
            onClick={() => onAnswer(true)}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors"
          >
            Yes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
