import { NextResponse } from "next/server";

// ESPN CDN league logos (reliable, high quality, transparent PNGs)
const ESPN_LOGOS = "https://a.espncdn.com/i/teamlogos/leagues/500";

const POPULAR_LEAGUES = [
  { code: "mlb", name: "MLB", emoji: "⚾", seriesId: "3", image: `${ESPN_LOGOS}/mlb.png` },
  { code: "nba", name: "NBA", emoji: "🏀", seriesId: "10345", image: `${ESPN_LOGOS}/nba.png` },
  { code: "nfl", name: "NFL", emoji: "🏈", seriesId: "10187", image: `${ESPN_LOGOS}/nfl.png` },
  { code: "nhl", name: "NHL", emoji: "🏒", seriesId: "10346", image: `${ESPN_LOGOS}/nhl.png` },
  { code: "epl", name: "Premier League", emoji: "⚽", seriesId: "10188", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png" },
  { code: "lal", name: "La Liga", emoji: "⚽", seriesId: "10193", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png" },
  { code: "bun", name: "Bundesliga", emoji: "⚽", seriesId: "10194", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png" },
  { code: "ucl", name: "Champions League", emoji: "🏆", seriesId: "10204", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png" },
  { code: "ufc", name: "UFC", emoji: "🥊", seriesId: "10500", image: "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/ufc.png&w=40&h=40" },
  { code: "ipl", name: "IPL", emoji: "🏏", seriesId: "44", image: "https://a.espncdn.com/i/leaguelogos/cricket/500/8048.png" },
  { code: "mls", name: "MLS", emoji: "⚽", seriesId: "10189", image: "https://a.espncdn.com/i/leaguelogos/soccer/500/19.png" },
  { code: "ncaab", name: "NCAAB", emoji: "🏀", seriesId: "39", image: "https://a.espncdn.com/i/espn/misc_logos/500/ncaa.png" },
];

export async function GET() {
  return NextResponse.json({ leagues: POPULAR_LEAGUES });
}
