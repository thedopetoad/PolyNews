import { NextRequest, NextResponse } from "next/server";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * POST /api/polymarket/order
 *
 * Proxies signed orders to Polymarket's CLOB API, bypassing CORS.
 * The Vercel project region is set to São Paulo (gru1) via dashboard
 * settings so all functions run from a non-geoblocked country.
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

    if (!key || !secret || !passphrase) {
      return NextResponse.json(
        { error: "Builder credentials not configured", _serverRegion: region },
        { status: 500 }
      );
    }

    const orderPayload = JSON.stringify({ order: signedOrder, orderType, ...options });

    // Build HMAC headers for builder attribution
    const signer = new BuilderSigner({ key, secret, passphrase });
    const builderHeaders = signer.createBuilderHeaderPayload("POST", "/order", orderPayload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (builderHeaders) {
      for (const [k, v] of Object.entries(builderHeaders)) {
        if (typeof v === "string") headers[k] = v;
      }
    }

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
