"use client";

import { useState, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { ClobClient } from "@polymarket/clob-client";
import { Side, OrderType } from "@polymarket/clob-client";

const CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

export interface TradeResult {
  success: boolean;
  orderID?: string;
  error?: string;
  status?: string;
}

/**
 * Hook for placing real-money trades on Polymarket via the CLOB.
 * Uses wagmi's WalletClient as the ClobSigner for EIP-712 order signing.
 *
 * Flow:
 * 1. User connects wallet (wagmi)
 * 2. Build order with ClobClient's OrderBuilder
 * 3. Sign EIP-712 typed data with user's wallet
 * 4. Submit signed order to our API (adds builder attribution headers)
 * 5. Our API forwards to Polymarket CLOB
 */
export function usePolymarketTrade() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOnPolygon = chainId === POLYGON_CHAIN_ID;
  const canTrade = !!(address && walletClient && isOnPolygon);

  const placeOrder = useCallback(async (params: {
    tokenId: string;
    side: "BUY" | "SELL";
    amount: number; // USD amount for buys, shares for sells
    price?: number; // Limit price (optional for market orders)
    negRisk?: boolean;
    tickSize?: "0.1" | "0.01" | "0.001" | "0.0001";
  }): Promise<TradeResult> => {
    if (!walletClient || !address) {
      return { success: false, error: "Wallet not connected" };
    }
    if (!isOnPolygon) {
      return { success: false, error: "Switch to Polygon network" };
    }

    setPlacing(true);
    setError(null);

    try {
      // Create ClobClient with user's wallet as signer
      const client = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        walletClient, // wagmi WalletClient implements ClobSigner
      );

      // First, derive API credentials (one-time EIP-712 signature)
      let creds;
      try {
        creds = await client.createOrDeriveApiKey();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to derive API key";
        setError(msg);
        return { success: false, error: msg };
      }

      // Create authenticated client with derived creds
      const authedClient = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        walletClient,
        creds,
        undefined, // signatureType (default EOA)
        undefined, // funderAddress
        undefined, // geoBlockToken
        undefined, // useServerTime
      );

      // Place market order (FOK — fill immediately or cancel)
      const result = await authedClient.createAndPostMarketOrder(
        {
          tokenID: params.tokenId,
          amount: params.amount,
          side: params.side === "BUY" ? Side.BUY : Side.SELL,
          price: params.price,
        },
        {
          tickSize: params.tickSize || "0.01",
          negRisk: params.negRisk,
        },
        OrderType.FOK,
      );

      if (result?.success === false) {
        const msg = result.errorMsg || "Order rejected";
        setError(msg);
        return { success: false, error: msg, orderID: result.orderID };
      }

      return {
        success: true,
        orderID: result?.orderID,
        status: result?.status,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Trade failed";
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setPlacing(false);
    }
  }, [walletClient, address, isOnPolygon]);

  return {
    placeOrder,
    placing,
    error,
    canTrade,
    isOnPolygon,
    address,
  };
}
