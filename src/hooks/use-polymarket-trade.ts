"use client";

import { useState, useCallback, useRef } from "react";
import { useAccount, useWalletClient, useConfig } from "wagmi";
import { getWalletClient as getWalletClientAction } from "wagmi/actions";
import { ClobClient } from "@polymarket/clob-client";
import { Side, OrderType } from "@polymarket/clob-client";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { deriveProxyAddress } from "@/lib/relay";

const CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
// v3: creds derived with proxy as funderAddress (v2 used EOA which was wrong).
const CREDS_STORAGE_KEY = "polystream-clob-creds-v3";

/**
 * Remote BuilderConfig — points at our server-side signer so polystream's
 * builder rewards are attributed to every trade without leaking the HMAC
 * secret to the browser. The ClobClient's builders flow auto-calls this URL
 * before mutating requests. If the endpoint returns 503 (builder creds not
 * set), ClobClient falls back to placing orders without builder headers —
 * trades still work, just no reward attribution.
 *
 * Lazy-instantiated because BuilderConfig validates that the URL is absolute
 * (`http(s)://...`) and relative paths blow up during SSR prerender where
 * `window` isn't defined. We only need this object at trade time in the
 * browser, so building it on demand is fine.
 */
function getBuilderConfig(): BuilderConfig | undefined {
  if (typeof window === "undefined") return undefined;
  return new BuilderConfig({
    remoteBuilderConfig: {
      url: `${window.location.origin}/api/polymarket/builder-headers`,
    },
  });
}

export interface TradeResult {
  success: boolean;
  orderID?: string;
  error?: string;
  status?: string;
}

/**
 * Load cached CLOB API credentials from localStorage.
 * Keyed by wallet address so switching wallets gets fresh creds.
 */
function loadCachedCreds(address: string): ApiKeyCreds | null {
  try {
    const raw = localStorage.getItem(CREDS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.address?.toLowerCase() === address.toLowerCase() && data.creds) {
      return data.creds as ApiKeyCreds;
    }
  } catch {}
  return null;
}

function saveCreds(address: string, creds: ApiKeyCreds) {
  try {
    localStorage.setItem(CREDS_STORAGE_KEY, JSON.stringify({ address: address.toLowerCase(), creds }));
  } catch {}
}

/**
 * Hook for placing real-money trades on Polymarket via the CLOB.
 *
 * Optimized flow (only 1 wallet signature per trade):
 * 1. API credentials are derived ONCE and cached in localStorage
 * 2. Each trade only requires the order EIP-712 signature
 */
export function usePolymarketTrade() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const wagmiConfig = useConfig();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cachedCredsRef = useRef<ApiKeyCreds | null>(null);

  const isOnPolygon = chainId === POLYGON_CHAIN_ID;
  const canTrade = !!(address && walletClient && isOnPolygon);

  const getOrDeriveCreds = useCallback(async (client: ClobClient, addr: string): Promise<ApiKeyCreds> => {
    // Check ref cache first (in-memory)
    if (cachedCredsRef.current) return cachedCredsRef.current;

    // Check localStorage cache
    const stored = loadCachedCreds(addr);
    if (stored) {
      cachedCredsRef.current = stored;
      return stored;
    }

    // Derive new creds (requires one wallet signature)
    const creds = await client.createOrDeriveApiKey();
    cachedCredsRef.current = creds;
    saveCreds(addr, creds);
    return creds;
  }, []);

  const placeOrder = useCallback(async (params: {
    tokenId: string;
    side: "BUY" | "SELL";
    amount: number;
    price?: number;
    negRisk?: boolean;
    tickSize?: "0.1" | "0.01" | "0.001" | "0.0001";
  }): Promise<TradeResult> => {
    if (!address) {
      return { success: false, error: "Wallet not connected" };
    }

    // The reactive walletClient from useWalletClient() can be stale after a
    // chain switch or on initial load. Actively fetch a fresh one so the user
    // doesn't see "Wallet not connected" when they clearly ARE connected.
    let signer = walletClient;
    if (!signer) {
      try {
        signer = await getWalletClientAction(wagmiConfig, { chainId: POLYGON_CHAIN_ID });
      } catch {
        return { success: false, error: "Could not reach your wallet. Make sure it's unlocked and on Polygon." };
      }
    }
    if (!signer) {
      return { success: false, error: "Wallet signer unavailable. Try switching to Polygon in your wallet." };
    }

    setPlacing(true);
    setError(null);

    try {
      // ── Signature type ──
      // POLY_PROXY (1) = the EOA signs on behalf of its Polymarket proxy
      // wallet. This enables relayer gas coverage (gas-free for the user),
      // trades execute from the proxy (where deposited USDC.e lives), and
      // positions show up correctly on polymarket.com.
      //
      // EOA (0) was wrong — it made the user pay gas themselves and
      // traded from the EOA address (which has no funds).
      const POLY_PROXY = 1;

      // Derive proxy wallet address from EOA. This is where USDC.e lives
      // and where Polymarket executes trades from.
      const proxyAddr = deriveProxyAddress(address);

      // Create base client for cred derivation. Builder config intentionally
      // OMITTED here — cred derivation endpoints don't accept builder headers
      // and would 400 if we sent them.
      // funderAddress = proxy wallet (the maker), signer = EOA.
      const baseClient = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        signer,
        undefined,
        POLY_PROXY,
        proxyAddr,
      );

      // Get cached or derive API credentials (only signs if first time)
      let creds: ApiKeyCreds;
      try {
        creds = await getOrDeriveCreds(baseClient, address);
      } catch (e: unknown) {
        // If creds derivation fails, clear cache and try once more
        cachedCredsRef.current = null;
        localStorage.removeItem(CREDS_STORAGE_KEY);
        const msg = e instanceof Error ? e.message : "Failed to authenticate with Polymarket";
        setError(msg);
        return { success: false, error: msg };
      }

      // Create authenticated client with builder attribution.
      // signatureType = POLY_PROXY, funderAddress = proxy wallet.
      // Builder config at position 9 hits our remote signer for
      // POLY_BUILDER_* headers so volume credits our builder account.
      const authedClient = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        signer,
        creds,
        POLY_PROXY,
        proxyAddr,
        undefined,
        undefined,
        getBuilderConfig(),
      );

      // Place market order — this is the ONLY signature the user sees
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
        const msg = result.errorMsg || "Order rejected by Polymarket";
        // If auth error, clear cached creds so next attempt re-derives
        if (msg.includes("auth") || msg.includes("key") || msg.includes("401")) {
          cachedCredsRef.current = null;
          localStorage.removeItem(CREDS_STORAGE_KEY);
        }
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
  }, [walletClient, wagmiConfig, address, isOnPolygon, getOrDeriveCreds]);

  return {
    placeOrder,
    placing,
    error,
    canTrade,
    isOnPolygon,
    address,
  };
}
