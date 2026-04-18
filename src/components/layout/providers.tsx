"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkMagicSession, handleOAuthRedirect, getMagic, consumePostLoginReturnPath, type OAuthResult } from "@/lib/magic";
import { useAuthStore } from "@/stores/use-auth-store";
import { magicConnector, prepareMagicConnector } from "@/lib/magic-connector";
import { I18nProvider } from "@/lib/i18n";
import { WagmiProvider, createConfig, http, useConnect, useAccount } from "wagmi";
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
  phantomWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { polygon } from "wagmi/chains";

import "@rainbow-me/rainbowkit/styles.css";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "placeholder";

const rainbowConnectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [
        metaMaskWallet,
        coinbaseWallet,
        phantomWallet,
        walletConnectWallet,
      ],
    },
  ],
  {
    appName: "PolyStream",
    projectId,
  }
);

// viem's default Polygon RPC is polygon-rpc.com which has intermittent CORS
// and "Failed to fetch" errors from browsers. Pin to drpc.org (public, reliable)
// so wagmi quote/simulate calls don't race Magic's RPC failure.
const POLYGON_RPC = "https://polygon.drpc.org";

const config = createConfig({
  connectors: [...rainbowConnectors, magicConnector()],
  chains: [polygon],
  transports: {
    [polygon.id]: http(POLYGON_RPC),
  },
  ssr: true,
});

/**
 * Handles Magic OAuth redirect and session restore.
 *
 * Flow:
 * 1. Check for OAuth redirect params (user just came back from Google)
 * 2. If found: process via Magic SDK → get address + provider → prepare connector → wagmi connect
 * 3. If not: check for existing Magic session → same flow
 *
 * CRITICAL: All Magic SDK calls happen HERE, not in the connector.
 * The connector's isAuthorized() always returns false to prevent wagmi
 * from initializing Magic during its auto-reconnect cycle.
 */
function MagicSessionRestore() {
  const { setGoogleAddress } = useAuthStore();
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();

  // We re-run restore on mount AND on every tab-visibility change. Mobile
  // browsers (esp. iOS Safari + Chrome Mobile on low-memory devices) will
  // kill or suspend backgrounded tabs; when the user returns, wagmi's
  // in-memory connection state is gone even though Magic's session on its
  // own iframe may still be alive. This handler re-syncs the two.
  const inFlightRef = useRef(false);

  const restore = useCallback(async () => {
    // Guard: only one restore at a time, and skip if wagmi already connected.
    if (inFlightRef.current) return;
    if (isConnected) return;

    const magicConn = connectors.find((c) => c.id === "magic");
    if (!magicConn) return;

    inFlightRef.current = true;
    try {
      const refCode = new URLSearchParams(window.location.search).get("ref") || undefined;

      // Helper: after Magic auth succeeds, prepare the connector and connect via wagmi
      const connectMagicToWagmi = (address: string) => {
        const magic = getMagic();
        if (magic) {
          prepareMagicConnector(address, magic.rpcProvider);
          connect({ connector: magicConn });
        }
      };

      // 1. Handle OAuth redirect (user just came back from Google)
      const result: OAuthResult | null = await handleOAuthRedirect();
      if (result?.address) {
        setGoogleAddress(result.address);
        await fetch("/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: result.address,
            authMethod: "google",
            walletAddress: result.address,
            email: result.email,
            referredBy: refCode,
          }),
        }).catch(() => {});
        connectMagicToWagmi(result.address);

        // Restore the page the user was on when they clicked login.
        // We always send them to `/` for the OAuth round-trip (keeps
        // the whitelist to a single URI), then hop back here. Ignore
        // if they started on root anyway.
        const returnPath = consumePostLoginReturnPath();
        if (returnPath && returnPath !== "/") {
          window.history.replaceState({}, "", returnPath);
        }
        return;
      }

      // 2. No redirect — check for existing Magic session
      const existing = await checkMagicSession();
      if (existing) {
        setGoogleAddress(existing.address);
        // POST /api/user on every session restore so stale rows (created
        // before we were capturing email) backfill their email field.
        await fetch("/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: existing.address,
            authMethod: "google",
            walletAddress: existing.address,
            email: existing.email,
            referredBy: refCode,
          }),
        }).catch(() => {});
        connectMagicToWagmi(existing.address);
      }
    } catch (err) {
      console.error("Magic session restore failed:", err);
    } finally {
      inFlightRef.current = false;
    }
  }, [isConnected, connectors, connect, setGoogleAddress]);

  // Run once on mount
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    restore();
  }, [restore]);

  // Re-run on tab visibility change (mobile: back from background), window
  // focus (iOS Safari sometimes only fires focus), and pageshow with
  // persisted=true (iOS Safari back-forward cache — page is served from
  // cache without re-running useEffects, so our mount handler wouldn't fire).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        restore();
      }
    };
    const onFocus = () => {
      restore();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // persisted=true → restored from bfcache; mount effects don't re-run,
      // so we have to trigger restore manually here.
      if (e.persisted) {
        restore();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [restore]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#58a6ff",
            accentColorForeground: "white",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          <TooltipProvider>
            <I18nProvider>
              <MagicSessionRestore />
              {children}
            </I18nProvider>
          </TooltipProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
