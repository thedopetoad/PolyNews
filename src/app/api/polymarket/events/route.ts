import { NextRequest, NextResponse } from "next/server";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";

const ALLOWED_PARAMS = ["active", "closed", "limit", "offset", "slug", "id", "tag"];
const MAX_LIMIT = 50;

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
      const tags = ["politics", "sports", "crypto", "finance", "science", "pop-culture"];
      const tagParams = new URLSearchParams(params);
      tagParams.set("limit", "5");

      const tagFetches = tags.map(async (tag) => {
        const tp = new URLSearchParams(tagParams);
        tp.set("tag", tag);
        try {
          const res = await fetch(`${POLYMARKET_GAMMA_API}/events?${tp.toString()}`, {
            headers: { Accept: "application/json" },
            next: { revalidate: 60 },
          });
          if (!res.ok) return [];
          return res.json();
        } catch {
          return [];
        }
      });

      // Also fetch default (no tag) for trending/popular
      const defaultFetch = fetch(`${POLYMARKET_GAMMA_API}/events?${params.toString()}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }).then((r) => (r.ok ? r.json() : [])).catch(() => []);

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
      const response = await fetch(
        `${POLYMARKET_GAMMA_API}/events?${params.toString()}`,
        {
          headers: { Accept: "application/json" },
          next: { revalidate: 60 },
        }
      );

      if (!response.ok) {
        return NextResponse.json(
          { error: "Failed to fetch events" },
          { status: response.status }
        );
      }

      events = await response.json();
    }

    // Enrich each market with real-time CLOB prices
    const priceFetches: { event: EventData; market: MarketData; tokenId: string }[] = [];

    for (const event of events as EventData[]) {
      if (!event.markets) continue;
      // Attach event slug to each market so links work correctly
      const eventSlug = event.slug as string || "";
      const eventImage = event.image as string || "";
      for (const market of event.markets) {
        (market as Record<string, unknown>).eventSlug = eventSlug;
        // Use event image as fallback if market has no image
        if (!market.image && eventImage) {
          (market as Record<string, unknown>).image = eventImage;
        }
        if (market.clobTokenIds) {
          try {
            const tokenIds = JSON.parse(market.clobTokenIds as string);
            if (tokenIds[0]) {
              priceFetches.push({ event, market, tokenId: tokenIds[0] });
            }
          } catch {}
        }
      }
    }

    // Fetch CLOB prices in parallel — cap at 80 to avoid Vercel timeout
    const cappedFetches = priceFetches.slice(0, 80);
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
          // Override the stale outcomePrices with real CLOB data
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
      ["Sports", ["nba", "nfl", "mlb", "nhl", "ufc", "championship", "finals", "stanley cup", "super bowl", "world cup", "premier league", "serie a", "la liga", "bundesliga", "oilers", "golden knights", "bulls", "spurs", "thunder", "avalanche", "wild", "lakers", "celtics", "panthers", "rangers", "hurricanes", "stars", "lightning", "maple leafs", "bruins", "jets", "flames", "senators", "canucks", "kraken", "predators", "blue jackets", "red wings", "blackhawks", "islanders", "devils", "flyers", "penguins", "capitals", "canadiens", "sabres", "ducks", "sharks", "coyotes", "warriors", "nuggets", "heat", "knicks", "nets", "clippers", "bucks", "76ers", "cavaliers", "pacers", "hawks", "magic", "raptors", "pistons", "hornets", "wizards", "grizzlies", "pelicans", "trail blazers", "timberwolves", "mavericks", "rockets", "suns", "kings"]],
      ["Culture", ["oscar", "grammy", "album", "movie", "gta vi", "gta 6", "before gta", "rihanna", "taylor swift", "playboi", "jesus", "pregnant", "bachelor"]],
      ["Geopolitics", ["ukraine", "russia", "china", "iran", "israel", "gaza", "nato", "war", "ceasefire", "military", "troops", "sanctions", "macron", "starmer"]],
      ["Crypto", ["bitcoin", "ethereum", "crypto", "btc", "eth", "defi", "nft", "solana", "coinbase", "microstrategy", "stablecoin"]],
      ["Tech", ["ai ", "openai", "google", "apple", "meta", "tesla", "nvidia", "tiktok", "spacex", "gpt", "starship"]],
      ["Politics", ["president", "election", "democrat", "republican", "senate", "congress", "nomination", "governor", "mayor", "vote", "ballot", "primary"]],
      ["Finance", ["fed ", "interest rate", "inflation", "gdp", "recession", "stock", "oil", "gold", "tariff", "ipo", "s&p", "nasdaq"]],
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

    // Filter out closed/resolved sub-markets from each event
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
