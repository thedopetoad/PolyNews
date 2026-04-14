"use client";

import { useCallback } from "react";
import { useAccount, useConnect } from "wagmi";
import { useAuthStore } from "@/stores/use-auth-store";
import { getMagic } from "@/lib/magic";
import { prepareMagicConnector } from "@/lib/magic-connector";

/**
 * Ensures wagmi has an active EVM connection before a signing call.
 *
 * Why: our Magic connector's `isAuthorized()` returns `false` so wagmi never
 * auto-reconnects. MagicSessionRestore normally does this on mount, but the
 * connection can drop (new tab, long-idle tab, or after connecting Phantom's
 * Solana side in the deposit flow). If we try to sign while disconnected,
 * wagmi throws "Connector not connected".
 *
 * This hook exposes an async `ensureConnected()` that transactions can `await`
 * before sending. If wagmi is already connected it's a no-op; otherwise it
 * tries to re-bind the Magic connector using the persisted googleAddress.
 */
export function useEnsureWagmi() {
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const googleAddress = useAuthStore((s) => s.googleAddress);

  return useCallback(async () => {
    if (isConnected) return;

    if (!googleAddress) {
      throw new Error("Wallet not connected. Please log in.");
    }

    // Google user — re-prepare the Magic connector and re-attach it to wagmi
    const magicConn = connectors.find((c) => c.id === "magic");
    if (!magicConn) throw new Error("Magic connector not available");

    const magic = getMagic();
    if (!magic) throw new Error("Magic SDK not initialized");

    // Verify Magic still has a valid session server-side
    const loggedIn = await magic.user.isLoggedIn();
    if (!loggedIn) {
      throw new Error("Google session expired — please log in again");
    }

    prepareMagicConnector(googleAddress, magic.rpcProvider);
    await connectAsync({ connector: magicConn });
  }, [isConnected, googleAddress, connectors, connectAsync]);
}
