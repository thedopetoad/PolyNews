import { NextRequest, NextResponse } from "next/server";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

// Map sport codes to series IDs
const SERIES_MAP: Record<string, string> = {
  mlb: "3", nba: "10345", nfl: "10187", nhl: "10346",
  epl: "10188", lal: "10193", bun: "10194", ucl: "10204",
  ufc: "10500", ipl: "44", mls: "10189", ncaab: "39",
};

interface ParsedMarket {
  id: string;
  question: string;
  slug: string;
  groupItemTitle: string;
  outcomes: string[];
  prices: number[];
  clobTokenIds: string[];
  volume: number;
  endDate: string;
}

interface ParsedEvent {
  id: string;
  title: string;
  slug: string;
  image: string;
  gameStartTime: string;
  endDate: string;
  volume: number;
  liquidity: number;
  markets: ParsedMarket[];
  negRisk: boolean;
}

async function getClobPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${CLOB_API}/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.mid ? parseFloat(data.mid) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const sport = request.nextUrl.searchParams.get("sport");
  if (!sport || !SERIES_MAP[sport]) {
    return NextResponse.json({ error: "Invalid sport code" }, { status: 400 });
  }

  try {
    const seriesId = SERIES_MAP[sport];

    // Fetch events for this league
    const res = await fetch(
      `${GAMMA_API}/events?active=true&closed=false&limit=20&series_id=${seriesId}&order=startDate&ascending=true`,
      { next: { revalidate: 120 } } // 2 min cache
    );

    if (!res.ok) {
      return NextResponse.json({ events: [] });
    }

    const rawEvents = await res.json();

    // Parse events and their markets
    const events: ParsedEvent[] = [];

    for (const event of rawEvents) {
      // Skip events that are just "league winner" type markets (no vs.)
      const markets: ParsedMarket[] = [];

      for (const m of event.markets || []) {
        if (m.closed || !m.active) continue;

        let outcomes: string[] = [];
        let prices: number[] = [];
        let clobTokenIds: string[] = [];

        try { outcomes = JSON.parse(m.outcomes || "[]"); } catch {}
        try { prices = JSON.parse(m.outcomePrices || "[]").map(Number); } catch {}
        try { clobTokenIds = JSON.parse(m.clobTokenIds || "[]"); } catch {}

        if (outcomes.length === 0) continue;

        markets.push({
          id: m.id,
          question: m.question,
          slug: m.slug,
          groupItemTitle: m.groupItemTitle || "",
          outcomes,
          prices,
          clobTokenIds,
          volume: parseFloat(m.volume || "0"),
          endDate: m.endDate,
        });
      }

      if (markets.length === 0) continue;

      // Use gameStartTime from first market, or creationDate as game time
      const firstMarket = (event.markets || [])[0];
      const gameTime = firstMarket?.gameStartTime || event.creationDate || event.startDate || "";

      events.push({
        id: event.id,
        title: event.title,
        slug: event.slug,
        image: event.image || "",
        gameStartTime: gameTime,
        endDate: event.endDate || "",
        volume: event.volume || 0,
        liquidity: event.liquidity || 0,
        markets,
        negRisk: event.negRisk || false,
      });
    }

    // Enrich top events with CLOB prices (first market of each, max 10 events)
    const enrichPromises = events.slice(0, 10).map(async (event) => {
      for (const market of event.markets) {
        if (market.clobTokenIds[0]) {
          const mid = await getClobPrice(market.clobTokenIds[0]);
          if (mid !== null && mid > 0 && mid < 1) {
            // For 2-outcome markets: yes = mid, no = 1 - mid
            if (market.prices.length === 2) {
              market.prices = [mid, 1 - mid];
            } else if (market.prices.length > 0) {
              market.prices[0] = mid;
            }
          }
        }
      }
    });

    await Promise.all(enrichPromises);

    return NextResponse.json({ events, sport });
  } catch (err) {
    console.error("Sports events error:", err);
    return NextResponse.json({ events: [], error: "Failed to fetch events" }, { status: 500 });
  }
}
