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
        {/* Glow accent — eases from center outward to both edges each time
            the modal opens, instead of being instantly full-width. */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#58a6ff]/60 to-transparent animate-accent-line-expand" />

        {/* Icon + animated paper plane flying along a dashed arc behind it */}
        <div className="flex justify-center pt-7">
          <div className="relative h-14 w-14 rounded-full bg-[#58a6ff]/10 ring-1 ring-[#58a6ff]/20 flex items-center justify-center overflow-hidden">
            <AnimatedPaperPlane />
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

/**
 * Paper plane that flies along a dashed arc inside the 44-px circle.
 * A quadratic Bezier from bottom-left to top-right is drawn as a dashed
 * trail; the plane shape follows the same curve via SVG <animateMotion>
 * with rotate="auto" so it points along the tangent.
 *
 * Using native SVG animation rather than CSS offset-path for better
 * cross-browser consistency (Safari + mobile quirks).
 */
function AnimatedPaperPlane() {
  const pathD = "M 4 32 Q 20 2 40 12";
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 44 44"
      fill="none"
      className="absolute inset-0"
      aria-hidden="true"
    >
      {/* Dashed trail — the curve the plane travels along. Subtle — just
          hints at the motion without competing with the plane itself. */}
      <path
        d={pathD}
        stroke="#58a6ff"
        strokeOpacity="0.35"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="2 3"
      />
      {/* Plane: triangle with a little notch, drawn at origin so
          animateMotion translates it along the path. rotate="auto"
          keeps it pointing forward. */}
      <g>
        <path
          d="M -4 -2 L 4 0 L -4 2 L -2 0 Z"
          fill="#58a6ff"
        >
          <animateMotion
            dur="2.8s"
            repeatCount="indefinite"
            path={pathD}
            rotate="auto"
            keyTimes="0;1"
            keySplines="0.45 0.05 0.55 0.95"
            calcMode="spline"
          />
        </path>
      </g>
    </svg>
  );
}
