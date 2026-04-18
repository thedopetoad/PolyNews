"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Shield,
  Users,
  AlertTriangle,
  Coins,
  TrendingUp,
  RefreshCw,
  Globe,
  Activity,
  LogOut,
} from "lucide-react";
import { PrizeEditor } from "@/components/admin/prize-editor";
import { PayoutsBoard } from "@/components/admin/payouts-board";
import { deriveProxyAddress } from "@/lib/proxy";

// The single Solana Phantom wallet allowed into admin. Must match
// ADMIN_SOLANA_PUBKEY on the server. If you ever rotate this, update
// both places — there's no runtime configuration.
const ADMIN_SOLANA_PUBKEY = "4HHN3zLhVuUcfXuw8MofXLARnQwLgzVhHdPDcBWBiEVT";

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

/**
 * Fund-user card shown inside the expanded user-detail drawer.
 *
 * Custody-free: we derive the user's Polymarket CREATE2 proxy address
 * client-side and hand it to the admin, who sends USDC.e from their
 * own wallet (MetaMask, hardware wallet, whatever). The system never
 * holds funds. Admin should send on Polygon (chain 137) — USDC.e
 * contract: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174.
 *
 * Guards against non-wallet user.ids (legacy test accounts) by
 * returning a disabled card.
 */
