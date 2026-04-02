import { NextRequest, NextResponse } from "next/server";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";

const ALLOWED_PARAMS = ["active", "closed", "limit", "offset", "slug", "id", "tag"];
const MAX_LIMIT = 50;

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

    const events = await response.json();

    // Enrich each market with real-time CLOB prices
    // Collect all token IDs first, then batch fetch
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

    // Fetch CLOB prices in parallel (max 20 concurrent to avoid rate limits)
    const BATCH_SIZE = 20;
    for (let i = 0; i < priceFetches.length; i += BATCH_SIZE) {
      const batch = priceFetches.slice(i, i + BATCH_SIZE);
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
    const categoryKeywords: Record<string, string[]> = {
      Politics: ["president", "election", "democrat", "republican", "senate", "congress", "nomination", "governor", "mayor", "vote", "ballot", "primary"],
      Geopolitics: ["ukraine", "russia", "china", "iran", "israel", "gaza", "nato", "war", "ceasefire", "military", "troops", "sanctions"],
      Crypto: ["bitcoin", "ethereum", "crypto", "btc", "eth", "defi", "nft", "solana", "coinbase", "microstrategy", "stablecoin"],
      Finance: ["fed", "interest rate", "inflation", "gdp", "recession", "stock", "oil", "gold", "tariff", "ipo", "s&p", "nasdaq"],
      Tech: ["ai", "openai", "google", "apple", "meta", "tesla", "nvidia", "tiktok", "spacex", "gpt", "starship"],
      Sports: ["nba", "nfl", "mlb", "nhl", "ufc", "championship", "finals", "stanley cup", "super bowl", "world cup", "premier league"],
      Culture: ["oscar", "grammy", "album", "movie", "gta", "rihanna", "taylor swift", "playboi", "jesus", "pregnant"],
    };
    for (const event of events as EventData[]) {
      if (!event.markets) continue;
      for (const market of event.markets) {
        const q = ((market as Record<string, unknown>).question as string || "").toLowerCase();
        let cat = "Other";
        for (const [category, keywords] of Object.entries(categoryKeywords)) {
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
