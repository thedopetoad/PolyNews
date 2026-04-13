"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkMagicSession, handleOAuthRedirect, type OAuthResult } from "@/lib/magic";
import { useAuthStore } from "@/stores/use-auth-store";
import { I18nProvider } from "@/lib/i18n";
import { WagmiProvider, createConfig, http } from "wagmi";
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

const connectors = connectorsForWallets(
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

const config = createConfig({
  connectors,
  chains: [polygon],
  transports: {
    [polygon.id]: http(),
  },
  ssr: true,
});

function MagicSessionRestore() {
  const { setGoogleAddress } = useAuthStore();

  useEffect(() => {
    // Read referral code from URL if present (e.g., ?ref=PS-ABC12345)
    const refCode = new URLSearchParams(window.location.search).get("ref") || undefined;

    // 1. Handle OAuth redirect (user just came back from Google)
    handleOAuthRedirect().then(async (result: OAuthResult | null) => {
      if (result?.address) {
        setGoogleAddress(result.address);
        // Create/update user in DB — pass email + referral code for migration + rewards
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
        return;
      }

      // 2. No redirect — check for existing Magic session
      const existing = await checkMagicSession();
      if (existing) {
        setGoogleAddress(existing);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
