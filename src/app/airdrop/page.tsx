"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { LoginButton } from "@/components/layout/login-modal";
import { ParticleBackground } from "@/components/ai/particle-background";
import { LeaderboardTab } from "@/components/airdrop/leaderboard-tab";
import { AirdropPortfolioTab } from "@/components/airdrop/portfolio-tab";
import { AirdropTradeTab } from "@/components/airdrop/trade-tab";
import { AirdropEarnTab } from "@/components/airdrop/earn-tab";

type Tab = "leaderboard" | "portfolio" | "trade" | "earn";
const TABS: { key: Tab; label: string }[] = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "portfolio", label: "Portfolio" },
  { key: "trade", label: "Trade" },
  { key: "earn", label: "Earn" },
];

function resolveInitialTab(raw: string | null): Tab {
  return (TABS.find((t) => t.key === raw)?.key ?? "earn") as Tab;
}

function AirdropPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  // Local state drives the UI. URL stays in sync so deep-links and
  // back/forward work, but tab switching never depends on the URL
  // round-tripping — under Next 16 App Router, router.replace doesn't
  // always re-trigger components that read from useSearchParams, which
  // made the tabs look dead.
  const [tab, setTabState] = useState<Tab>(() => resolveInitialTab(params.get("tab")));

  // External URL changes (back button, deep link) update local state.
  useEffect(() => {
    const next = resolveInitialTab(params.get("tab"));
    setTabState((prev) => (prev === next ? prev : next));
  }, [params]);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      router.replace(`/airdrop?tab=${next}`, { scroll: false });
    },
    [router],
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
              type="button"
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
          {tab === "trade" && <AirdropTradeTab />}
          {tab === "earn" && <AirdropEarnTab />}
        </div>
      </div>
    </>
  );
}


export default function AirdropPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[#768390]">Loading…</div>}>
      <AirdropPageInner />
    </Suspense>
  );
}
