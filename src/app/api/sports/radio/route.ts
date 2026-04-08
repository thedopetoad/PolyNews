import { NextRequest, NextResponse } from "next/server";
import { getStationForTeam } from "@/lib/sports-radio";

const RADIO_BROWSER_API = "https://de1.api.radio-browser.info/json/stations/search";

interface RadioStation {
  name: string;
  url_resolved: string;
  codec: string;
  bitrate: number;
  homepage: string;
  favicon: string;
  lastcheckok: number;
}

export async function GET(req: NextRequest) {
  const team = req.nextUrl.searchParams.get("team");
  if (!team) {
    return NextResponse.json({ error: "team required" }, { status: 400 });
  }

  // Look up station name from our mapping
  const stationName = getStationForTeam(team);
  if (!stationName) {
    return NextResponse.json({ station: null });
  }

  try {
    // Search radio-browser.info for the station
    const params = new URLSearchParams({
      name: stationName,
      limit: "5",
      order: "clickcount",
      reverse: "true",
    });

    const res = await fetch(`${RADIO_BROWSER_API}?${params}`, {
      next: { revalidate: 3600 }, // Cache 1 hour
      headers: { "User-Agent": "PolyNews/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json({ station: null });
    }

    const stations: RadioStation[] = await res.json();

    // Find the first working station
    const working = stations.find((s) => s.lastcheckok === 1 && s.url_resolved);
    if (!working) {
      return NextResponse.json({ station: null });
    }

    return NextResponse.json({
      station: {
        name: working.name,
        streamUrl: working.url_resolved,
        codec: working.codec,
        bitrate: working.bitrate,
        homepage: working.homepage,
        favicon: working.favicon,
      },
    });
  } catch {
    return NextResponse.json({ station: null });
  }
}
