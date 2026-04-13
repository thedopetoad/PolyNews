"use client";

import { createConnector } from "wagmi";
import { polygon } from "wagmi/chains";
import { getAddress } from "viem";
import { getMagic, checkMagicSession, logoutMagic } from "./magic";

/**
 * Custom wagmi v2 connector that wraps Magic SDK's rpcProvider.
 * After Google OAuth login, this makes the Magic wallet behave
 * identically to MetaMask in wagmi — all hooks work (useAccount,
 * useWalletClient, useWriteContract, useBalance, etc.)
 */
export function magicConnector() {
  return createConnector((config) => ({
    id: "magic",
    name: "Google",
    type: "magic",

    async connect() {
      const magic = getMagic();
      if (!magic) throw new Error("Magic not initialized");

      const info = await magic.user.getInfo();
      const address = info.publicAddress;
      if (!address) throw new Error("No Magic wallet address");

      const account = getAddress(address);
      config.emitter.emit("connect", { accounts: [account], chainId: polygon.id });

      return {
        accounts: [account],
        chainId: polygon.id,
      };
    },

    async disconnect() {
      await logoutMagic();
      config.emitter.emit("disconnect");
    },

    async getAccounts() {
      const address = await checkMagicSession();
      if (!address) return [];
      return [getAddress(address)];
    },

    async getChainId() {
      return polygon.id;
    },

    async getProvider() {
      const magic = getMagic();
      if (!magic) throw new Error("Magic not initialized");
      return magic.rpcProvider;
    },

    async isAuthorized() {
      try {
        const address = await checkMagicSession();
        return !!address;
      } catch {
        return false;
      }
    },

    async switchChain({ chainId }) {
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
