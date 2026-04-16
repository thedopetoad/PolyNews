import { NextRequest, NextResponse } from "next/server";

const DATA_API = "https://data-api.polymarket.com";

/**
 * GET /api/polymarket/positions?user=<proxyAddress>
 *
 * Proxies the Polymarket data API to fetch real on-chain positions for
 * a user's proxy wallet. This is the same data source polymarket.com
 * uses — always accurate, no local DB needed.
 *
 * Returns: array of positions with size, avgPrice, curPrice, cashPnl,
 * percentPnl, market title/slug, conditionId, etc.
 */
export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user");
  if (!user) {
    return NextResponse.json({ error: "Missing user param" }, { status: 400 });
  }

  try {
    const url = `${DATA_API}/positions?user=${user.toLowerCase()}&sizeThreshold=0.01&sortBy=CURRENT&sortDirection=DESC`;
    const res = await fetch(url, { next: { revalidate: 15 } });

    if (!res.ok) {
      return NextResponse.json({ positions: [] });
    }

    const positions = await res.json();
    return NextResponse.json({ positions: Array.isArray(positions) ? positions : [] });
  } catch (err) {
    console.error("Polymarket positions fetch error:", err);
    return NextResponse.json({ positions: [] });
  }
}
