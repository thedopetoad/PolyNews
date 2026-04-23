import { NextRequest, NextResponse } from "next/server";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";

// Migrated from /events → /events/keyset on 2026-04-23. Callers today
// (/ai + /trade pages) only pass `limit`, so there's no cursor
// threading to preserve — we just hit page 1 of the keyset feed.
// `offset` kept in ALLOWED_PARAMS as a no-op for backward compat so
// older cached frontends don't 400; it's dropped before the upstream
// call since the deprecated endpoint goes away 2026-05-01.
const ALLOWED_PARAMS = ["active", "closed", "limit", "offset", "slug", "id", "tag"];
const MAX_LIMIT = 50;
const MIN_VOLUME = 10000; // $10K minimum to filter junk markets
const KEYSET_UPSTREAM_STRIP = new Set(["offset"]);

interface MarketData {
  clobTokenIds?: string;
  outcomePrices?: string;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  [key: string]: unknown;
}

interface EventData {
  markets?: MarketData[];
  [key: string]: unknown;
}

interface KeysetEventsResponse {
  events?: EventData[];
  next_cursor?: string | null;
}

/**
 * Fetch one page of events from the keyset endpoint. Returns just the
 * events array so the rest of the handler (which was written against
 * the legacy array-shaped response) keeps working.
 */