function FundUserCard({ eoa, displayName }: { eoa: string; displayName: string | null }) {
  const [copied, setCopied] = useState<"proxy" | "eoa" | null>(null);
  const isValidEoa = /^0x[a-fA-F0-9]{40}$/.test(eoa);
  const proxy = isValidEoa ? deriveProxyAddress(eoa) : null;

  const copy = (text: string, kind: "proxy" | "eoa") => {
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!isValidEoa || !proxy) {
    return (
      <div className="rounded-lg border border-[#d29922]/30 bg-[#d29922]/5 p-3 text-xs text-[#d29922]">
        This user&rsquo;s id isn&rsquo;t a valid EVM address — no proxy wallet to derive.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#3fb950]/30 bg-gradient-to-b from-[#3fb950]/5 via-[#0d1117] to-[#0d1117] p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold text-[#3fb950] flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
            Fund {displayName || "this user"}&rsquo;s account
          </h3>
          <p className="text-[10px] text-[#768390] mt-0.5">
            Send USDC.e on <span className="text-[#a371f7] font-semibold">Polygon</span> (chain 137) to their proxy wallet below. Funds land in their Polymarket balance immediately.
          </p>
        </div>
        <a
          href={`https://polygonscan.com/token/0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174?a=${proxy}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[#58a6ff] hover:underline whitespace-nowrap"
        >
          View USDC.e balance on Polygonscan ↗
        </a>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Proxy wallet (send USDC.e here)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-xs font-mono text-[#e6edf3] truncate select-all">
              {proxy}
            </code>
            <button
              onClick={() => copy(proxy, "proxy")}
              className={`text-xs font-semibold px-3 py-1.5 rounded border whitespace-nowrap transition-colors ${
                copied === "proxy"
                  ? "bg-[#3fb950]/20 text-[#3fb950] border-[#3fb950]/30"
                  : "bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/20 hover:bg-[#3fb950]/20"
              }`}
            >
              {copied === "proxy" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">User&rsquo;s EOA (for reference)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 bg-[#161b22] border border-[#21262d] rounded px-2.5 py-1.5 text-xs font-mono text-[#768390] truncate select-all">
              {eoa}
            </code>
            <button
              onClick={() => copy(eoa, "eoa")}
              className="text-xs font-semibold px-3 py-1.5 rounded border bg-[#21262d] text-[#adbac7] border-[#30363d] hover:bg-[#30363d] whitespace-nowrap"
            >
              {copied === "eoa" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Window shim for Phantom's injected Solana provider.
interface PhantomSolana {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  signMessage: (msg: Uint8Array, encoding?: "utf8") => Promise<{ signature: Uint8Array }>;
}
declare global {
  interface Window {
    solana?: PhantomSolana;
    phantom?: { solana?: PhantomSolana };
  }
}
function getPhantomSolana(): PhantomSolana | null {
  if (typeof window === "undefined") return null;
  const provider = window.phantom?.solana ?? window.solana;
  return provider?.isPhantom ? provider : null;
}

export default function AdminPage() {
  // `authed` is true once the server has confirmed our admin cookie via
  // /api/admin/me. Gate all admin data fetches on this.
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [authedPubkey, setAuthedPubkey] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

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
  const [detailError, setDetailError] = useState<string | null>(null);

  // User search — debounced server-side ILIKE across id/name/email/wallet/IP.
  // Empty query returns the most recent 100, so the table is always
  // populated. When non-empty, swaps results into the same table that
  // Recent Signups uses so the expansion drawer + actions just work.
  const [userSearch, setUserSearch] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<{
    users: AdminData["recentUsers"];
    shownCount: number;
    totalCount: number;
  } | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);

  useEffect(() => {
    if (authed !== true) return;
    setUserSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/users?q=${encodeURIComponent(userSearch.trim())}`,
          { credentials: "include" }
        );
        if (res.ok) setUserSearchResults(await res.json());
      } catch {}
      setUserSearchLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [userSearch, authed]);

  // On mount: verify the session TWO ways.
  //   1. Cookie check — the server-side HMAC session is still valid.
  //   2. Wallet check — Phantom is still actively trusting this dApp with
  //      the admin pubkey. If the user revoked trust in Phantom's settings
  //      AFTER signing in, the cookie alone can't tell us; we'd stay
  //      "logged in" for 24h until TTL. Adding the wallet check closes
  //      that gap — phantom.connect({ onlyIfTrusted: true }) silently
  //      succeeds iff the user still trusts us, else throws.
  //   If wallet check fails, nuke the cookie server-side so next visit
  //   starts clean. Behaves like the intuitive "disconnected wallet = not
  //   logged in" mental model.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { credentials: "include" });
        if (cancelled) return;
        if (!res.ok) {
          setAuthed(false);
          return;
        }
        const data = await res.json();
        // Verify Phantom still trusts us.
        const phantom = getPhantomSolana();
        if (!phantom) {
          // Phantom not installed / not detectable — treat as disconnected
          await fetch("/api/admin/login", { method: "DELETE", credentials: "include" }).catch(() => {});
          if (!cancelled) setAuthed(false);
          return;
        }
        try {
          const conn = await phantom.connect({ onlyIfTrusted: true });
          const currentPubkey = conn.publicKey.toString();
          if (currentPubkey !== ADMIN_SOLANA_PUBKEY) {
            // Different wallet is now active in Phantom, or pubkey mismatch
            await fetch("/api/admin/login", { method: "DELETE", credentials: "include" }).catch(() => {});
            if (!cancelled) setAuthed(false);
            return;
          }
          if (!cancelled) {
            setAuthed(true);
            setAuthedPubkey(data.pubkey || currentPubkey);
          }
        } catch {
          // onlyIfTrusted:true throws if user revoked trust or Phantom is
          // locked. Either way, session is no longer valid — log out.
          await fetch("/api/admin/login", { method: "DELETE", credentials: "include" }).catch(() => {});
          if (!cancelled) setAuthed(false);
        }
      } catch {
        if (!cancelled) setAuthed(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Also listen for Phantom's `disconnect` event — fires if the user
  // disconnects from Phantom's own UI while this tab is open. Nuke the
  // session immediately so the admin page locks without a refresh.
  useEffect(() => {
    const phantom = getPhantomSolana();
    if (!phantom) return;
    const handleDisconnect = async () => {
      await fetch("/api/admin/login", { method: "DELETE", credentials: "include" }).catch(() => {});
      setAuthed(false);
      setAuthedPubkey(null);
      setData(null);
    };
    // Some Phantom builds expose `.on`, some expose events on the provider
    // differently. Try the standard path and silently no-op if unavailable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = phantom as any;
    if (typeof p.on === "function") {
      p.on("disconnect", handleDisconnect);
      p.on("accountChanged", handleDisconnect);
      return () => {
        if (typeof p.removeListener === "function") {
          p.removeListener("disconnect", handleDisconnect);
          p.removeListener("accountChanged", handleDisconnect);
        }
      };
    }
  }, []);

  // Phantom Solana sign-in flow:
  //   1. GET /api/admin/login?step=nonce → server returns a challenge message
  //   2. phantom.signMessage(message) → returns 64-byte ed25519 signature
  //   3. POST /api/admin/login with { message, signature, publicKey }
  //   4. Server verifies + sets HttpOnly cookie; we re-check /me
  const signInWithPhantom = async () => {
    setSignInError(null);
    const phantom = getPhantomSolana();
    if (!phantom) {
      setSignInError("Phantom not detected. Install the Phantom browser extension.");
      return;
    }
    setSigningIn(true);
    try {
      // Connect first — this is the user-facing permission popup
      const connect = await phantom.connect();
      const publicKey = connect.publicKey.toString();
      if (publicKey !== ADMIN_SOLANA_PUBKEY) {
        setSignInError(`This wallet is not authorized. Connected: ${publicKey.slice(0, 8)}…${publicKey.slice(-4)}`);
        setSigningIn(false);
        return;
      }

      // Fetch the challenge message
      const nonceRes = await fetch("/api/admin/login?step=nonce");
      if (!nonceRes.ok) {
        setSignInError("Could not get challenge from server");
        setSigningIn(false);
        return;
      }
      const { message } = await nonceRes.json();

      // Sign with Phantom (Solana ed25519)
      const msgBytes = new TextEncoder().encode(message);
      const { signature } = await phantom.signMessage(msgBytes, "utf8");

      // Convert signature to base64 for transport
      let bin = "";
      for (let i = 0; i < signature.length; i++) bin += String.fromCharCode(signature[i]);
      const signatureB64 = btoa(bin);

      // Submit for verification + cookie issue
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message, signature: signatureB64, publicKey }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSignInError(err.error || "Sign-in failed");
        setSigningIn(false);
        return;
      }
      setAuthed(true);
      setAuthedPubkey(publicKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      setSignInError(msg.includes("User rejected") ? "Signature cancelled" : msg);
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/admin/login", { method: "DELETE", credentials: "include" });
    } catch {}
    setAuthed(false);
    setAuthedPubkey(null);
    setData(null);
  };

  const fetchAdmin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", { credentials: "include" });
      if (!res.ok) {
        setError(res.status === 403 ? "Access denied — re-sign in" : "Failed to load data");
        if (res.status === 403) setAuthed(false);
        return;
      }
      setData(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed === true) fetchAdmin();
  }, [authed, fetchAdmin]);

  const fetchUserDetail = useCallback(async (userId: string) => {
    if (selectedUserId === userId) { setSelectedUserId(null); setUserDetail(null); setDetailError(null); return; }
    setSelectedUserId(userId);
    setUserDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "getUserDetails", userId }),
      });
      if (res.ok) {
        setUserDetail(await res.json());
      } else {
        // Parse { error: "…" } shape; fall back to raw body + status code.
        const raw = await res.text();
        let msg = `${res.status}`;
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed.error) msg = `${res.status} — ${parsed.error}`;
        } catch {
          if (raw) msg = `${res.status} — ${raw.slice(0, 200)}`;
        }
        setDetailError(msg);
      }
    } catch (err) {
      setDetailError(`Network error: ${(err as Error).message}`);
    }
    setDetailLoading(false);
  }, [selectedUserId]);

  const adminAction = async (action: string, userId: string, balance?: number) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

  // While we're checking the cookie, show nothing flashy
  if (authed === null) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <RefreshCw className="w-8 h-8 text-[#58a6ff] mx-auto mb-4 animate-spin" />
      </div>
    );
  }

  // Sign-in screen — shown until Phantom successfully authenticates
  if (!authed) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-8 text-center">
          <Shield className="w-12 h-12 text-[#58a6ff] mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white mb-1">Admin sign-in</h1>
          <p className="text-sm text-[#768390] mb-6">
            Sign a message with your Phantom wallet to continue. Only the
            authorized admin pubkey is accepted.
          </p>
          <button
            onClick={signInWithPhantom}
            disabled={signingIn}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#ab9ff2] text-[#0d1117] hover:bg-[#c4b9ff] disabled:opacity-50 transition-colors"
          >
            {signingIn ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Signing…
              </>
            ) : (
              "Sign in with Phantom"
            )}
          </button>
          {signInError && (
            <p className="mt-4 text-xs text-[#f85149] bg-[#f85149]/10 px-3 py-2 rounded-md">
              {signInError}
            </p>
          )}
        </div>
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
          {authedPubkey && (
            <span className="hidden sm:inline text-[10px] font-mono text-[#484f58] ml-2">
              {authedPubkey.slice(0, 4)}…{authedPubkey.slice(-4)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAdmin}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#21262d] text-[#768390] hover:text-white text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={logout}
            title="Sign out"
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#21262d] text-[#768390] hover:text-[#f85149] text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
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

      {/* Leaderboard prize editor */}
      <PrizeEditor />

      {/* Weekly payouts board */}
      <PayoutsBoard />

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
                            setActionLoading(true);
                            try {
                              const res = await fetch("/api/admin", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                                body: JSON.stringify({ action: "migrateAccounts", userIds: ip.userIds }),
                              });
                              if (res.ok) {
                                const data = await res.json();
                                alert(`Migration complete! Merged ${data.from.slice(0,10)}… into ${data.to.slice(0,10)}…`);
                              } else {
                                const err = await res.json();
                                alert(`Migration failed: ${err.error}`);
                              }
                              fetchAdmin();
                            } catch (e) {
                              alert(`Migration error: ${e}`);
                            }
                            setActionLoading(false);
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

      {/* Recent Users + search. The search input swaps server results
          into the same table — same row layout, same expansion drawer,
          same action buttons all work unchanged. */}
      {(() => {
        const usersToShow = userSearchResults?.users ?? data.recentUsers;
        const isSearching = userSearch.trim().length > 0;
        const showingTruncated =
          userSearchResults != null &&
          userSearchResults.shownCount < userSearchResults.totalCount;
        return (
      <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-[#58a6ff]" />
            {isSearching ? "Search results" : "Recent Signups"} ({usersToShow.length}
            {showingTruncated ? ` of ${userSearchResults!.totalCount}` : ""})
          </h2>
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by name, email, wallet, code, IP…"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1 text-xs text-white placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff]"
            />
            {userSearchLoading && (
              <RefreshCw className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#58a6ff] animate-spin" />
            )}
          </div>
        </div>
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
              {usersToShow.map((u) => (<>
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
                        {/* Fund card renders immediately — derived purely
                            from u.id, doesn't need the detail fetch. The
                            whole point of opening the drawer is usually
                            to grab this address. */}
                        <FundUserCard eoa={u.id} displayName={u.displayName} />

                        {detailLoading ? (
                          <p className="text-xs text-[#484f58] text-center py-4">Loading positions, trades &amp; airdrops…</p>
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
                          <p className="text-xs text-[#f85149] font-mono break-all">
                            Failed to load user data{detailError ? ` — ${detailError}` : ""}
                          </p>
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
        );
      })()}
    </div>
  );
}
