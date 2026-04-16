import { NextRequest, NextResponse } from "next/server";

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * GET /api/polymarket/book?token_id=<id>
 *
 * Proxy to the CLOB orderbook. Returns { bids, asks } — each an
 * array of { price, size } (prices in dollars, size in shares).
 * Bids descending (best first), asks ascending (best first).
 */
export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("token_id");
  if (!tokenId) {
    return NextResponse.json({ error: "Missing token_id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${CLOB_HOST}/book?token_id=${tokenId}`, {
      next: { revalidate: 3 },
    });
    if (!res.ok) return NextResponse.json({ bids: [], asks: [] });
    const data = await res.json();
    return NextResponse.json({ bids: data.bids || [], asks: data.asks || [] });
  } catch {
    return NextResponse.json({ bids: [], asks: [] });
  }
}
