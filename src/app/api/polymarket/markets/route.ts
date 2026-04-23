import { NextRequest, NextResponse } from "next/server";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";

// Migrated from /markets → /markets/keyset on 2026-04-23 (legacy
// endpoint deprecated 2026-05-01). Preserves the legacy array-shaped
// response body so existing hooks (useMarkets) keep working unchanged.
// `offset` is accepted by the route for backward compat but stripped
// before the upstream call — keyset is cursor-based.

const ALLOWED_PARAMS = ["active", "closed", "limit", "offset", "slug", "id"];
const MAX_LIMIT = 100;
const STRIP_UPSTREAM = new Set(["offset"]);

interface KeysetMarketsResponse {
  markets?: unknown[];
  next_cursor?: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();

  for (const key of ALLOWED_PARAMS) {
    const val = searchParams.get(key);
    if (val !== null && !STRIP_UPSTREAM.has(key)) params.set(key, val);
  }

  if (!params.has("active")) params.set("active", "true");
  if (!params.has("closed")) params.set("closed", "false");
  const limit = Math.min(parseInt(params.get("limit") || "50"), MAX_LIMIT);
  params.set("limit", String(limit));

  try {
    const response = await fetch(
      `${POLYMARKET_GAMMA_API}/markets/keyset?${params.toString()}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch markets" },
        { status: response.status },
      );
    }

    const body = (await response.json()) as KeysetMarketsResponse | unknown[];
    // Return just the array — legacy callers expect that shape. If
    // Gamma's keyset rollback ever serves the legacy array directly,
    // handle that too.
    const markets = Array.isArray(body) ? body : body.markets ?? [];
    return NextResponse.json(markets);
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to Polymarket API" },
      { status: 502 },
    );
  }
}
