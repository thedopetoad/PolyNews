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
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-7 pt-7">
          <DialogTitle className="text-white text-xl">{t.portfolio.didYouSendTitle}</DialogTitle>
          <p className="text-sm text-[#768390] mt-2 leading-relaxed">{t.portfolio.didYouSendDesc}</p>
        </DialogHeader>
        <div className="px-7 pb-7 pt-6 flex gap-3">
          <button
            onClick={() => onAnswer(false)}
            className="flex-1 py-3 rounded-lg text-sm font-medium bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] transition-colors"
          >
            {t.portfolio.no}
          </button>
          <button
            onClick={() => onAnswer(true)}
            className="flex-1 py-3 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors"
          >
            {t.portfolio.yes}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
