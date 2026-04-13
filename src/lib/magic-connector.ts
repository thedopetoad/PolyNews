"use client";

import { createConnector } from "wagmi";
import { polygon } from "wagmi/chains";
import { getAddress } from "viem";
import { getMagic, checkMagicSession, logoutMagic } from "./magic";

const MAGIC_SESSION_KEY = "polystream-magic-session";

/** Mark that a Magic session was established (called after successful connect) */
function markMagicSession() {
  try { localStorage.setItem(MAGIC_SESSION_KEY, "1"); } catch {}
}

/** Clear the Magic session marker */
function clearMagicSession() {
  try { localStorage.removeItem(MAGIC_SESSION_KEY); } catch {}
}

/** Check if we've ever had a Magic session (without calling Magic SDK) */
function hasMagicSessionMarker(): boolean {
  try { return localStorage.getItem(MAGIC_SESSION_KEY) === "1"; } catch { return false; }
}

/**
 * Custom wagmi v2 connector that wraps Magic SDK's rpcProvider.
 * Only initializes Magic SDK when there's evidence of a prior session,
 * to avoid interfering with OAuth state on fresh page loads.
 */
export function magicConnector() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createConnector<any>((config) => ({
    id: "magic",
    name: "Google",
    type: "magic",

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async connect(_params?: any): Promise<any> {
      const magic = getMagic();
      if (!magic) throw new Error("Magic not initialized");

      const info = await magic.user.getInfo();
      const address = info.publicAddress;
      if (!address) throw new Error("No Magic wallet address");

      const account = getAddress(address);
      markMagicSession();
      config.emitter.emit("connect", { accounts: [account], chainId: polygon.id });

      return { accounts: [account], chainId: polygon.id };
    },

    async disconnect() {
      clearMagicSession();
      await logoutMagic();
      config.emitter.emit("disconnect");
    },

    async getAccounts() {
      if (!hasMagicSessionMarker()) return [];
      const address = await checkMagicSession();
      if (!address) { clearMagicSession(); return []; }
      return [getAddress(address)] as readonly `0x${string}`[];
    },

    async getChainId() {
      return polygon.id;
    },

    async getProvider() {
      const magic = getMagic();
      if (!magic) throw new Error("Magic not initialized");
      return magic.rpcProvider;
    },

    // Only call Magic SDK if we have a prior session marker.
    // This prevents Magic iframe from initializing on every page load
    // for users who never used Google login, which can interfere with OAuth.
    async isAuthorized() {
      if (!hasMagicSessionMarker()) return false;
      try {
        const address = await checkMagicSession();
        if (!address) { clearMagicSession(); return false; }
        return true;
      } catch {
        return false;
      }
    },

    async switchChain({ chainId }: { chainId: number }) {
      if (chainId !== polygon.id) {
        throw new Error("Magic wallet only supports Polygon");
      }
      return polygon;
    },

    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}
