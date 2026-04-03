import {
  parseMarketPrices,
  MarketWithPrices,
  PolymarketEvent,
} from "@/types/polymarket";

const SILLY_BLOCKLIST = [
  "jesus christ", "gta vi", "gta 6", "before gta",
  "alien", "ufo", "rapture", "zombie",
  "simulation", "flat earth", "illuminati",
  "pregnant", "bachelor", "dating show",
  "bigfoot", "loch ness", "time travel",
];

/**
 * Get the top 10 quality markets for AI consensus:
 * - Ends 1 week to 2 months from now
 * - Volume >= $100K
 * - Not resolved (price 5%-95%)
 * - Not silly/joke markets
 * - Category diversity (max 3 per category)
 */
export function getTopConsensusMarkets(events: PolymarketEvent[]): MarketWithPrices[] {
  const now = Date.now();
  const oneWeek = now + 7 * 24 * 60 * 60 * 1000;
  const twoMonths = now + 60 * 24 * 60 * 60 * 1000;

  let markets = events
    .flatMap((e) => (e.markets || []).map((m) => parseMarketPrices(m)))
    .filter((m) => {
      // Price range: not resolved
      if (m.yesPrice <= 0.05 || m.yesPrice >= 0.95) return false;

      // Volume >= $100K
      if (parseFloat(m.volume || "0") < 100000) return false;

      // End date in 1 week to 2 months
      const end = new Date(m.endDate).getTime();
      if (isNaN(end) || end < oneWeek || end > twoMonths) return false;

      // Not silly
      const q = (m.question || "").toLowerCase();
      if (SILLY_BLOCKLIST.some((term) => q.includes(term))) return false;

      return true;
    })
    .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"));

  // Category diversity: max 3 per category
  const categoryCounts: Record<string, number> = {};
  const diverse: MarketWithPrices[] = [];
  for (const m of markets) {
    const cat = m.category || "Other";
    if ((categoryCounts[cat] || 0) >= 3) continue;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    diverse.push(m);
    if (diverse.length === 10) break;
  }

  return diverse;
}

/**
 * Get the top 5 sports markets ending soon (today, fallback to next 3 days).
 */
export function getSportsMarketsEndingSoon(events: PolymarketEvent[]): MarketWithPrices[] {
  const today = new Date();
  const todayStr = today.toDateString();

  const allSports = events
    .flatMap((e) => (e.markets || []).map((m) => parseMarketPrices(m)))
    .filter((m) => {
      if (m.category !== "Sports") return false;
      if (m.yesPrice <= 0.05 || m.yesPrice >= 0.95) return false;
      return true;
    })
    .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"));

  // Try markets ending today first
  const endingToday = allSports.filter((m) => {
    const end = new Date(m.endDate);
    return !isNaN(end.getTime()) && end.toDateString() === todayStr;
  });

  if (endingToday.length >= 5) return endingToday.slice(0, 5);

  // Fallback: next 3 days
  const threeDays = Date.now() + 3 * 24 * 60 * 60 * 1000;
  const endingSoon = allSports.filter((m) => {
    const end = new Date(m.endDate).getTime();
    return !isNaN(end) && end <= threeDays && end >= Date.now();
  });

  if (endingSoon.length >= 5) return endingSoon.slice(0, 5);

  // Ultimate fallback: just top 5 sports by volume
  return allSports.slice(0, 5);
}
