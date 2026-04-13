"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuthStore } from "@/stores/use-auth-store";
import {
  Shield,
  Users,
  AlertTriangle,
  Coins,
  TrendingUp,
  RefreshCw,
  Globe,
  Activity,
} from "lucide-react";

const ADMIN_ADDRESSES = [
  "0xfbeefb072f368803b33ba5c529f2f6762941b282", // Owner wallet
  "0x6f4e9f64d68abd067fbb1a2f62d21a1b01f190b1", // Team wallet
  "0xcf0b29d5c0ceede01543eb28400fdcb5034bc0fe", // Dan's wallet
];

interface AdminData {
  stats: {
    totalUsers: number;
    usersToday: number;
    usersThisWeek: number;
    totalAirdropsDistributed: number;
    totalAirdropClaims: number;
    totalTrades: number;
    totalTradeVolume: number;
  };
  airdropBreakdown: Array<{
    source: string;
    totalAmount: number;
    claimCount: number;
  }>;
  recentUsers: Array<{
    id: string;
    displayName: string | null;
    email: string | null;
    authMethod: string;
    balance: number;
    createdAt: string;
    lastLoginAt: string;
    signupIp: string | null;
    hasSignupAirdrop: boolean;
    referredBy: string | null;
  }>;
  recentTrades: Array<{
    id: string;
    userId: string;
    marketQuestion: string;
    side: string;
    shares: number;
    price: number;
    createdAt: string;
  }>;
  suspiciousAccounts: Array<{
    userId: string;
    reason: string;
    details: string;
  }>;
  suspiciousIps: Array<{
    ip: string;
    accountCount: number;
    userIds: string[];
  }>;
}

function maskAddress(addr: string): string {
  if (addr.startsWith("0x") && addr.length > 12) {
    return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  }
  return addr.length > 12 ? `${addr.slice(0, 8)}...${addr.slice(-4)}` : addr;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[#768390] text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-[#484f58] mt-1">{sub}</div>}
    </div>
  );
}

