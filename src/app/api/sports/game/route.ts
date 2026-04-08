import { NextRequest, NextResponse } from "next/server";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports";

// Map Polymarket sport codes to ESPN paths
const ESPN_SPORT_MAP: Record<string, string> = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nfl: "football/nfl",
  nhl: "hockey/nhl",
  ncaab: "basketball/mens-college-basketball",
  wnba: "basketball/wnba",
  mls: "soccer/usa.1",
  epl: "soccer/eng.1",
  lal: "soccer/esp.1",
  bun: "soccer/ger.1",
  ucl: "soccer/uefa.champions",
  ufc: "mma/ufc",
};

interface ESPNScore {
  homeTeam: { name: string; abbreviation: string; score: string; logo: string; record?: string };
  awayTeam: { name: string; abbreviation: string; score: string; logo: string; record?: string };
  status: string;
  detail: string;
  period: number;
  clock: string;
  isLive: boolean;
}

async function fetchESPNScore(sport: string, teamA: string, teamB: string): Promise<ESPNScore | null> {
  const espnPath = ESPN_SPORT_MAP[sport];
  if (!espnPath) return null;

  try {
    const res = await fetch(`${ESPN_API}/${espnPath}/scoreboard`, {
      next: { revalidate: 30 }, // 30 second cache for live scores
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Find matching game by team names
    const aLower = teamA.toLowerCase();
    const bLower = teamB.toLowerCase();

    for (const event of data.events || []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const teams = comp.competitors || [];
      const names = teams.map((t: { team: { displayName: string; shortDisplayName: string; abbreviation: string } }) =>
        `${t.team.displayName} ${t.team.shortDisplayName} ${t.team.abbreviation}`.toLowerCase()
      );

      // Check if both teams match
      const matchA = names.some((n: string) => aLower.split(/\s+/).some((w: string) => w.length > 2 && n.includes(w)));
      const matchB = names.some((n: string) => bLower.split(/\s+/).some((w: string) => w.length > 2 && n.includes(w)));

      if (matchA && matchB) {
        const home = teams.find((t: { homeAway: string }) => t.homeAway === "home");
        const away = teams.find((t: { homeAway: string }) => t.homeAway === "away");
        if (!home || !away) continue;

        const status = comp.status?.type;
        return {
          homeTeam: {
            name: home.team.displayName,
            abbreviation: home.team.abbreviation,
            score: home.score || "0",
            logo: home.team.logo || "",
            record: home.records?.[0]?.summary || "",
          },
          awayTeam: {
            name: away.team.displayName,
            abbreviation: away.team.abbreviation,
            score: away.score || "0",
            logo: away.team.logo || "",
            record: away.records?.[0]?.summary || "",
          },
          status: status?.name || "",
          detail: status?.detail || "",
          period: comp.status?.period || 0,
          clock: comp.status?.displayClock || "",
          isLive: status?.name === "STATUS_IN_PROGRESS",
        };
      }
    }
    return null;
  } catch {
    return null;
  }
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
  const eventId = request.nextUrl.searchParams.get("eventId");
  const sport = request.nextUrl.searchParams.get("sport") || "";

  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  try {
    // Fetch event from Gamma
    const res = await fetch(`${GAMMA_API}/events/${eventId}`, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const event = await res.json();

    // Parse all markets and categorize them
    const moneylineMarkets: typeof parsedMarkets = [];
    const spreadMarkets: typeof parsedMarkets = [];
    const totalMarkets: typeof parsedMarkets = [];
    const propMarkets: typeof parsedMarkets = [];

    type ParsedMarket = {
      id: string;
      question: string;
      groupItemTitle: string;
      outcomes: string[];
      prices: number[];
      clobTokenIds: string[];
      volume: number;
    };

    const parsedMarkets: ParsedMarket[] = [];

    for (const m of event.markets || []) {
      if (m.closed || !m.active) continue;

      let outcomes: string[] = [];
      let prices: number[] = [];
      let clobTokenIds: string[] = [];

      try { outcomes = JSON.parse(m.outcomes || "[]"); } catch {}
      try { prices = JSON.parse(m.outcomePrices || "[]").map(Number); } catch {}
      try { clobTokenIds = JSON.parse(m.clobTokenIds || "[]"); } catch {}

      if (outcomes.length === 0) continue;

      const parsed: ParsedMarket = {
        id: m.id,
        question: m.question,
        groupItemTitle: m.groupItemTitle || "",
        outcomes,
        prices,
        clobTokenIds,
        volume: parseFloat(m.volume || "0"),
      };

      const q = m.question.toLowerCase();
      if (q.includes("spread")) {
        spreadMarkets.push(parsed);
      } else if (q.includes("o/u") && !q.includes(":")) {
        totalMarkets.push(parsed);
      } else if (q.includes(":")) {
        propMarkets.push(parsed);
      } else {
        moneylineMarkets.push(parsed);
      }
    }

    // Enrich top markets with CLOB prices
    const allKeyMarkets = [...moneylineMarkets, ...spreadMarkets.slice(0, 3), ...totalMarkets.slice(0, 3)];
    await Promise.all(
      allKeyMarkets.map(async (m) => {
        if (m.clobTokenIds[0]) {
          const mid = await getClobPrice(m.clobTokenIds[0]);
          if (mid !== null && mid > 0 && mid < 1) {
            if (m.prices.length === 2) {
              m.prices = [mid, 1 - mid];
            } else if (m.prices.length > 0) {
              m.prices[0] = mid;
            }
          }
        }
      })
    );

    // Fetch ESPN score
    const teams = event.title?.split(/\s+vs\.?\s+/i) || [];
    const espnScore = await fetchESPNScore(sport, teams[0] || "", teams[1] || "");

    // Get gameStartTime
    const firstMarket = (event.markets || [])[0];
    const gameStartTime = firstMarket?.gameStartTime || event.creationDate || event.startDate || "";

    return NextResponse.json({
      id: event.id,
      title: event.title,
      slug: event.slug,
      image: event.image || "",
      gameStartTime,
      volume: event.volume || 0,
      espn: espnScore,
      markets: {
        moneyline: moneylineMarkets,
        spreads: spreadMarkets,
        totals: totalMarkets,
        props: propMarkets.slice(0, 20), // Cap props
      },
    });
  } catch (err) {
    console.error("Game API error:", err);
    return NextResponse.json({ error: "Failed to fetch game" }, { status: 500 });
  }
}
