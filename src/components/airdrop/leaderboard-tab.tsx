"use client";

import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";

// Three leaderboards rendered side-by-side (or stacked on mobile).
// Data comes from /api/airdrop/leaderboard?type=... and refetches
// every 30s while the tab is mounted. Prize pills are read from the
// admin-editable settings table via /api/settings/public.

type TotalRow = { rank: number; id: string; displayName: string | null; total: number; referralCount: number };
type WeeklyRefRow = { rank: number; id: string; displayName: string | null; count: number };
type WeeklyGainRow = { rank: number; id: string; displayName: string | null; gain: number };

interface PrizeMap {
  weeklyReferrals: (string | null)[];
  weeklyGainers: (string | null)[];
}

function usePrizes(): PrizeMap {
  const { data } = useQuery<PrizeMap>({
    queryKey: ["airdrop-prizes"],
    queryFn: async () => {
      const res = await fetch("/api/settings/public", { cache: "no-store" });
      if (!res.ok) throw new Error("prizes fetch failed");
      const json = (await res.json()) as { prizes?: PrizeMap };
      return json.prizes ?? { weeklyReferrals: [null, null, null], weeklyGainers: [null, null, null] };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  return data ?? { weeklyReferrals: [null, null, null], weeklyGainers: [null, null, null] };
}

const RANK_GLYPH: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function LeaderboardTab() {
  const { address } = useUser();
  const prizes = usePrizes();

  const totalQuery = useQuery<{ leaderboard: TotalRow[] }>({
    queryKey: ["airdrop-leaderboard", "total", address],
    queryFn: async () => {
      const headers: HeadersInit = address ? { Authorization: `Bearer ${address}` } : {};
      const r = await fetch("/api/airdrop/leaderboard?type=total", { headers, cache: "no-store" });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const weeklyRefQuery = useQuery<{ leaderboard: WeeklyRefRow[] }>({
    queryKey: ["airdrop-leaderboard", "weeklyReferrals", address],
    queryFn: async () => {
      const headers: HeadersInit = address ? { Authorization: `Bearer ${address}` } : {};
      const r = await fetch("/api/airdrop/leaderboard?type=weeklyReferrals", { headers, cache: "no-store" });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const weeklyGainQuery = useQuery<{ leaderboard: WeeklyGainRow[] }>({
    queryKey: ["airdrop-leaderboard", "weeklyGainers", address],
    queryFn: async () => {
      const headers: HeadersInit = address ? { Authorization: `Bearer ${address}` } : {};
      const r = await fetch("/api/airdrop/leaderboard?type=weeklyGainers", { headers, cache: "no-store" });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Weekly Referrals first — the virality board, pays weekly. */}
      <LeaderCard
        title="Weekly Referrals"
        subtitle="Most new signups this week."
        prizes={prizes.weeklyReferrals}
        isLoading={weeklyRefQuery.isLoading}
        error={weeklyRefQuery.error}
        rows={weeklyRefQuery.data?.leaderboard ?? []}
        renderRow={(row, i) => (
          <Row
            key={`wref-${i}`}
            rank={row.rank}
            id={row.id}
            displayName={row.displayName}
            isMe={row.id === address}
            right={<span className="text-sm font-semibold text-[#f5c542] tabular-nums">{row.count}</span>}
          />
        )}
      />

      {/* All-Time in the middle — bragging rights board, no cash prize. */}
      <LeaderCard
        title="All-Time Airdrop"
        subtitle="Biggest AIRDROP holders. Referrals drive the board."
        prizes={null}
        isLoading={totalQuery.isLoading}
        error={totalQuery.error}
        rows={totalQuery.data?.leaderboard ?? []}
        renderRow={(row, i) => (
          <Row
            key={`total-${i}`}
            rank={row.rank}
            id={row.id}
            displayName={row.displayName}
            isMe={row.id === address}
            right={
              <div className="flex flex-col items-end">
                <span className="text-sm font-semibold text-[#f5c542] tabular-nums">{row.total.toLocaleString()}</span>
                <span className="text-[10px] text-[#d4a843]/70">{row.referralCount} referrals</span>
              </div>
            }
          />
        )}
      />

      <LeaderCard
        title="Biggest Gainers"
        subtitle="Most AIRDROP earned this week."
        prizes={prizes.weeklyGainers}
        isLoading={weeklyGainQuery.isLoading}
        error={weeklyGainQuery.error}
        rows={weeklyGainQuery.data?.leaderboard ?? []}
        renderRow={(row, i) => (
          <Row
            key={`wgain-${i}`}
            rank={row.rank}
            id={row.id}
            displayName={row.displayName}
            isMe={row.id === address}
            right={<span className="text-sm font-semibold text-[#f5c542] tabular-nums">+{row.gain.toLocaleString()}</span>}
          />
        )}
      />
    </div>
  );
}

interface LeaderCardProps<T> {
  title: string;
  subtitle: string;
  // null = board doesn't have a cash prize (All-Time). Array of strings =
  // USDC numeric amounts (e.g. "25") from the settings table; rendered
  // with "$" prefix, or "TBD" when missing / 0 / unparsable.
  prizes: (string | null)[] | null;
  isLoading: boolean;
  error: unknown;
  rows: T[];
  renderRow: (row: T, i: number) => React.ReactNode;
}

function formatPrizePill(value: string | null | undefined): string {
  if (!value) return "TBD";
  const n = parseInt(value.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return "TBD";
  return `$${n}`;
}

function LeaderCard<T>({ title, subtitle, prizes, isLoading, error, rows, renderRow }: LeaderCardProps<T>) {
  return (
    <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/10 via-[#161b22] to-[#161b22] overflow-hidden">
      <div className="p-4 border-b border-[#d4a843]/20 bg-gradient-to-r from-[#d4a843]/10 to-transparent">
        <h3 className="text-base font-bold bg-gradient-to-r from-[#f5c542] to-[#d4a843] bg-clip-text text-transparent">{title}</h3>
        <p className="text-xs text-[#adbac7]/70 mt-0.5">{subtitle}</p>
        {prizes && (
          <div className="flex gap-1.5 mt-2">
            {prizes.slice(0, 3).map((p, i) => (
              <span
                key={i}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border font-medium",
                  i === 0 && "border-[#f5c542]/50 text-[#f5c542] bg-[#f5c542]/10",
                  i === 1 && "border-[#d4a843]/40 text-[#d4a843] bg-[#d4a843]/10",
                  i === 2 && "border-[#a07828]/40 text-[#a07828] bg-[#a07828]/10",
                )}
              >
                {RANK_GLYPH[i + 1]} {formatPrizePill(p)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="divide-y divide-[#21262d]">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-[#768390]">Loading...</div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-[#f85149]">Failed to load</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#768390]">Nobody here yet — be the first.</div>
        ) : (
          rows.slice(0, 20).map((row, i) => renderRow(row, i))
        )}
      </div>
    </div>
  );
}

function Row({
  rank,
  id,
  displayName,
  isMe,
  right,
}: {
  rank: number;
  id: string;
  displayName: string | null;
  isMe: boolean;
  right: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 hover:bg-[#d4a843]/5 transition-colors",
        isMe && "bg-[#d4a843]/15",
      )}
    >
      <div
        className={cn(
          "w-7 text-center text-sm font-bold tabular-nums",
          rank === 1 && "text-[#f5c542]",
          rank === 2 && "text-[#d4a843]",
          rank === 3 && "text-[#a07828]",
          rank > 3 && "text-[#768390]",
        )}
      >
        {rank <= 3 ? RANK_GLYPH[rank] : rank}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e6edf3] truncate">
          {displayName || id}
          {isMe && <span className="ml-2 text-[10px] text-[#f5c542] bg-[#f5c542]/10 px-1.5 py-0.5 rounded">you</span>}
        </p>
        {displayName && <p className="text-[10px] text-[#768390] truncate">{id}</p>}
      </div>
      {right}
    </div>
  );
}
