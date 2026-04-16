import { NextRequest, NextResponse } from "next/server";

/**
 * Batched team-logo lookup per sport. One ESPN call per sport gets back every
 * team's logo + display name; we normalize names and return a map that the
 * client can look up with fuzzy-ish matching (contains a word, etc).
 *
 * Cached aggressively (6h) because logo URLs change rarely and ESPN's
 * scoreboard endpoint is the rate-sensitive one we use for live scores.
 */

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

const SPORT_PATH: Record<string, string> = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  ncaab: "basketball/mens-college-basketball",
  nfl: "football/nfl",
  ncaaf: "football/college-football",
  nhl: "hockey/nhl",
  mls: "soccer/usa.1",
  epl: "soccer/eng.1",
  laliga: "soccer/esp.1",
  ucl: "soccer/uefa.champions",
  uel: "soccer/uefa.europa",
  wnba: "basketball/wnba",
};

interface ESPNTeam {
  id: string;
  displayName: string;
  shortDisplayName?: string;
  abbreviation?: string;
  logos?: { href: string }[];
}

export async function GET(req: NextRequest) {
  const sport = req.nextUrl.searchParams.get("sport") || "";
  const path = SPORT_PATH[sport.toLowerCase()];
  if (!path) return NextResponse.json({ teams: {} });

  try {
    const res = await fetch(`${ESPN}/${path}/teams`, {
      next: { revalidate: 21600 }, // 6 hours
    });
    if (!res.ok) return NextResponse.json({ teams: {} });
    const data = await res.json();

    // ESPN wraps teams deep: sports[0].leagues[0].teams[i].team
    const leagues = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
    const teams: Record<string, { logo: string; name: string; abbr: string }> = {};

    for (const entry of leagues) {
      const t: ESPNTeam | undefined = entry?.team;
      if (!t?.displayName) continue;
      const logo = t.logos?.[0]?.href ?? "";
      const abbr = t.abbreviation ?? "";
      // Index by multiple keys so fuzzy match from Polymarket titles works:
      // "Baltimore Orioles" → we might receive "Orioles" or "Baltimore" alone.
      const record = { logo, name: t.displayName, abbr };
      teams[t.displayName.toLowerCase()] = record;
      if (t.shortDisplayName) teams[t.shortDisplayName.toLowerCase()] = record;
      if (abbr) teams[abbr.toLowerCase()] = record;
      // Also index the last word (usually the mascot) since Polymarket titles
      // like "Orioles vs Guardians" drop the city.
      const last = t.displayName.split(/\s+/).pop();
      if (last && last.length > 2) teams[last.toLowerCase()] = record;
    }

    return NextResponse.json({ teams });
  } catch (e) {
    console.error("ESPN teams fetch error:", e);
    return NextResponse.json({ teams: {} });
  }
}
