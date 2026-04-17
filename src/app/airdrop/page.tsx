"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { LoginButton } from "@/components/layout/login-modal";
import { ParticleBackground } from "@/components/ai/particle-background";
import { LeaderboardTab } from "@/components/airdrop/leaderboard-tab";
import { AirdropPortfolioTab } from "@/components/airdrop/portfolio-tab";

type Tab = "leaderboard" | "portfolio" | "trade" | "earn";
const TABS: { key: Tab; label: string }[] = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "portfolio", label: "Portfolio" },
  { key: "trade", label: "Trade" },
  { key: "earn", label: "Earn" },
];

function AirdropPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = useMemo<Tab>(() => {
    const raw = params.get("tab");
    return (TABS.find((t) => t.key === raw)?.key ?? "earn") as Tab;
  }, [params]);

  const setTab = useCallback(
    (next: Tab) => {
      const q = new URLSearchParams(params.toString());
      q.set("tab", next);
      router.replace(`/airdrop?${q.toString()}`, { scroll: false });
    },
    [router, params],
  );

  return (
    <>
      <ParticleBackground opacity={0.3} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {/* Gold AIRDROP crown glyph */}
            <div className="h-10 w-10 rounded-full border border-[#d4a843]/40 bg-gradient-to-br from-[#d4a843]/30 via-[#f5c542]/10 to-transparent flex items-center justify-center shadow-[0_0_20px_rgba(212,168,67,0.25)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#f5c542]" fill="currentColor">
                <path d="M3 8l4 4 5-8 5 8 4-4v10H3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#f5c542] via-[#d4a843] to-[#a07828] bg-clip-text text-transparent">
                Airdrop
              </h1>
              <p className="text-sm text-[#d4a843]/70 mt-0.5">
                Earn AIRDROP. Climb the boards. Win real cash.
              </p>
            </div>
          </div>
          <LoginButton />
        </div>

        {/* Tabs — gold active state */}
        <div className="flex border-b border-[#21262d] mb-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap",
                tab === t.key
                  ? "text-white border-b-2 border-[#d4a843] shadow-[inset_0_-10px_20px_-12px_rgba(212,168,67,0.4)]"
                  : "text-[#768390] hover:text-[#d4a843]/80",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div key={tab} className="animate-fade-in-up">
          {tab === "leaderboard" && <LeaderboardTab />}
          {tab === "portfolio" && <AirdropPortfolioTab />}
          {tab === "trade" && <TradePlaceholder />}
          {tab === "earn" && <EarnPlaceholder />}
        </div>
      </div>
    </>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/5 to-transparent p-12 text-center">
      <p className="text-[#d4a843] font-semibold mb-1">{title}</p>
      <p className="text-xs text-[#768390]">Coming online in the next phase of this rollout.</p>
    </div>
  );
}

function TradePlaceholder() { return <Placeholder title="Airdrop Trade" />; }
function EarnPlaceholder() { return <Placeholder title="Earn AIRDROP" />; }

export default function AirdropPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[#768390]">Loading…</div>}>
      <AirdropPageInner />
    </Suspense>
  );
}
