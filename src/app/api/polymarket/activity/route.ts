import { NextRequest, NextResponse } from "next/server";

const DATA_API = "https://data-api.polymarket.com";

/**
 * GET /api/polymarket/activity?user=<proxyAddress>
 *
 * Returns the user's trade activity from Polymarket's data API.
 * Each entry: type, side, size, usdcSize, price, title, timestamp,
 * transactionHash, etc.
 */
export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user");
  if (!user) {
    return NextResponse.json({ error: "Missing user param" }, { status: 400 });
  }

  try {
    const url = `${DATA_API}/activity?user=${user.toLowerCase()}&limit=50`;
    const res = await fetch(url, { next: { revalidate: 15 } });
    if (!res.ok) return NextResponse.json({ activity: [] });
    const activity = await res.json();
    return NextResponse.json({ activity: Array.isArray(activity) ? activity : [] });
  } catch (err) {
    console.error("Polymarket activity fetch error:", err);
    return NextResponse.json({ activity: [] });
  }
}
