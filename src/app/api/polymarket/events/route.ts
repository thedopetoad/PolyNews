import { NextRequest, NextResponse } from "next/server";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";

const ALLOWED_PARAMS = ["active", "closed", "limit", "offset", "slug", "id", "tag"];
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();

  // Only forward whitelisted params
  for (const key of ALLOWED_PARAMS) {
    const val = searchParams.get(key);
    if (val !== null) params.set(key, val);
  }

  // Enforce defaults and caps
  if (!params.has("active")) params.set("active", "true");
  const limit = Math.min(parseInt(params.get("limit") || "20"), MAX_LIMIT);
  params.set("limit", String(limit));

  try {
    const response = await fetch(
      `${POLYMARKET_GAMMA_API}/events?${params.toString()}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch events" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to Polymarket API" },
      { status: 502 }
    );
  }
}
