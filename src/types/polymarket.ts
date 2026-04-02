export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  liquidity: string;
  volume: string;
  volume24hr: string;
  active: boolean;
  closed: boolean;
  marketMakerAddress: string;
  outcomePrices: string; // JSON stringified array e.g. '["0.65","0.35"]'
  outcomes: string; // JSON stringified array e.g. '["Yes","No"]'
  image: string;
  icon: string;
  description: string;
  groupItemTitle: string;
  enableOrderBook: boolean;
  // CLOB fields (more accurate than outcomePrices)
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  oneDayPriceChange?: number;
  clobTokenIds?: string; // JSON stringified array
  eventSlug?: string; // Attached by our API from the parent event
  category?: string; // Categorized by our API (Politics, Crypto, etc.)
}

export interface PolymarketEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  image: string;
  icon: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  new: boolean;
  featured: boolean;
  restricted: boolean;
  liquidity: number;
  volume: number;
  markets: PolymarketMarket[];
  commentCount: number;
}

export interface MarketWithPrices extends PolymarketMarket {
  yesPrice: number;
  noPrice: number;
  parsedOutcomes: string[];
}

export function parseMarketPrices(market: PolymarketMarket): MarketWithPrices {
  let yesPrice = 0.5;
  let noPrice = 0.5;
  let parsedOutcomes: string[] = ["Yes", "No"];

  // Priority 1: Use lastTradePrice or bestBid (most accurate, from CLOB)
  if (market.lastTradePrice && market.lastTradePrice > 0 && market.lastTradePrice < 1) {
    yesPrice = market.lastTradePrice;
    noPrice = 1 - yesPrice;
  }
  // Priority 2: Use bestBid/bestAsk midpoint
  else if (market.bestBid && market.bestAsk && market.bestBid > 0) {
    yesPrice = (market.bestBid + market.bestAsk) / 2;
    noPrice = 1 - yesPrice;
  }
  // Priority 3: Fall back to outcomePrices (can be stale)
  else {
    try {
      const prices = JSON.parse(market.outcomePrices);
      yesPrice = parseFloat(prices[0]) || 0.5;
      noPrice = parseFloat(prices[1]) || 0.5;
    } catch {}
  }

  try {
    parsedOutcomes = JSON.parse(market.outcomes);
  } catch {}

  return { ...market, yesPrice, noPrice, parsedOutcomes };
}

export function formatVolume(vol: string | number): string {
  const n = typeof vol === "string" ? parseFloat(vol) : vol;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function formatPercentage(price: number): string {
  return `${(price * 100).toFixed(0)}%`;
}
