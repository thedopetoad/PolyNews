import { NextResponse } from "next/server";

// ESPN CDN league logos (reliable, high quality, transparent PNGs)
const ESPN_LOGOS = "https://a.espncdn.com/i/teamlogos/leagues/500";

// code: internal sport code (maps to our API route param `?sport=<code>`)
// seriesId: Polymarket Gamma series ID (used to query events per-league)
// Tennis + esports don't have ESPN scoreboards, so no need for ESPN_SPORT_MAP.
const POPULAR_LEAGUES = [
  { code: "mlb", name: "MLB", emoji: "⚾", seriesId: "3", image: `${ESPN_LOGOS}/mlb.png` },
  { code: "nba", name: "NBA", emoji: "🏀", seriesId: "10345", image: `${ESPN_LOGOS}/nba.png` },
  { code: "nfl", name: "NFL", emoji: "🏈", seriesId: "10187", image: `${ESPN_LOGOS}/nfl.png` },
  { code: "nhl", name: "NHL", emoji: "🏒", seriesId: "10346", image: `${ESPN_LOGOS}/nhl.png` },
  { code: "epl", name: "Premier League", emoji: "⚽", seriesId: "10188", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png" },
  { code: "lal", name: "La Liga", emoji: "⚽", seriesId: "10193", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png" },
  { code: "bun", name: "Bundesliga", emoji: "⚽", seriesId: "10194", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png" },
  { code: "ucl", name: "Champions League", emoji: "🏆", seriesId: "10204", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png" },
  { code: "mls", name: "MLS", emoji: "⚽", seriesId: "10189", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/19.png" },
  { code: "ncaab", name: "NCAAB", emoji: "🏀", seriesId: "39", image: "https://a.espncdn.com/i/espn/misc_logos/500/ncaa.png" },
  { code: "ufc", name: "UFC", emoji: "🥊", seriesId: "10500", image: "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/ufc.png&w=40&h=40" },
  { code: "atp", name: "ATP", emoji: "🎾", seriesId: "10365", image: "https://a.espncdn.com/i/teamlogos/leagues/500/atp.png" },
  { code: "wta", name: "WTA", emoji: "🎾", seriesId: "10366", image: "https://a.espncdn.com/i/teamlogos/leagues/500/wta.png" },
  { code: "ipl", name: "IPL", emoji: "🏏", seriesId: "44", image: "https://a.espncdn.com/i/leaguelogos/cricket/500/8048.png" },
  { code: "cs", name: "Counter-Strike", emoji: "🔫", seriesId: "10310", image: "" },
  { code: "lol", name: "League of Legends", emoji: "🎮", seriesId: "10311", image: "" },
  { code: "dota", name: "Dota 2", emoji: "🎮", seriesId: "10309", image: "" },
  { code: "val", name: "Valorant", emoji: "🎯", seriesId: "10369", image: "" },
];

export async function GET() {
  return NextResponse.json({ leagues: POPULAR_LEAGUES });
}
