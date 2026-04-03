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
 * Get the top 10 quality markets for AI consensus.
 * Prioritizes soonest-ending markets (1 day to 5 weeks) with high volume,
 * category diversity, and no joke markets.
 */
export function getTopConsensusMarkets(events: PolymarketEvent[]): MarketWithPrices[] {
  const now = Date.now();
  const oneDay = now + 1 * 24 * 60 * 60 * 1000;
  const threeMonths = now + 90 * 24 * 60 * 60 * 1000;

  const markets = events
    .flatMap((e) => (e.markets || []).map((m) => parseMarketPrices(m)))
    .filter((m) => {
      if (m.yesPrice <= 0.05 || m.yesPrice >= 0.95) return false;
      if (parseFloat(m.volume || "0") < 50000) return false;

      const end = new Date(m.endDate).getTime();
      if (isNaN(end) || end < oneDay || end > threeMonths) return false;

      const q = (m.question || "").toLowerCase();
      if (SILLY_BLOCKLIST.some((term) => q.includes(term))) return false;

      return true;
    });

  // Sort by end date FIRST (soonest first), then by volume as tiebreaker
  markets.sort((a, b) => {
    const endA = new Date(a.endDate).getTime();
    const endB = new Date(b.endDate).getTime();
    if (endA !== endB) return endA - endB; // Soonest first
    return parseFloat(b.volume || "0") - parseFloat(a.volume || "0"); // Highest volume
  });

  // Category diversity: max 4 per category, max 2 from same event/topic
  const categoryCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const diverse: MarketWithPrices[] = [];

  for (const m of markets) {
    const cat = m.category || "Other";
    if ((categoryCounts[cat] || 0) >= 4) continue;

    // Detect same-topic markets (e.g., "2026 Masters" or "Hungary PM")
    const topic = (m.question || "").replace(/\b(Will|win|the|be|a|an)\b/gi, "").slice(0, 30).trim();
    const topicKey = topic.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    if ((topicCounts[topicKey] || 0) >= 2) continue;

    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    topicCounts[topicKey] = (topicCounts[topicKey] || 0) + 1;
    diverse.push(m);
    if (diverse.length === 10) break;
  }

  return diverse;
}

/**
 * Get the top 5 sports markets ending soonest.
 * Prioritizes imminent markets (today → 2 weeks), with volume-based fallback.
 */
export function getSportsMarketsEndingSoon(events: PolymarketEvent[]): MarketWithPrices[] {
  const now = Date.now();
  const twoWeeks = now + 14 * 24 * 60 * 60 * 1000;

  const allSports = events
    .flatMap((e) => (e.markets || []).map((m) => parseMarketPrices(m)))
    .filter((m) => {
      if (m.category !== "Sports") return false;
      if (m.yesPrice <= 0.05 || m.yesPrice >= 0.95) return false;
      if (parseFloat(m.volume || "0") < 10000) return false;
      return true;
    });

  // First: markets ending within 2 weeks, sorted by end date
  const endingSoon = allSports
    .filter((m) => {
      const end = new Date(m.endDate).getTime();
      return !isNaN(end) && end >= now && end <= twoWeeks;
    })
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

  // Topic diversity: max 2 per event/topic
  const topicCounts: Record<string, number> = {};
  const diverse: MarketWithPrices[] = [];

  const pool = endingSoon.length >= 5 ? endingSoon : allSports.sort((a, b) => {
    const endA = new Date(a.endDate).getTime();
    const endB = new Date(b.endDate).getTime();
    if (Math.abs(endA - endB) > 7 * 86400000) return endA - endB;
    return parseFloat(b.volume || "0") - parseFloat(a.volume || "0");
  });

  for (const m of pool) {
    const topic = (m.question || "").replace(/\b(Will|win|the|be|a|an)\b/gi, "").slice(0, 30).trim();
    const topicKey = topic.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    if ((topicCounts[topicKey] || 0) >= 2) continue;
    topicCounts[topicKey] = (topicCounts[topicKey] || 0) + 1;
    diverse.push(m);
    if (diverse.length === 5) break;
  }

  return diverse;
}