function ReasonBadge({ reason }: { reason: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    HIGH_BALANCE: {
      bg: "bg-[#d29922]/10",
      text: "text-[#d29922]",
      label: "High Balance",
    },
    EXCESSIVE_CLAIMS: {
      bg: "bg-[#f85149]/10",
      text: "text-[#f85149]",
      label: "Excessive Claims",
    },
    SHARED_IP: {
      bg: "bg-[#a371f7]/10",
      text: "text-[#a371f7]",
      label: "Shared IP",
    },
  };
  const c = config[reason] || {
    bg: "bg-[#484f58]/10",
    text: "text-[#484f58]",
    label: reason,
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

export default function AdminPage() {
  const { address } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  const connectedAddress = (address || googleAddress)?.toLowerCase();
  const isAdmin =
    !!connectedAddress && ADMIN_ADDRESSES.includes(connectedAddress);

  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editBalance, setEditBalance] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // User detail drill-down
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<{
    user: AdminData["recentUsers"][0] | null;
    trades: AdminData["recentTrades"][];
    positions: Array<{ id: string; marketId: string; marketQuestion: string; outcome: string; shares: number; avgPrice: number; clobTokenId: string | null; createdAt: string; updatedAt: string }>;
    airdrops: Array<{ id: string; source: string; amount: number; createdAt: string }>;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchAdmin = useCallback(async () => {
    if (!connectedAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        headers: { Authorization: `Bearer ${connectedAddress}` },
      });
      if (!res.ok) {
        setError(res.status === 403 ? "Access denied" : "Failed to load data");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [connectedAddress]);

  useEffect(() => {
    if (isAdmin) fetchAdmin();
  }, [isAdmin, fetchAdmin]);

  const fetchUserDetail = useCallback(async (userId: string) => {
    if (!connectedAddress) return;
    if (selectedUserId === userId) { setSelectedUserId(null); setUserDetail(null); return; }
    setSelectedUserId(userId);
    setDetailLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${connectedAddress}` },
        body: JSON.stringify({ action: "getUserDetails", userId }),
      });
      if (res.ok) setUserDetail(await res.json());
    } catch {}
    setDetailLoading(false);
  }, [connectedAddress, selectedUserId]);

  const adminAction = async (action: string, userId: string, balance?: number) => {
    if (!connectedAddress) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connectedAddress}`,
        },
        body: JSON.stringify({ action, userId, balance }),
      });
      if (res.ok) {
        setEditingUser(null);
        setEditBalance("");
        fetchAdmin();
      }
    } catch {}
    setActionLoading(false);
  };

  // Not connected or not admin
  if (!connectedAddress || !isAdmin) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <Shield className="w-16 h-16 text-[#f85149] mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-[#768390]">
          {!connectedAddress
            ? "Connect an authorized wallet to access the admin dashboard."
            : `Your wallet is not authorized to view this page.`}
        </p>
        {connectedAddress && (
          <p className="text-[#484f58] text-xs mt-3 font-mono">
            Connected as: {connectedAddress}
          </p>
        )}
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <RefreshCw className="w-8 h-8 text-[#58a6ff] mx-auto mb-4 animate-spin" />
        <p className="text-[#768390]">Loading admin dashboard...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <AlertTriangle className="w-12 h-12 text-[#f85149] mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Error</h1>
        <p className="text-[#768390]">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#58a6ff]" />
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
        </div>
        <button
          onClick={fetchAdmin}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#21262d] text-[#768390] hover:text-white text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard
          icon={Users}
          label="Total Users"
          value={data.stats.totalUsers}
          sub={`${data.stats.usersToday} today / ${data.stats.usersThisWeek} this week`}
          color="text-[#58a6ff]"
        />
        <StatCard
          icon={Coins}
          label="Airdrops Distributed"
          value={data.stats.totalAirdropsDistributed.toLocaleString()}
          sub={`${data.stats.totalAirdropClaims} total claims`}
          color="text-[#3fb950]"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Trades"
          value={data.stats.totalTrades}
          sub={`${data.stats.totalTradeVolume.toLocaleString()} volume`}
          color="text-[#d29922]"
        />
        <StatCard
          icon={AlertTriangle}
          label="Suspicious"
          value={data.suspiciousAccounts.length}
          sub={`${data.suspiciousIps.length} shared IPs`}
          color="text-[#f85149]"
        />
      </div>

      {/* Airdrop Breakdown */}
      {data.airdropBreakdown.length > 0 && (
        <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Coins className="w-4 h-4 text-[#3fb950]" />
            Airdrop Breakdown
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.airdropBreakdown.map((a) => (
              <div key={a.source} className="bg-[#0d1117] rounded-md p-3">
                <div className="text-xs text-[#768390] uppercase mb-1">
                  {a.source}
                </div>
                <div className="text-lg font-bold text-white">
                  {Number(a.totalAmount).toLocaleString()}
                </div>
                <div className="text-xs text-[#484f58]">
                  {a.claimCount} claims
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suspicious Accounts */}
      {data.suspiciousAccounts.length > 0 && (
        <div className="bg-[#161b22] border border-[#f85149]/20 rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#f85149]" />
            Suspicious Accounts ({data.suspiciousAccounts.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#484f58] border-b border-[#21262d]">
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">Reason</th>
                  <th className="pb-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.suspiciousAccounts.map((s, i) => (
                  <tr key={i} className="border-b border-[#21262d]/50">
                    <td className="py-2 pr-4 font-mono text-xs text-[#e6edf3]">
                      {maskAddress(s.userId)}
                    </td>
                    <td className="py-2 pr-4">
                      <ReasonBadge reason={s.reason} />
                    </td>
                    <td className="py-2 text-[#768390] text-xs">
                      {s.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Suspicious IPs */}
      {data.suspiciousIps.length > 0 && (
        <div className="bg-[#161b22] border border-[#a371f7]/20 rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#a371f7]" />
            Multi-Account IPs ({data.suspiciousIps.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#484f58] border-b border-[#21262d]">
                  <th className="pb-2 pr-4">IP Address</th>
                  <th className="pb-2 pr-4">Accounts</th>
                  <th className="pb-2 pr-4">User IDs</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.suspiciousIps.map((ip, i) => (
                  <tr key={i} className="border-b border-[#21262d]/50">
                    <td className="py-2 pr-4 font-mono text-xs text-[#e6edf3]">
                      {ip.ip}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-[#a371f7]/10 text-[#a371f7]">
                        {ip.accountCount}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[#768390] text-xs font-mono">
                      {ip.userIds.map(maskAddress).join(", ")}
                    </td>
                    <td className="py-2">
                      {ip.accountCount === 2 && (
                        <button
                          onClick={async () => {
                            if (!confirm(`Migrate older account to newer? This merges positions, trades, airdrops, and balance from the older account into the newer one, then deletes the old account. IDs: ${ip.userIds.join(", ")}`)) return;
                            await adminAction("migrateAccounts", ip.userIds[0], undefined);
                            // Pass both IDs via the userId field (comma-separated)
                            await fetch("/api/admin", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${connectedAddress}` },
                              body: JSON.stringify({ action: "migrateAccounts", userIds: ip.userIds }),
                            }).then(() => fetchAdmin());
                          }}
                          disabled={actionLoading}
                          className="text-[10px] px-2 py-0.5 rounded bg-[#58a6ff]/10 text-[#58a6ff] hover:bg-[#58a6ff]/20 disabled:opacity-50"
                        >
                          Migrate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Trades */}
      {data.recentTrades.length > 0 && (
        <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#d29922]" />
            Recent Trades
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#484f58] border-b border-[#21262d]">
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">Side</th>
                  <th className="pb-2 pr-4">Shares</th>
                  <th className="pb-2 pr-4">Price</th>
                  <th className="pb-2 pr-4">Market</th>
                  <th className="pb-2">When</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTrades.map((t) => (
                  <tr key={t.id} className="border-b border-[#21262d]/50">
                    <td className="py-2 pr-4 font-mono text-xs text-[#e6edf3]">
                      <button onClick={() => fetchUserDetail(t.userId)} className="hover:text-[#58a6ff] transition-colors cursor-pointer" title="View user details">
                        {maskAddress(t.userId)}
                      </button>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs font-medium ${t.side === "buy" ? "text-[#3fb950]" : "text-[#f85149]"}`}
                      >
                        {t.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[#e6edf3]">
                      {t.shares.toFixed(1)}
                    </td>
                    <td className="py-2 pr-4 text-[#e6edf3]">
                      ${t.price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-[#768390] text-xs max-w-[200px] truncate">
                      {t.marketQuestion}
                    </td>
                    <td className="py-2 text-[#484f58] text-xs">
                      {timeAgo(t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Users */}
      <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-[#58a6ff]" />
          Recent Signups ({data.recentUsers.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#484f58] border-b border-[#21262d]">
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Auth</th>
                <th className="pb-2 pr-4">Balance</th>
                <th className="pb-2 pr-4">IP</th>
                <th className="pb-2 pr-4">Referred</th>
                <th className="pb-2 pr-4">Joined</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.recentUsers.map((u) => (<>
                <tr key={u.id} className={`border-b border-[#21262d]/50 cursor-pointer transition-colors ${selectedUserId === u.id ? "bg-[#58a6ff]/5" : "hover:bg-[#1c2128]"}`} onClick={() => fetchUserDetail(u.id)}>
                  <td className="py-2 pr-4 font-mono text-xs text-[#e6edf3]">
                    <span
                      className="hover:text-[#58a6ff] transition-colors"
                      title={u.id}
                    >
                      {maskAddress(u.id)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-[#e6edf3]">
                    {u.displayName || "-"}
                  </td>
                  <td className="py-2 pr-4 text-xs text-[#768390]">
                    {u.email || "-"}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`text-xs ${u.authMethod === "wallet" ? "text-[#58a6ff]" : "text-[#d29922]"}`}
                    >
                      {u.authMethod}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-[#e6edf3]">
                    {editingUser === u.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={editBalance}
                          onChange={(e) => setEditBalance(e.target.value)}
                          className="w-20 bg-[#0d1117] border border-[#30363d] rounded px-1.5 py-0.5 text-xs text-white"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") adminAction("setBalance", u.id, parseFloat(editBalance));
                            if (e.key === "Escape") setEditingUser(null);
                          }}
                        />
                        <button
                          onClick={() => adminAction("setBalance", u.id, parseFloat(editBalance))}
                          disabled={actionLoading}
                          className="text-[10px] text-[#3fb950] hover:underline"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:text-[#58a6ff]"
                        onClick={() => { setEditingUser(u.id); setEditBalance(String(u.balance)); }}
                        title="Click to edit"
                      >
                        {u.balance.toLocaleString()}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-[#768390]">
                    {u.signupIp || "-"}
                  </td>
                  <td className="py-2 pr-4 text-xs text-[#768390]">
                    {u.referredBy || "-"}
                  </td>
                  <td className="py-2 pr-4 text-[#484f58] text-xs">
                    {timeAgo(u.createdAt)}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); adminAction("resetBalance", u.id); }}
                      disabled={actionLoading}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 disabled:opacity-50"
                    >
                      Reset
                    </button>
                  </td>
                </tr>
                {/* Expanded user detail row */}
                {selectedUserId === u.id && (
                  <tr key={`${u.id}-detail`}>
                    <td colSpan={9} className="p-0">
                      <div className="bg-[#0d1117] border-t border-b border-[#58a6ff]/20 p-4 space-y-4">
                        {detailLoading ? (
                          <p className="text-xs text-[#484f58] text-center py-4">Loading user data...</p>
                        ) : userDetail ? (
                          <>
                            {/* User positions */}
                            <div>
                              <h3 className="text-xs font-semibold text-[#58a6ff] mb-2">Open Positions ({userDetail.positions?.length || 0})</h3>
                              {(userDetail.positions?.length || 0) === 0 ? (
                                <p className="text-xs text-[#484f58]">No open positions</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead><tr className="text-[#484f58] border-b border-[#21262d]">
                                    <th className="pb-1 text-left pr-3">Market</th>
                                    <th className="pb-1 text-left pr-3">Outcome</th>
                                    <th className="pb-1 text-right pr-3">Shares</th>
                                    <th className="pb-1 text-right pr-3">Avg Price</th>
                                    <th className="pb-1 text-right">Value</th>
                                  </tr></thead>
                                  <tbody>
                                    {userDetail.positions.map((p: { id: string; marketQuestion: string; outcome: string; shares: number; avgPrice: number }) => (
                                      <tr key={p.id} className="border-b border-[#21262d]/30">
                                        <td className="py-1.5 pr-3 text-[#e6edf3] max-w-[200px] truncate">{p.marketQuestion}</td>
                                        <td className="py-1.5 pr-3 text-[#768390]">{p.outcome}</td>
                                        <td className="py-1.5 pr-3 text-right text-[#e6edf3] tabular-nums">{p.shares.toFixed(1)}</td>
                                        <td className="py-1.5 pr-3 text-right text-[#e6edf3] tabular-nums">{(p.avgPrice * 100).toFixed(0)}¢</td>
                                        <td className="py-1.5 text-right text-[#3fb950] tabular-nums font-medium">{(p.shares * p.avgPrice).toFixed(0)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>

                            {/* User trades */}
                            <div>
                              <h3 className="text-xs font-semibold text-[#d29922] mb-2">Trade History ({userDetail.trades?.length || 0})</h3>
                              {(userDetail.trades?.length || 0) === 0 ? (
                                <p className="text-xs text-[#484f58]">No trades</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead><tr className="text-[#484f58] border-b border-[#21262d]">
                                    <th className="pb-1 text-left pr-3">Side</th>
                                    <th className="pb-1 text-left pr-3">Market</th>
                                    <th className="pb-1 text-left pr-3">Outcome</th>
                                    <th className="pb-1 text-right pr-3">Shares</th>
                                    <th className="pb-1 text-right pr-3">Price</th>
                                    <th className="pb-1 text-right">When</th>
                                  </tr></thead>
                                  <tbody>
                                    {(userDetail.trades as unknown as Array<{ id: string; side: string; marketQuestion: string; outcome: string; shares: number; price: number; createdAt: string }>).map((t) => (
                                      <tr key={t.id} className="border-b border-[#21262d]/30">
                                        <td className="py-1.5 pr-3"><span className={t.side === "buy" ? "text-[#3fb950]" : "text-[#f85149]"}>{t.side.toUpperCase()}</span></td>
                                        <td className="py-1.5 pr-3 text-[#e6edf3] max-w-[180px] truncate">{t.marketQuestion}</td>
                                        <td className="py-1.5 pr-3 text-[#768390]">{t.outcome}</td>
                                        <td className="py-1.5 pr-3 text-right text-[#e6edf3] tabular-nums">{t.shares.toFixed(1)}</td>
                                        <td className="py-1.5 pr-3 text-right text-[#e6edf3] tabular-nums">{(t.price * 100).toFixed(0)}¢</td>
                                        <td className="py-1.5 text-right text-[#484f58]">{timeAgo(t.createdAt)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>

                            {/* User airdrops */}
                            {(userDetail.airdrops?.length || 0) > 0 && (
                              <div>
                                <h3 className="text-xs font-semibold text-[#3fb950] mb-2">Airdrop Claims ({userDetail.airdrops.length})</h3>
                                <div className="flex gap-2 flex-wrap">
                                  {userDetail.airdrops.map((a: { id: string; source: string; amount: number; createdAt: string }) => (
                                    <span key={a.id} className="text-[10px] bg-[#21262d] text-[#768390] px-2 py-0.5 rounded">
                                      {a.source}: {a.amount} · {timeAgo(a.createdAt)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-[#f85149]">Failed to load user data</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
