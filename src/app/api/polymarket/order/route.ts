import { NextRequest, NextResponse } from "next/server";

// Edge runtime runs in the specified region on ALL Vercel plans.
// Polymarket geoblocks US, UK, DE, FR, IT, NL, BE, AU, etc.
// These regions are NOT blocked.
export const runtime = "edge";
export const preferredRegion = ["hnd1", "hkg1", "gru1", "bom1"];

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * HMAC-SHA256 signing for Polymarket builder headers.
 * Reimplemented with Web Crypto API (Edge-compatible) instead of
 * Node.js crypto from @polymarket/builder-signing-sdk.
 */
async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function buildBuilderHeaders(
  apiKey: string,
  secret: string,
  passphrase: string,
  method: string,
  path: string,
  body: string
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method + path + body;
  const signature = await hmacSign(secret, message);

  return {
    "POLY_BUILDER_API_KEY": apiKey,
    "POLY_BUILDER_SIGNATURE": signature,
    "POLY_BUILDER_TIMESTAMP": timestamp,
    "POLY_BUILDER_PASSPHRASE": passphrase,
  };
}

/**
 * POST /api/polymarket/order
 *
 * Proxies signed orders to Polymarket's CLOB API.
 * Runs on Edge in a non-US region to bypass geoblock.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signedOrder, orderType = "GTC", options } = body;

    if (!signedOrder) {
      return NextResponse.json({ error: "Missing signedOrder" }, { status: 400 });
    }

    const key = process.env.POLYMARKET_BUILDER_API_KEY;
    const secret = process.env.POLYMARKET_BUILDER_SECRET;
    const passphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE;

    const region = process.env.VERCEL_REGION || "unknown";
    console.log("[Order Proxy] Region:", region, "| Builder creds:", !!key && !!secret && !!passphrase);

    if (!key || !secret || !passphrase) {
      return NextResponse.json(
        { error: "Builder credentials not configured", _serverRegion: region },
        { status: 500 }
      );
    }

    const orderPayload = JSON.stringify({ order: signedOrder, orderType, ...options });

    // Build HMAC headers using Web Crypto (Edge-compatible)
    const builderHeaders = await buildBuilderHeaders(key, secret, passphrase, "POST", "/order", orderPayload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...builderHeaders,
    };

    // Forward to CLOB
    const clobRes = await fetch(`${CLOB_HOST}/order`, {
      method: "POST",
      headers,
      body: orderPayload,
    });

    const data = await clobRes.json();
    data._serverRegion = region;
    return NextResponse.json(data, { status: clobRes.status });
  } catch (err) {
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}`, _serverRegion: process.env.VERCEL_REGION || "unknown" },
      { status: 500 }
    );
  }
}
