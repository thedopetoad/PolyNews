"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getWeb3AuthInstance } from "@/lib/web3auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useUser } from "@/hooks/use-user";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export function LoginButton() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { googleAddress, setGoogleAddress } = useAuthStore();
  const { user } = useUser();

  const connectedAddress = wagmiAddress || googleAddress;
  const isConnected = !!(wagmiConnected || googleAddress);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleGoogleLogin = useCallback(async () => {
    try {
      setGoogleLoading(true);
      const web3auth = getWeb3AuthInstance();
      if (!web3auth) return;
      if (web3auth.status === "not_ready") await web3auth.init();
      const provider = await web3auth.connect();
      if (provider) {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
        if (accounts && accounts.length > 0) {
          setGoogleAddress(accounts[0]);
          await fetch("/api/user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: accounts[0], authMethod: "google", walletAddress: accounts[0] }),
          });
          setLoginOpen(false);
        }
      }
    } catch (err) {
      console.error("Google login failed:", err);
    } finally {
      setGoogleLoading(false);
    }
  }, [setGoogleAddress]);

  const handleDisconnect = useCallback(async () => {
    if (wagmiConnected) wagmiDisconnect();
    if (googleAddress) {
      try { const w = getWeb3AuthInstance(); if (w) await w.logout(); } catch {}
      setGoogleAddress(null);
    }
    setMenuOpen(false);
  }, [wagmiConnected, wagmiDisconnect, googleAddress, setGoogleAddress]);

  // ─── Connected: address with simple dropdown ───
  if (isConnected && connectedAddress) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="h-8 px-3 rounded-full bg-[#1c2128] text-[#adbac7] text-xs font-medium border border-[#21262d] hover:border-[#30363d] transition-colors"
        >
          {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 w-48 rounded-lg border border-[#21262d] bg-[#161b22] shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#21262d]">
              <p className="text-[10px] text-[#484f58] uppercase">Wallet</p>
              <p className="text-[11px] text-[#adbac7] font-mono break-all">{connectedAddress}</p>
            </div>
            {user && (
              <div className="px-4 py-3 border-b border-[#21262d]">
                <p className="text-[10px] text-[#484f58] uppercase">Balance</p>
                <p className="text-base font-bold text-white tabular-nums">
                  {user.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} PST
                </p>
              </div>
            )}
            <button
              onClick={handleDisconnect}
              className="w-full text-left px-4 py-2.5 text-sm text-[#f85149] hover:bg-[#1c2128] transition-colors"
            >
              Log out
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Not connected ───
  const walletNames: Record<string, string> = {
    metaMaskSDK: "MetaMask", metaMask: "MetaMask",
    coinbaseWalletSDK: "Coinbase Wallet", coinbaseWallet: "Coinbase Wallet",
    walletConnect: "WalletConnect", phantom: "Phantom", injected: "Browser Wallet",
  };
  const walletColors: Record<string, string> = {
    MetaMask: "#E87F24", "Coinbase Wallet": "#0052FF",
    WalletConnect: "#3B99FC", Phantom: "#AB9FF2", "Browser Wallet": "#768390",
  };
  const seen = new Set<string>();
  const uniqueWallets = connectors.filter((c) => {
    const name = walletNames[c.id] || c.name;
    if (seen.has(name)) return false;
    seen.add(name); return true;
  });

  return (
    <>
      <button onClick={() => setLoginOpen(true)} className="h-8 px-4 rounded-full bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-medium transition-colors">
        Log In
      </button>
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="border-[#21262d] bg-[#161b22] max-w-sm">
          <DialogHeader><DialogTitle className="text-white text-center">Log in to PolyStream</DialogTitle></DialogHeader>
          <div className="space-y-2 mt-2">
            <button onClick={handleGoogleLogin} disabled={googleLoading}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0d1117] border border-[#21262d] hover:border-[#30363d] transition-colors text-left">
              <GoogleIcon />
              <span className="text-sm text-[#e6edf3] font-medium">{googleLoading ? "Connecting..." : "Continue with Google"}</span>
            </button>
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-[#21262d]" />
              <span className="text-[10px] text-[#484f58]">or connect wallet</span>
              <div className="flex-1 h-px bg-[#21262d]" />
            </div>
            {uniqueWallets.slice(0, 4).map((connector) => {
              const name = walletNames[connector.id] || connector.name;
              const color = walletColors[name] || "#768390";
              return (
                <button key={connector.uid} onClick={() => { connect({ connector }); setLoginOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0d1117] border border-[#21262d] hover:border-[#30363d] transition-colors text-left">
                  <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-sm text-[#e6edf3]">{name}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
