import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const tokenId = req.nextUrl.searchParams.get("token_id");
  if (!tokenId) {
    return NextResponse.json({ error: "token_id required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=all&fidelity=60`,
      { next: { revalidate: 300 } } // Cache 5 min
    );

    if (!res.ok) {
      return NextResponse.json({ history: [] });
    }

    const data = await res.json();

    // API returns { history: [{t: timestamp, p: price}, ...] }
    const history = (data.history || []).map((point: { t: number; p: number }) => ({
      t: point.t,
      p: point.p,
    }));

    return NextResponse.json({ history });
  } catch {
    return NextResponse.json({ history: [] });
  }
}
