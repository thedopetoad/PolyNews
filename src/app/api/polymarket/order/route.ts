import { NextRequest, NextResponse } from "next/server";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";
import { createHmac } from "crypto";

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * Generate L2 authentication headers matching the exact format of
 * @polymarket/clob-client's createL2Headers() + buildPolyHmacSignature().
 *
 * CRITICAL: The signature must be URL-SAFE base64 (+ → -, / → _)
 * while the secret is URL-safe base64 that must be converted to
 * standard base64 before HMAC key import.
 */
function createL2Headers(
  creds: { key: string; secret: string; passphrase: string },
  method: string,
  requestPath: string,
  body: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method + requestPath + body;

  // Convert URL-safe base64 secret to standard, then decode
  const standardB64 = creds.secret.replace(/-/g, "+").replace(/_/g, "/");
  const secretBuf = Buffer.from(standardB64, "base64");

  // HMAC-SHA256 → base64 → convert to URL-safe base64
  const sigStandard = createHmac("sha256", secretBuf)
    .update(message)
    .digest("base64");
  const sigUrlSafe = sigStandard.replace(/\+/g, "-").replace(/\//g, "_");

  return {
    POLY_ADDRESS: "", // Set by caller
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
    POLY_SIGNATURE: sigUrlSafe,
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
    const { orderPayload, userCreds, userAddress } = body;

    if (!orderPayload?.order) {
      return NextResponse.json({ error: "Missing order payload" }, { status: 400 });
    }

    if (!userCreds?.key || !userCreds?.secret || !userCreds?.passphrase) {
      return NextResponse.json({ error: "Missing user CLOB API credentials" }, { status: 400 });
    }

    const builderKey = process.env.POLYMARKET_BUILDER_API_KEY;
    const builderSecret = process.env.POLYMARKET_BUILDER_SECRET;
    const builderPassphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE;

    const region = process.env.VERCEL_REGION || "unknown";

    // Serialize the pre-formatted order payload
    const orderPayloadStr = JSON.stringify(orderPayload);

    // ── L2 User Auth Headers ──
    const l2Headers = createL2Headers(userCreds, "POST", "/order", orderPayloadStr);
    l2Headers.POLY_ADDRESS = userAddress || "";

    // ── Builder Attribution Headers ──
    let builderHeaders: Record<string, string> = {};
    if (builderKey && builderSecret && builderPassphrase) {
      const signer = new BuilderSigner({
        key: builderKey,
        secret: builderSecret,
        passphrase: builderPassphrase,
      });
      const bh = signer.createBuilderHeaderPayload("POST", "/order", orderPayloadStr);
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
      body: orderPayloadStr,
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
