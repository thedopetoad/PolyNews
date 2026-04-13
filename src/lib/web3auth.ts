"use client";

import { Web3Auth } from "@web3auth/modal";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from "@web3auth/base";

const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || "";

let web3authInstance: Web3Auth | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

export function getWeb3AuthInstance(): Web3Auth | null {
  if (!clientId) return null;
  if (typeof window === "undefined") return null;

  if (!web3authInstance) {
    web3authInstance = new Web3Auth({
      clientId,
      web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
      chainConfig: {
        chainNamespace: CHAIN_NAMESPACES.EIP155,
        chainId: "0x89",
        rpcTarget: "https://polygon-rpc.com",
        displayName: "Polygon Mainnet",
        blockExplorerUrl: "https://polygonscan.com",
        ticker: "MATIC",
        tickerName: "Polygon",
      },
    } as ConstructorParameters<typeof Web3Auth>[0]);
  }

  return web3authInstance;
}

/**
 * Initialize Web3Auth and restore any existing session.
 * Returns the connected address if a session exists, null otherwise.
 * Safe to call multiple times — deduplicates via shared promise.
 */
export async function initAndRestoreWeb3Auth(): Promise<string | null> {
  const w3a = getWeb3AuthInstance();
  if (!w3a) return null;

  try {
    if (w3a.status === "not_ready") {
      if (!initPromise || initFailed) {
        initFailed = false;
        initPromise = w3a.init().catch((err) => { initFailed = true; throw err; });
      }
      await initPromise;
    }

    // Check if user has an existing session
    if (w3a.connected && w3a.provider) {
      const accounts = (await w3a.provider.request({ method: "eth_accounts" })) as string[] | undefined;
      if (accounts && accounts.length > 0) {
        return accounts[0].toLowerCase();
      }
    }
  } catch (err) {
    console.error("Web3Auth init/restore failed:", err);
  }

  return null;
}
