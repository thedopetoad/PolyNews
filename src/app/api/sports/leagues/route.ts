import { NextResponse } from "next/server";

const POPULAR_LEAGUES = [
  { code: "mlb", name: "MLB", emoji: "⚾", seriesId: "3" },
  { code: "nba", name: "NBA", emoji: "🏀", seriesId: "10345" },
  { code: "nfl", name: "NFL", emoji: "🏈", seriesId: "10187" },
  { code: "nhl", name: "NHL", emoji: "🏒", seriesId: "10346" },
  { code: "epl", name: "Premier League", emoji: "⚽", seriesId: "10188" },
  { code: "lal", name: "La Liga", emoji: "⚽", seriesId: "10193" },
  { code: "bun", name: "Bundesliga", emoji: "⚽", seriesId: "10194" },
  { code: "ucl", name: "Champions League", emoji: "🏆", seriesId: "10204" },
  { code: "ufc", name: "UFC", emoji: "🥊", seriesId: "10500" },
  { code: "ipl", name: "IPL", emoji: "🏏", seriesId: "44" },
  { code: "mls", name: "MLS", emoji: "⚽", seriesId: "10189" },
  { code: "ncaab", name: "NCAAB", emoji: "🏀", seriesId: "39" },
];

export async function GET() {
  try {
    // Fetch sport metadata from Gamma to get images
    const res = await fetch("https://gamma-api.polymarket.com/sports", {
      next: { revalidate: 1800 }, // 30 min cache
    });

    let images: Record<string, string> = {};
    if (res.ok) {
      const sports = await res.json();
      for (const s of sports) {
        images[s.sport] = s.image || "";
      }
    }

    const leagues = POPULAR_LEAGUES.map((l) => ({
      ...l,
      image: images[l.code] || "",
    }));

    return NextResponse.json({ leagues });
  } catch {
    return NextResponse.json({ leagues: POPULAR_LEAGUES });
  }
}
