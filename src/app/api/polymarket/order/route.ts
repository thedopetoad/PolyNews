import { NextRequest, NextResponse } from "next/server";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";

// Run in a non-blocked region. Polymarket geoblocks US, UK, DE, FR, IT,
// NL, BE, AU, SG + many others. Try multiple non-blocked regions.
export const preferredRegion = ["hnd1", "hkg1", "gru1", "bom1"];

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * POST /api/polymarket/order
 *
 * Proxies signed orders to Polymarket's CLOB API, bypassing CORS.
 * The CLOB only allows requests from polymarket.com — our frontend
 * at polystream.vercel.app gets blocked. So:
 *
 * 1. Client signs the order via wallet popup (EIP-712)
 * 2. Client sends the signed order HERE
 * 3. We POST it to clob.polymarket.com with builder headers
 * 4. Return the CLOB response to the client
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signedOrder, orderType = "GTC", options } = body;

    if (!signedOrder) {
      return NextResponse.json({ error: "Missing signedOrder" }, { status: 400 });
    }

    // Build builder HMAC headers — required for geoblock bypass
    const key = process.env.POLYMARKET_BUILDER_API_KEY;
    const secret = process.env.POLYMARKET_BUILDER_SECRET;
    const passphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE;

    console.log("[Order Proxy] Region:", process.env.VERCEL_REGION || "unknown");
    console.log("[Order Proxy] Builder creds present:", {
      key: !!key,
      secret: !!secret,
      passphrase: !!passphrase,
    });

    if (!key || !secret || !passphrase) {
      return NextResponse.json(
        { error: "Builder credentials not configured on server. Set POLYMARKET_BUILDER_API_KEY, POLYMARKET_BUILDER_SECRET, POLYMARKET_BUILDER_PASSPHRASE in Vercel env vars." },
        { status: 500 }
      );
    }

    const orderPayload = JSON.stringify({ order: signedOrder, orderType, ...options });

    const signer = new BuilderSigner({ key, secret, passphrase });
    const builderHeaders = signer.createBuilderHeaderPayload("POST", "/order", orderPayload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Add all builder headers (POLY_BUILDER_*)
    if (builderHeaders) {
      for (const [k, v] of Object.entries(builderHeaders)) {
        if (typeof v === "string") headers[k] = v;
      }
    }

    console.log("[Order Proxy] Sending to CLOB with headers:", Object.keys(headers));

    // Forward to CLOB
    const clobRes = await fetch(`${CLOB_HOST}/order`, {
      method: "POST",
      headers,
      body: orderPayload,
    });

    const data = await clobRes.json();
    // Pass through the region for debugging
    if (data.error) {
      data._serverRegion = process.env.VERCEL_REGION || "unknown";
    }
    return NextResponse.json(data, { status: clobRes.status });
  } catch (err) {
    console.error("Order proxy error:", err);
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
