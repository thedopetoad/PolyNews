import { NextRequest, NextResponse } from "next/server";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";

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

    // Build builder HMAC headers for attribution
    const key = process.env.POLYMARKET_BUILDER_API_KEY;
    const secret = process.env.POLYMARKET_BUILDER_SECRET;
    const passphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (key && secret && passphrase) {
      const signer = new BuilderSigner({ key, secret, passphrase });
      const orderBody = JSON.stringify({ order: signedOrder, orderType, ...options });
      const builderHeaders = signer.createBuilderHeaderPayload("POST", "/order", orderBody);
      // Spread builder headers
      if (builderHeaders) {
        for (const [k, v] of Object.entries(builderHeaders)) {
          if (typeof v === "string") headers[k] = v;
        }
      }
    }

    // Forward to CLOB
    const clobRes = await fetch(`${CLOB_HOST}/order`, {
      method: "POST",
      headers,
      body: JSON.stringify({ order: signedOrder, orderType, ...options }),
    });

    const data = await clobRes.json();
    return NextResponse.json(data, { status: clobRes.status });
  } catch (err) {
    console.error("Order proxy error:", err);
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
