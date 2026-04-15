import { NextRequest, NextResponse } from "next/server";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports";

// Map sport codes to series IDs
const SERIES_MAP: Record<string, string> = {
  mlb: "3", nba: "10345", nfl: "10187", nhl: "10346",
  epl: "10188", lal: "10193", bun: "10194", ucl: "10204",
  ufc: "10500", ipl: "44", mls: "10189", ncaab: "39",
};

// Map sport codes to ESPN paths
const ESPN_SPORT_MAP: Record<string, string> = {
  mlb: "baseball/mlb", nba: "basketball/nba", nfl: "football/nfl",
  nhl: "hockey/nhl", ncaab: "basketball/mens-college-basketball",
  mls: "soccer/usa.1", epl: "soccer/eng.1", lal: "soccer/esp.1",
  bun: "soccer/ger.1", ucl: "soccer/uefa.champions", ufc: "mma/ufc",
};

// Fetch ESPN scoreboard and return pairs of team names for each live game
interface LiveGame {
  teams: string[]; // All team name variants for this game (both teams)
}

async function getESPNLiveGames(sport: string): Promise<LiveGame[]> {
  const espnPath = ESPN_SPORT_MAP[sport];
  if (!espnPath) return [];

  try {
    const res = await fetch(`${ESPN_API}/${espnPath}/scoreboard`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const liveGames: LiveGame[] = [];

    for (const event of data.events || []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const statusName = comp.status?.type?.name;
      if (statusName === "STATUS_IN_PROGRESS") {
        const teams: string[] = [];
        for (const t of comp.competitors || []) {
          const display = (t.team?.displayName || "").toLowerCase();
          const short = (t.team?.shortDisplayName || "").toLowerCase();
          const abbr = (t.team?.abbreviation || "").toLowerCase();
          if (display) teams.push(display);
          if (short && short !== display) teams.push(short);
          if (abbr) teams.push(abbr);
        }
        if (teams.length >= 2) liveGames.push({ teams });
      }
    }
    return liveGames;
  } catch (err) {
    console.error("ESPN live games fetch error:", err);
  }
  return [];
}

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
  espnLive?: boolean;
  /** True when the event is currently happening per ESPN OR, failing that,
   *  per Polymarket's own timing (started, not closed, within a reasonable
   *  sport-specific window). Use this for the UI "live" filter. */
  isLive?: boolean;
  // Pass through Polymarket's own state flags so the client can drop any
  // event that flipped after our 15s ISR cache was warmed.
  closed?: boolean;
  archived?: boolean;
}

// How long after tip-off a sport can still plausibly be live. Soccer ~2h,
// NFL/NBA/NHL/MLB ~3h, UFC cards ~4h, cricket (IPL) up to 8h.
const LIVE_WINDOW_HOURS: Record<string, number> = {
  mlb: 4, nba: 3, nfl: 4, nhl: 3.5,
  ncaab: 3, mls: 2.5, epl: 2.5, lal: 2.5, bun: 2.5, ucl: 2.5,
  ufc: 5, ipl: 8,
};
const DEFAULT_LIVE_WINDOW_HOURS = 3;

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

    // Fetch events for this league. 15s cache keeps upstream load sane
    // (~4 req/min/sport regardless of traffic) while staying fresh enough
    // for real-money bet slips to reflect market state changes promptly.
    const res = await fetch(
      `${GAMMA_API}/events?active=true&closed=false&limit=20&series_id=${seriesId}&order=startDate&ascending=true`,
      { next: { revalidate: 15 } }
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

      // Skip stale events — game started more than 12 hours ago
      const gameStart = new Date(gameTime).getTime();
      if (isNaN(gameStart)) continue; // Skip events with no valid game time
      if (gameStart < Date.now() - 12 * 60 * 60 * 1000) continue;

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
        closed: event.closed === true,
        archived: event.archived === true,
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

    // Deduplicate by team matchup — keep the event closest to now
    // Handles both "A vs B" and "B vs A" as the same matchup
    function matchupKey(title: string): string {
      const parts = title.toLowerCase().split(/\s+vs\.?\s+/i).map((s) => s.trim());
      if (parts.length >= 2) return [parts[0], parts[1]].sort().join(" | ");
      return title.toLowerCase();
    }
    const seen = new Map<string, number>();
    for (let i = 0; i < events.length; i++) {
      const key = matchupKey(events[i].title);
      if (seen.has(key)) {
        const prevIdx = seen.get(key)!;
        const prevStart = new Date(events[prevIdx].gameStartTime).getTime();
        const curStart = new Date(events[i].gameStartTime).getTime();
        const now = Date.now();
        const prevDist = Math.abs(prevStart - now);
        const curDist = Math.abs(curStart - now);
        if (curDist < prevDist) {
          events[prevIdx] = events[i];
          seen.set(key, prevIdx);
        }
        events.splice(i, 1);
        i--;
      } else {
        seen.set(key, i);
      }
    }

    // Check ESPN for actually live games — require BOTH teams to match the SAME ESPN game
    const liveGames = await getESPNLiveGames(sport);
    if (liveGames.length > 0) {
      for (const event of events) {
        // Split "Team A vs. Team B" into two team names
        const parts = event.title.split(/\s+vs\.?\s+/i);
        if (parts.length < 2) continue;
        const teamA = parts[0].trim().toLowerCase();
        const teamB = parts[1].trim().toLowerCase();

        // Check if both teams match the SAME ESPN live game
        event.espnLive = liveGames.some((game) => {
          const matchA = game.teams.some((t) => t.includes(teamA) || teamA.includes(t));
          const matchB = game.teams.some((t) => t.includes(teamB) || teamB.includes(t));
          return matchA && matchB;
        });
      }
    }

    // Compute unified isLive = ESPN live OR Polymarket-only heuristic.
    // ESPN has gaps (mid-week UCL, niche soccer, UFC undercards, etc.). If
    // Polymarket says the event is running, hasn't closed, and we're inside
    // a reasonable window after tip-off, surface it as live so our site
    // matches what users see on polymarket.com.
    const windowMs =
      (LIVE_WINDOW_HOURS[sport] ?? DEFAULT_LIVE_WINDOW_HOURS) * 60 * 60 * 1000;
    const nowMs = Date.now();
    for (const event of events) {
      if (event.espnLive === true) {
        event.isLive = true;
        continue;
      }
      if (event.closed || event.archived) continue;
      const gs = new Date(event.gameStartTime).getTime();
      if (isNaN(gs) || gs > nowMs) continue; // not started
      // Prefer the market's endDate when present; otherwise fall back to a
      // sport-specific post-tipoff window.
      const end = event.endDate
        ? new Date(event.endDate).getTime()
        : gs + windowMs;
      if (isNaN(end) || end < nowMs) continue; // already over
      event.isLive = true;
    }

    return NextResponse.json({ events, sport });
  } catch (err) {
    console.error("Sports events error:", err);
    return NextResponse.json({ events: [], error: "Failed to fetch events" }, { status: 500 });
  }
}
