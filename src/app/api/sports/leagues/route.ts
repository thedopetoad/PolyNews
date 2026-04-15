import { NextResponse } from "next/server";

// ESPN CDN league logos (reliable, high quality, transparent PNGs)
const ESPN_LOGOS = "https://a.espncdn.com/i/teamlogos/leagues/500";
const ESPN_SOCCER = "https://a.espncdn.com/i/leaguelogos/soccer/500";

export interface LeagueItem {
  code: string;       // sport code used in our /api/sports/events?sport=<code>
  name: string;
  seriesId: string;   // Polymarket Gamma series ID
  emoji: string;
  image?: string;     // optional logo URL; client falls back to emoji
}

export interface SportCategory {
  code: string;
  name: string;
  emoji: string;
  leagues: LeagueItem[];
}

// Categorized to match polymarket.com's Sports layout. Series IDs were
// resolved against gamma-api.polymarket.com/series.
const CATEGORIES: SportCategory[] = [
  {
    code: "basketball",
    name: "Basketball",
    emoji: "🏀",
    leagues: [
      { code: "nba", name: "NBA", emoji: "🏀", seriesId: "10345", image: `${ESPN_LOGOS}/nba.png` },
      { code: "ncaab", name: "NCAAB", emoji: "🏀", seriesId: "39", image: `https://a.espncdn.com/i/espn/misc_logos/500/ncaa.png` },
      { code: "fibaam", name: "FIBA WCQ Americas", emoji: "🏀", seriesId: "11472" },
      { code: "fibaeu", name: "FIBA WCQ Europe", emoji: "🏀", seriesId: "11474" },
    ],
  },
  {
    code: "soccer",
    name: "Soccer",
    emoji: "⚽",
    leagues: [
      { code: "epl", name: "Premier League", emoji: "⚽", seriesId: "10188", image: `${ESPN_SOCCER}/23.png` },
      { code: "lal", name: "La Liga", emoji: "⚽", seriesId: "10193", image: `${ESPN_SOCCER}/15.png` },
      { code: "bun", name: "Bundesliga", emoji: "⚽", seriesId: "10194", image: `${ESPN_SOCCER}/10.png` },
      { code: "ucl", name: "Champions League", emoji: "🏆", seriesId: "10204", image: `${ESPN_SOCCER}/2.png` },
      { code: "mls", name: "MLS", emoji: "⚽", seriesId: "10189", image: `${ESPN_SOCCER}/19.png` },
      { code: "bun2", name: "Bundesliga 2", emoji: "⚽", seriesId: "10670", image: `${ESPN_SOCCER}/3009.png` },
      { code: "efl", name: "EFL Championship", emoji: "⚽", seriesId: "10355", image: `${ESPN_SOCCER}/24.png` },
      { code: "ere", name: "Eredivisie", emoji: "⚽", seriesId: "10286", image: `${ESPN_SOCCER}/11.png` },
      { code: "coplib", name: "Copa Libertadores", emoji: "⚽", seriesId: "10289", image: `${ESPN_SOCCER}/13.png` },
      { code: "argpd", name: "Argentina Primera", emoji: "⚽", seriesId: "10285", image: `${ESPN_SOCCER}/7.png` },
      { code: "brsa", name: "Brasileirão", emoji: "⚽", seriesId: "10359", image: `${ESPN_SOCCER}/6.png` },
      { code: "rpl", name: "Russian Premier League", emoji: "⚽", seriesId: "10313" },
      { code: "fifafri", name: "FIFA Friendly", emoji: "⚽", seriesId: "10238" },
      { code: "ccc", name: "CONCACAF Champions Cup", emoji: "⚽", seriesId: "11464" },
      { code: "wsawq", name: "WC Qualification S. America", emoji: "🌎", seriesId: "11437" },
      { code: "fifawc", name: "FIFA Women's World Cup", emoji: "🏆", seriesId: "11448" },
    ],
  },
  {
    code: "baseball",
    name: "Baseball",
    emoji: "⚾",
    leagues: [
      { code: "mlb", name: "MLB", emoji: "⚾", seriesId: "3", image: `${ESPN_LOGOS}/mlb.png` },
      { code: "kbo", name: "KBO", emoji: "⚾", seriesId: "10370" },
    ],
  },
  {
    code: "football",
    name: "Football",
    emoji: "🏈",
    leagues: [
      { code: "nfl", name: "NFL", emoji: "🏈", seriesId: "10187", image: `${ESPN_LOGOS}/nfl.png` },
    ],
  },
  {
    code: "hockey",
    name: "Hockey",
    emoji: "🏒",
    leagues: [
      { code: "nhl", name: "NHL", emoji: "🏒", seriesId: "10346", image: `${ESPN_LOGOS}/nhl.png` },
      { code: "olyhk", name: "Winter Olympics Hockey", emoji: "🏒", seriesId: "11136" },
    ],
  },
  {
    code: "tennis",
    name: "Tennis",
    emoji: "🎾",
    leagues: [
      { code: "atp", name: "ATP", emoji: "🎾", seriesId: "10365" },
      { code: "wta", name: "WTA", emoji: "🎾", seriesId: "10366" },
    ],
  },
  {
    code: "cricket",
    name: "Cricket",
    emoji: "🏏",
    leagues: [
      { code: "ipl", name: "IPL", emoji: "🏏", seriesId: "44", image: "https://a.espncdn.com/i/leaguelogos/cricket/500/8048.png" },
      { code: "mlc", name: "Major League Cricket", emoji: "🏏", seriesId: "11221" },
      { code: "intcri", name: "International Cricket", emoji: "🏏", seriesId: "10528" },
      { code: "cri-in", name: "Cricket India", emoji: "🏏", seriesId: "10748" },
      { code: "cri-pk", name: "Cricket Pakistan", emoji: "🏏", seriesId: "10751" },
      { code: "cri-sa", name: "Cricket South Africa", emoji: "🏏", seriesId: "10753" },
      { code: "cpl", name: "Caribbean Premier League", emoji: "🏏", seriesId: "11216" },
      { code: "wpl", name: "Women's Premier League", emoji: "🏏", seriesId: "10908" },
    ],
  },
  {
    code: "mma",
    name: "MMA",
    emoji: "🥊",
    leagues: [
      { code: "ufc", name: "UFC", emoji: "🥊", seriesId: "10500", image: `https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/ufc.png&w=40&h=40` },
    ],
  },
  {
    code: "golf",
    name: "Golf",
    emoji: "⛳",
    leagues: [
      { code: "pga", name: "PGA Tour", emoji: "⛳", seriesId: "10976" },
    ],
  },
  {
    code: "rugby",
    name: "Rugby",
    emoji: "🏉",
    leagues: [
      { code: "rugby-t14", name: "Rugby Top 14", emoji: "🏉", seriesId: "10841" },
    ],
  },
  {
    code: "chess",
    name: "Chess",
    emoji: "♟",
    leagues: [
      { code: "chess", name: "Chess", emoji: "♟", seriesId: "11480" },
    ],
  },
  {
    code: "esports",
    name: "Esports",
    emoji: "🎮",
    leagues: [
      { code: "cs", name: "Counter-Strike", emoji: "🔫", seriesId: "10310" },
      { code: "lol", name: "League of Legends", emoji: "🧙", seriesId: "10311" },
      { code: "dota", name: "Dota 2", emoji: "⚔️", seriesId: "10309" },
      { code: "val", name: "Valorant", emoji: "🎯", seriesId: "10369" },
      { code: "easfifa", name: "EA Sports FIFA", emoji: "🎮", seriesId: "10428" },
    ],
  },
];

// Flat list for backwards compatibility with the existing client.
const FLAT_LEAGUES: LeagueItem[] = CATEGORIES.flatMap((c) => c.leagues);

export async function GET() {
  return NextResponse.json({ leagues: FLAT_LEAGUES, categories: CATEGORIES });
}
