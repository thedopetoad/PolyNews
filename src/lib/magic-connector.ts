"use client";

import { createConnector } from "wagmi";
import { polygon } from "wagmi/chains";
import { getAddress } from "viem";

/**
 * Custom wagmi v2 connector for Magic SDK (Google login).
 *
 * CRITICAL DESIGN: This connector NEVER calls Magic SDK during wagmi's
 * auto-reconnect cycle (isAuthorized/getProvider/getAccounts). wagmi calls
 * these on ALL connectors at startup, and initializing Magic's iframe early
 * corrupts the OAuth state, causing Google to 503.
 *
 * Instead, we store the Magic address + provider ref AFTER a successful
 * OAuth redirect, then the connector just returns those cached values.
 * The actual Magic SDK calls happen in MagicSessionRestore (providers.tsx),
 * not inside this connector.
 */

// Cached state — set by MagicSessionRestore AFTER successful Magic auth
let _address: `0x${string}` | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _provider: any = null;
let _connected = false;

/** Called by MagicSessionRestore after OAuth redirect completes successfully */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prepareMagicConnector(address: string, provider: any) {
  _address = getAddress(address);
  _provider = provider;
}

/** Called on logout to clear cached state */
export function clearMagicConnector() {
  _address = null;
  _provider = null;
  _connected = false;
}

export function magicConnector() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createConnector<any>((config) => ({
    id: "magic",
    name: "Google",
    type: "magic",

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async connect(_params?: any): Promise<any> {
      // By the time connect() is called, MagicSessionRestore has already
      // called prepareMagicConnector() with the address and provider.
      if (!_address) throw new Error("Magic not prepared — call prepareMagicConnector first");

      _connected = true;
      config.emitter.emit("connect", { accounts: [_address], chainId: polygon.id });
      return { accounts: [_address], chainId: polygon.id };
    },

    async disconnect() {
      _connected = false;
      clearMagicConnector();

      // Lazy-import logoutMagic to avoid initializing Magic SDK at module load
      const { logoutMagic } = await import("./magic");
      await logoutMagic();

      config.emitter.emit("disconnect");
    },

    async getAccounts() {
      // SAFE: returns cached address, never calls Magic SDK
      if (!_address) return [];
      return [_address] as readonly `0x${string}`[];
    },

    async getChainId() {
      return polygon.id;
    },

    async getProvider() {
      // SAFE: returns cached provider, never calls Magic SDK
      // During reconnect, _provider is null so wagmi skips this connector
      return _provider;
    },

    // CRITICAL: Always return false. We never want wagmi to auto-reconnect
    // this connector. MagicSessionRestore handles session restore manually
    // AFTER the OAuth redirect is safely processed.
    async isAuthorized() {
      return false;
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
