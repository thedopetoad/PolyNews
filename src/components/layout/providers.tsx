"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkMagicSession, handleOAuthRedirect, getMagic, type OAuthResult } from "@/lib/magic";
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
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (isConnected || attempted) return;

    const magicConn = connectors.find((c) => c.id === "magic");
    if (!magicConn) return;

    setAttempted(true);

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
    handleOAuthRedirect().then(async (result: OAuthResult | null) => {
      if (result?.address) {
        setGoogleAddress(result.address);
        // Create/update user in DB
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
        return;
      }

      // 2. No redirect — check for existing Magic session
      const existing = await checkMagicSession();
      if (existing) {
        setGoogleAddress(existing.address);
        // POST /api/user on every session restore so stale rows (created
        // before we were capturing email) can backfill their email field.
        // Without this, those users stay at risk of duplicate-on-relogin if
        // Magic ever returns a different address for the same Google user.
        // Server-side this is idempotent: returns existing row + updates
        // email only if currently null.
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
    }).catch((err) => {
      console.error("Magic session restore failed:", err);
    });
  }, [isConnected, connectors, connect, attempted]); // eslint-disable-line react-hooks/exhaustive-deps

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
