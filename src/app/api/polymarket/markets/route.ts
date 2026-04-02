import { NextRequest, NextResponse } from "next/server";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams(searchParams);

  if (!params.has("active")) params.set("active", "true");
  if (!params.has("limit")) params.set("limit", "50");

  try {
    const response = await fetch(
      `${POLYMARKET_GAMMA_API}/markets?${params.toString()}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch markets" },
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
