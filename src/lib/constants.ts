export const APP_NAME = "PolyStream";
export const APP_DESCRIPTION = "Live News. Real Markets. Swarm Intelligence.";

export const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
export const POLYMARKET_BASE_URL = "https://polymarket.com";

export interface StreamChannel {
  id: string;
  name: string;
  videoId: string;
  platform: "youtube" | "rumble";
  color: string; // accent color for the channel
}

export const STREAM_CHANNELS: StreamChannel[] = [
  {
    id: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    name: "Al Jazeera",
    videoId: "",
    platform: "youtube",
    color: "#d4a843",
  },
  {
    id: "UCQfwfsi2Dcf8IMIWbJELOZQ",
    name: "Sky News",
    videoId: "",
    platform: "youtube",
    color: "#c80000",
  },
  {
    id: "UCQGqX5Ndpm4snE0NTjyOJnA",
    name: "France 24",
    videoId: "",
    platform: "youtube",
    color: "#00a1e0",
  },
  {
    id: "UCknLrEdhRCp1aegoMqRaCZg",
    name: "DW News",
    videoId: "",
    platform: "youtube",
    color: "#0055a4",
  },
  {
    id: "infowars",
    name: "Infowars",
    videoId: "",
    platform: "rumble",
    color: "#ff6600",
  },
];

// Keep legacy alias for any components still importing it
export const YOUTUBE_CHANNELS = STREAM_CHANNELS;

export const MARKET_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "trending", label: "Trending" },
  { key: "politics", label: "Politics", keywords: ["trump", "biden", "election", "president", "congress", "senate", "house", "democrat", "republican", "gop", "vote", "primary", "campaign"] },
  { key: "geopolitics", label: "Geopolitics", keywords: ["ukraine", "russia", "putin", "zelensky", "china", "xi", "taiwan", "iran", "israel", "gaza", "hamas", "hezbollah", "nato", "war"] },
  { key: "crypto", label: "Crypto", keywords: ["bitcoin", "ethereum", "crypto", "sec", "regulation", "etf", "defi", "nft", "solana", "coinbase"] },
  { key: "finance", label: "Finance", keywords: ["fed", "interest rate", "inflation", "gdp", "recession", "economy", "jobs", "unemployment", "tariff", "trade war", "debt ceiling", "stock", "s&p", "nasdaq"] },
  { key: "tech", label: "Tech", keywords: ["ai", "openai", "google", "apple", "meta", "tesla", "nvidia", "tiktok", "antitrust", "merger"] },
  { key: "sports", label: "Sports", keywords: ["nba", "nfl", "mlb", "nhl", "ufc", "boxing", "tennis", "soccer", "football", "basketball", "baseball", "championship", "finals", "super bowl", "world cup"] },
  { key: "culture", label: "Culture", keywords: ["oscar", "grammy", "emmy", "movie", "album", "celebrity", "reality", "bachelor"] },
] as const;

export type MarketCategory = typeof MARKET_CATEGORIES[number]["key"];

export const AIRDROP_AMOUNTS = {
  signup: 1000,
  daily: 100,
  weekly: 500,
  referralBonus: 5000,
  referralFirstTrade: 250,
} as const;

export const STARTING_BALANCE = 10000;

export const NAV_LINKS = [
  { href: "/", label: "News" },
  { href: "/ai", label: "AI Consensus" },
  { href: "/trade", label: "Paper Trade" },
  { href: "/docs", label: "Docs" },
] as const;

export const KEYWORD_DICTIONARY = [
  "trump", "biden", "election", "president", "congress", "senate", "house",
  "democrat", "republican", "gop", "vote", "ballot", "primary", "campaign",
  "ukraine", "russia", "putin", "zelensky", "china", "xi", "taiwan",
  "iran", "israel", "gaza", "hamas", "hezbollah", "nato", "war",
  "fed", "interest rate", "inflation", "gdp", "recession", "economy",
  "jobs", "unemployment", "tariff", "trade war", "debt ceiling",
  "bitcoin", "ethereum", "crypto", "sec", "regulation", "etf",
  "ai", "openai", "google", "apple", "meta", "tesla", "nvidia",
  "supreme court", "scotus", "un", "who", "pandemic",
  "climate", "energy", "oil", "opec",
  "spacex", "mars", "nasa", "starship",
  "tiktok", "ban", "antitrust", "merger",
  "nba", "nfl", "mlb", "ufc", "boxing", "championship", "finals",
];
