"use client";

import { Web3Auth } from "@web3auth/modal";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from "@web3auth/base";

const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || "";

let web3authInstance: Web3Auth | null = null;

export function getWeb3AuthInstance(): Web3Auth | null {
  if (!clientId) return null;
  if (typeof window === "undefined") return null;

  if (!web3authInstance) {
    web3authInstance = new Web3Auth({
      clientId,
      web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_MAINNET,
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
