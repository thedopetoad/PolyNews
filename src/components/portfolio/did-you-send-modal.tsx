"use client";

/**
 * Shown after the user closes the bridge deposit modal — we can't otherwise
 * tell whether they actually sent funds, so we just ask. "Yes" starts the
 * delivery bar; "No" drops it and avoids a bogus indicator if they were
 * only peeking at the address.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnswer: (yes: boolean) => void;
}

export function DidYouSendModal({ open, onOpenChange, onAnswer }: Props) {
  const { t } = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#30363d] bg-gradient-to-b from-[#161b22] to-[#0d1117] sm:max-w-md p-0 overflow-hidden shadow-2xl shadow-black/60 modal-grow-on-open">
        {/* Glow accent — gently pulses so the top edge of the modal has
            a subtle living shimmer without demanding attention. */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#58a6ff]/60 to-transparent animate-accent-line-pulse" />

        {/* Icon */}
        <div className="flex justify-center pt-7">
          <div className="h-14 w-14 rounded-full bg-[#58a6ff]/10 ring-1 ring-[#58a6ff]/20 flex items-center justify-center">
            <PaperPlaneIcon />
          </div>
        </div>

        {/* Title */}
        <DialogHeader className="px-7 pt-5">
          <DialogTitle className="text-white text-xl text-center font-semibold">
            {t.portfolio.didYouSendTitle}
          </DialogTitle>
        </DialogHeader>

        {/* Buttons */}
        <div className="px-7 pt-6 pb-5 flex gap-3">
          <button
            onClick={() => onAnswer(false)}
            className="flex-1 py-3 rounded-lg text-sm font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] active:scale-[0.98] transition-all"
          >
            {t.portfolio.no}
          </button>
          <button
            onClick={() => onAnswer(true)}
            className="flex-1 py-3 rounded-lg text-sm font-semibold bg-gradient-to-b from-[#58a6ff] to-[#4d8fea] text-white shadow-lg shadow-[#58a6ff]/20 hover:from-[#6cb1ff] hover:to-[#58a6ff] active:scale-[0.98] transition-all"
          >
            {t.portfolio.yes}
          </button>
        </div>

        {/* Fine print */}
        <div className="px-7 pb-5 pt-3 border-t border-[#21262d]/60">
          <p className="text-[11px] text-[#6e7681] text-center leading-snug">
            {t.portfolio.didYouSendDesc}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaperPlaneIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#58a6ff"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
