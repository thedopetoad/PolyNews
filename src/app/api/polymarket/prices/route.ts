import { NextRequest, NextResponse } from "next/server";

/**
 * Fetch real-time prices from Polymarket's CLOB API.
 * The Gamma API returns stale outcomePrices from the AMM.
 * The CLOB API returns the actual live order book midpoint prices.
 *
 * GET /api/polymarket/prices?token_id=TOKEN_ID
 */
export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("token_id");
  if (!tokenId) {
    return NextResponse.json({ error: "Missing token_id" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://clob.polymarket.com/midpoint?token_id=${tokenId}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 5 }, // Cache for 5 seconds
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "CLOB API error" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to fetch price" }, { status: 502 });
  }
}
