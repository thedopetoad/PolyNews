/**
 * POST /api/polymarket/builder-headers
 *
 * Remote builder signer for the @polymarket/clob-client. The ClobClient is
 * constructed on the frontend with a `RemoteBuilderConfig` that points at this
 * route — whenever it's about to POST an order (or another builder-gated call)
 * to Polymarket's CLOB, it calls us first to get the `POLY_BUILDER_*` headers.
 *
 * Why remote-signed, not local: the HMAC secret (POLYMARKET_BUILDER_SECRET)
 * can NEVER live in the frontend bundle — anyone with it can place trades
 * attributed to polystream's builder account (stealing rewards would require
 * also stealing user signatures, but the key+secret alone can be misused for
 * non-trade builder-gated endpoints). Keeping it server-side is the standard
 * pattern; Polymarket's SDK has first-class support via RemoteBuilderConfig.
 *
 * Request body (matches `RemoteSignerPayload` from @polymarket/builder-signing-sdk):
 *   { method: "POST", path: "/order", body: "<serialized json>", timestamp?: number }
 *
 * Response: `BuilderHeaderPayload` — the four headers to attach to the CLOB
 * request. Returned as-is; the SDK's BuilderConfig knows how to consume them.
 *
 * Auth: none in MVP. Misuse surface is "someone else gets polystream attributed
 * to their order" which is a net benefit for us. Add session auth + rate limit
 * if abuse becomes a problem.
 */
import { NextRequest, NextResponse } from "next/server";
import { BuilderSigner } from "@polymarket/builder-signing-sdk";

interface Body {
  method?: string;
  path?: string;
  body?: string;
  timestamp?: number;
}

export async function POST(req: NextRequest) {
  const key = process.env.POLYMARKET_BUILDER_API_KEY;
  const secret = process.env.POLYMARKET_BUILDER_SECRET;
  const passphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE;

  if (!key || !secret || !passphrase) {
    // Surface a clear error in the Network tab so frontend can fall back to
    // non-builder trades rather than blocking the UX entirely.
    return NextResponse.json(
      { error: "Builder credentials not configured — orders will place without builder attribution." },
      { status: 503 },
    );
  }

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { method, path, body, timestamp } = payload;
  if (!method || !path) {
    return NextResponse.json({ error: "Missing method or path" }, { status: 400 });
  }

  try {
    const signer = new BuilderSigner({ key, secret, passphrase });
    const headers = signer.createBuilderHeaderPayload(method, path, body, timestamp);
    return NextResponse.json(headers);
  } catch (err) {
    return NextResponse.json(
      { error: `Signer error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
