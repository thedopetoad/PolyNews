import { NextRequest, NextResponse } from "next/server";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";
import { createHmac } from "crypto";

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * Generate L2 authentication headers for the user's CLOB API credentials.
 * These prove to the CLOB that the user authorized this request.
 *
 * Format matches @polymarket/clob-client's createL2Headers():
 *   message = timestamp + method + requestPath + body
 *   signature = base64(HMAC-SHA256(base64decode(secret), message))
 */
function createL2Headers(
  creds: { key: string; secret: string; passphrase: string },
  method: string,
  requestPath: string,
  body: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method + requestPath + body;

  // Decode URL-safe base64 secret
  const secretBuf = Buffer.from(creds.secret, "base64");
  const signature = createHmac("sha256", secretBuf)
    .update(message)
    .digest("base64");

  return {
    POLY_ADDRESS: "", // Set by caller
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
  };
}

/**
 * POST /api/polymarket/order
 *
 * Proxies signed orders to Polymarket's CLOB API with BOTH:
 * - L2 user auth headers (POLY_ADDRESS, POLY_API_KEY, etc.)
 * - Builder attribution headers (POLY_BUILDER_*)
 *
 * The Vercel project runs in São Paulo (non-geoblocked region).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signedOrder, orderType = "GTC", options, userCreds, userAddress } = body;

    if (!signedOrder) {
      return NextResponse.json({ error: "Missing signedOrder" }, { status: 400 });
    }

    // ApiKeyCreds uses { key, secret, passphrase } (not apiKey)
    if (!userCreds?.key || !userCreds?.secret || !userCreds?.passphrase) {
      return NextResponse.json({ error: "Missing user CLOB API credentials" }, { status: 400 });
    }

    const builderKey = process.env.POLYMARKET_BUILDER_API_KEY;
    const builderSecret = process.env.POLYMARKET_BUILDER_SECRET;
    const builderPassphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE;

    const region = process.env.VERCEL_REGION || "unknown";

    // Build the order payload
    const orderPayload = JSON.stringify({ order: signedOrder, orderType, ...options });

    // ── L2 User Auth Headers ──
    const l2Headers = createL2Headers(userCreds, "POST", "/order", orderPayload);
    l2Headers.POLY_ADDRESS = userAddress || "";

    // ── Builder Attribution Headers ──
    let builderHeaders: Record<string, string> = {};
    if (builderKey && builderSecret && builderPassphrase) {
      const signer = new BuilderSigner({
        key: builderKey,
        secret: builderSecret,
        passphrase: builderPassphrase,
      });
      const bh = signer.createBuilderHeaderPayload("POST", "/order", orderPayload);
      if (bh) {
        for (const [k, v] of Object.entries(bh)) {
          if (typeof v === "string") builderHeaders[k] = v;
        }
      }
    }

    // Merge all headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...l2Headers,
      ...builderHeaders,
    };

    console.log("[Order Proxy] Region:", region, "| Headers:", Object.keys(headers).join(", "));

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
