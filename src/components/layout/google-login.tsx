"use client";

import { useState, useCallback } from "react";
import { getWeb3AuthInstance } from "@/lib/web3auth";

export function GoogleLoginButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    try {
      setIsLoading(true);
      const web3auth = getWeb3AuthInstance();
      if (!web3auth) {
        alert("Web3Auth not configured");
        return;
      }

      if (web3auth.status === "not_ready") {
        await web3auth.init();
      }

      const provider = await web3auth.connect();
      if (provider) {
        // Get accounts from the provider
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[] | undefined;
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
          // Create/get user in DB
          await fetch("/api/user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: accounts[0],
              authMethod: "google",
              walletAddress: accounts[0],
            }),
          });
        }
      }
    } catch (err) {
      console.error("Google login failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    const web3auth = getWeb3AuthInstance();
    if (web3auth) {
      await web3auth.logout();
      setAddress(null);
    }
  }, []);

  if (address) {
    return (
      <button
        onClick={handleLogout}
        className="h-8 px-3 rounded-full bg-[#1c2128] text-[#768390] text-xs font-medium border border-[#21262d] hover:border-[#30363d] transition-colors"
      >
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={handleLogin}
      disabled={isLoading}
      className="h-8 px-3 rounded-full bg-white text-black text-xs font-medium hover:bg-gray-100 transition-colors flex items-center gap-1.5"
    >
      <svg width="14" height="14" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      {isLoading ? "..." : "Google"}
    </button>
  );
}