async function fetchKeysetEvents(params: URLSearchParams): Promise<EventData[]> {
  const upstream = new URLSearchParams();
  for (const [k, v] of params) {
    if (!KEYSET_UPSTREAM_STRIP.has(k)) upstream.set(k, v);
  }
  try {
    const res = await fetch(
      `${POLYMARKET_GAMMA_API}/events/keyset?${upstream.toString()}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 15 } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as KeysetEventsResponse | EventData[];
    // Defensive: if Gamma ever fully removes the legacy shape, this
    // might briefly return the new object; handle both.
    if (Array.isArray(body)) return body;
    return body.events ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch real-time midpoint price from CLOB API for a token.
 */
async function getClobPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.mid === "string" ? parseFloat(data.mid) : (data.mid ?? null);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();

  for (const key of ALLOWED_PARAMS) {
    const val = searchParams.get(key);
    if (val !== null) params.set(key, val);
  }

  if (!params.has("active")) params.set("active", "true");
  if (!params.has("closed")) params.set("closed", "false");
  const limit = Math.min(parseInt(params.get("limit") || "20"), MAX_LIMIT);
  params.set("limit", String(limit));

  try {
    let events: EventData[];

    // If no tag specified, fetch from multiple tags for diversity
    if (!params.has("tag")) {
      const tags = ["politics", "sports", "crypto", "finance", "science", "pop-culture", "us-economics", "world", "entertainment"];
      const tagParams = new URLSearchParams(params);
      tagParams.set("limit", "8");

      const tagFetches = tags.map((tag) => {
        const tp = new URLSearchParams(tagParams);
        tp.set("tag", tag);
        return fetchKeysetEvents(tp);
      });

      // Also fetch default (no tag) for trending/popular
      const defaultFetch = fetchKeysetEvents(params);

      const [defaultEvents, ...tagResults] = await Promise.all([defaultFetch, ...tagFetches]);

      // Merge and deduplicate by event ID, cap at requested limit
      const seen = new Set<string>();
      events = [];
      for (const batch of [defaultEvents, ...tagResults]) {
        for (const event of batch as EventData[]) {
          const eid = (event as Record<string, unknown>).id as string;
          if (eid && !seen.has(eid)) {
            seen.add(eid);
            events.push(event);
          }
        }
      }
      // Cap total events to avoid CLOB price fetch timeout
      events = events.slice(0, limit);
    } else {
      events = await fetchKeysetEvents(params);
    }

    // Attach event metadata to each market + filter junk sub-markets
    for (const event of events as EventData[]) {
      if (!event.markets) continue;
      const eventSlug = event.slug as string || "";
      const eventImage = event.image as string || "";
      for (const market of event.markets) {
        (market as Record<string, unknown>).eventSlug = eventSlug;
        if (!market.image && eventImage) {
          (market as Record<string, unknown>).image = eventImage;
        }
      }

      // Remove low-volume junk sub-markets (keeps events cleaner)
      event.markets = event.markets.filter((m) => {
        const vol = parseFloat((m as Record<string, unknown>).volume as string || "0");
        return vol >= MIN_VOLUME;
      });
    }

    // Collect markets needing CLOB price enrichment
    const priceFetches: { event: EventData; market: MarketData; tokenId: string; volume: number }[] = [];
    for (const event of events as EventData[]) {
      if (!event.markets) continue;
      for (const market of event.markets) {
        if (market.clobTokenIds) {
          try {
            const tokenIds = JSON.parse(market.clobTokenIds as string);
            if (tokenIds[0]) {
              priceFetches.push({ event, market, tokenId: tokenIds[0], volume: parseFloat((market as Record<string, unknown>).volume as string || "0") });
            }
          } catch {}
        }
      }
    }

    // Sort by volume descending so the most important markets get CLOB prices first
    priceFetches.sort((a, b) => b.volume - a.volume);

    // Fetch CLOB prices in parallel — cap at 100 to avoid Vercel timeout
    const cappedFetches = priceFetches.slice(0, 100);
    const BATCH_SIZE = 20;
    for (let i = 0; i < cappedFetches.length; i += BATCH_SIZE) {
      const batch = cappedFetches.slice(i, i + BATCH_SIZE);
      const prices = await Promise.all(
        batch.map((b) => getClobPrice(b.tokenId))
      );
      for (let j = 0; j < batch.length; j++) {
        const price = prices[j];
        if (price !== null && price > 0 && price < 1) {
          const market = batch[j].market;
          market.outcomePrices = JSON.stringify([
            price.toFixed(6),
            (1 - price).toFixed(6),
          ]);
          market.lastTradePrice = price;
          market.bestBid = price;
          market.bestAsk = price;
        }
      }
    }

    // Categorize each market based on its question text
    // Order matters! More specific categories first to prevent misclassification
    const categoryKeywords: [string, string[]][] = [
      ["Sports", ["nba", "nfl", "mlb", "nhl", "ufc", "championship", "finals", "stanley cup", "super bowl", "world cup", "premier league", "serie a", "la liga", "bundesliga", "champions league", "europa league", "oilers", "golden knights", "bulls", "spurs", "thunder", "avalanche", "wild", "lakers", "celtics", "panthers", "rangers", "hurricanes", "stars", "lightning", "maple leafs", "bruins", "jets", "flames", "senators", "canucks", "predators", "blue jackets", "red wings", "blackhawks", "islanders", "devils", "flyers", "penguins", "capitals", "canadiens", "sabres", "ducks", "sharks", "coyotes", "warriors", "nuggets", "heat", "knicks", "nets", "clippers", "bucks", "76ers", "cavaliers", "pacers", "hawks", "magic", "raptors", "pistons", "hornets", "wizards", "grizzlies", "pelicans", "trail blazers", "timberwolves", "mavericks", "rockets", "suns", "kings", "manchester city", "manchester united", "liverpool", "arsenal", "chelsea", "tottenham", "barcelona", "real madrid", "bayern munich", "atletico madrid", "psg", "sporting", "club brugge", "inter milan", "ac milan", "juventus", "borussia dortmund"]],
      ["Culture", ["oscar", "grammy", "album", "movie", "gta vi", "gta 6", "before gta", "rihanna", "taylor swift", "playboi", "jesus", "pregnant", "bachelor", "weinstein", "epstein"]],
      ["Geopolitics", ["ukraine", "russia", "china", "iran", "israel", "gaza", "nato", "war", "ceasefire", "military", "troops", "sanctions", "macron", "starmer", "xi jinping"]],
      ["Crypto", ["bitcoin", "ethereum", "crypto", "btc", "eth", "defi", "nft", "solana", "coinbase", "microstrategy", "stablecoin", "airdrop", "token", "market cap", "pump.fun", "hyperliquid", "megaeth"]],
      ["Tech", ["artificial intelligence", " ai", "ai ", "openai", "google", "apple", "meta ", "tesla", "nvidia", "tiktok", "spacex", "gpt", "starship", "deepseek", "anthropic", "microsoft", "amazon", "robot", "semiconductor", "chip"]],
      ["Finance", ["federal reserve", "the fed", "fed cut", "fed hike", "fed rate", "interest rate", "inflation", "gdp", "recession", "stock market", "oil price", "gold price", "tariff", "ipo", "s&p 500", "s&p500", "nasdaq", "dow jones", "treasury", "bond", "yield", "cpi", "jobs report", "unemployment", "housing", "kraken ipo"]],
      ["Politics", ["president", "election", "democrat", "republican", "senate", "congress", "nomination", "governor", "mayor", "vote", "ballot", "primary", "trump", "biden", "harris", "desantis", "newsom", "balance of power", "scotus", "supreme court"]],
    ];
    for (const event of events as EventData[]) {
      if (!event.markets) continue;
      for (const market of event.markets) {
        const q = ((market as Record<string, unknown>).question as string || "").toLowerCase();
        let cat = "Other";
        for (const [category, keywords] of categoryKeywords) {
          if (keywords.some((kw) => q.includes(kw))) { cat = category; break; }
        }
        (market as Record<string, unknown>).category = cat;
      }
    }

    // Filter out closed/resolved sub-markets
    for (const event of events as EventData[]) {
      if (event.markets) {
        event.markets = event.markets.filter(
          (m: MarketData) => !(m as { closed?: boolean }).closed
        );
      }
    }

    // Remove events with no active markets left
    const filtered = (events as EventData[]).filter(
      (e) => e.markets && e.markets.length > 0
    );

    return NextResponse.json(filtered);
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to Polymarket API" },
      { status: 502 }
    );
  }
}
