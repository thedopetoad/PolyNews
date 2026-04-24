import { NextRequest, NextResponse } from "next/server";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports";

// Map sport codes to series IDs. Keep in sync with /api/sports/leagues.
const SERIES_MAP: Record<string, string> = {
  // Basketball
  nba: "10345", ncaab: "39", fibaam: "11472", fibaeu: "11474",
  // Soccer
  epl: "10188", lal: "10193", bun: "10194", ucl: "10204", mls: "10189",
  bun2: "10670", efl: "10355", ere: "10286", coplib: "10289", argpd: "10285",
  brsa: "10359", rpl: "10313", fifafri: "10238", ccc: "11464",
  wsawq: "11437", fifawc: "11448",
  // Baseball
  mlb: "3", kbo: "10370",
  // Football / Hockey / Tennis
  nfl: "10187", nhl: "10346", olyhk: "11136",
  atp: "10365", wta: "10366",
  // Cricket
  ipl: "44", mlc: "11221", intcri: "10528",
  "cri-in": "10748", "cri-pk": "10751", "cri-sa": "10753",
  cpl: "11216", wpl: "10908",
  // MMA / Golf / Rugby / Chess
  ufc: "10500", pga: "10976", "rugby-t14": "10841", chess: "11480",
  // Esports
  cs: "10310", lol: "10311", dota: "10309", val: "10369", easfifa: "10428",
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
  /** True when Polymarket's own `live` flag is set on the event OR ESPN has
   *  the game in progress. Polymarket's flag is the authoritative source —
   *  it's the same signal their own Sports Live page uses. ESPN is kept
   *  as a fallback for the occasional niche match Polymarket hasn't synced. */
  isLive?: boolean;
  /** Live game state passthroughs from the Polymarket Gamma API. */
  score?: string;
  period?: string;
  elapsed?: string;
  ended?: boolean;
  // Pass through Polymarket's own state flags so the client can drop any
  // event that flipped after our 15s ISR cache was warmed.
  closed?: boolean;
  archived?: boolean;
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

    // Fetch events for this league. 15s cache keeps upstream load sane
    // (~4 req/min/sport regardless of traffic) while staying fresh enough
    // for real-money bet slips to reflect market state changes promptly.
    //
    // Migrated to /events/keyset on 2026-04-23 (legacy /events deprecated
    // 2026-05-01). We only need page 1 since limit=20 covers the whole
    // visible slate for a given league.
    const res = await fetch(
      `${GAMMA_API}/events/keyset?active=true&closed=false&limit=20&series_id=${seriesId}&order=startDate&ascending=true`,
      { next: { revalidate: 10 } }
    );

    if (!res.ok) {
      return NextResponse.json({ events: [] });
    }

    const body = await res.json();
    // Keyset wraps the array in `{ events: [...], next_cursor }`; fall
    // back to a raw array for forward-compat if Gamma ever ships a
    // different shape. Keep the value untyped (pre-migration behavior
    // inherited from `.json()`) so the existing downstream field
    // accesses on market/event keep compiling — Gamma's payload keys
    // are stable across endpoints and we only read a handful of them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawEvents: any[] = Array.isArray(body) ? body : (body?.events ?? []);

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
        // Polymarket-provided live state. `live` is their authoritative
        // in-progress flag (same signal their own Sports Live page uses).
        isLive: event.live === true,
        ended: event.ended === true,
        score: typeof event.score === "string" ? event.score : undefined,
        period: typeof event.period === "string" ? event.period : undefined,
        elapsed: typeof event.elapsed === "string" ? event.elapsed : undefined,
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

    // ESPN fallback — covers the rare event Polymarket's `live` flag hasn't
    // flipped yet. Only upgrades isLive to true, never downgrades.
    const liveGames = await getESPNLiveGames(sport);
    if (liveGames.length > 0) {
      for (const event of events) {
        const parts = event.title.split(/\s+vs\.?\s+/i);
        if (parts.length < 2) continue;
        const teamA = parts[0].trim().toLowerCase();
        const teamB = parts[1].trim().toLowerCase();

        event.espnLive = liveGames.some((game) => {
          const matchA = game.teams.some((t) => t.includes(teamA) || teamA.includes(t));
          const matchB = game.teams.some((t) => t.includes(teamB) || teamB.includes(t));
          return matchA && matchB;
        });

        if (event.espnLive === true && !event.isLive) {
          event.isLive = true;
        }
      }
    }

    // Belt-and-suspenders: never surface a closed/archived/ended event as
    // live even if the live flag was set from cache that's now stale.
    for (const event of events) {
      if (event.closed || event.archived || event.ended) {
        event.isLive = false;
      }
    }

    return NextResponse.json({ events, sport });
  } catch (err) {
    console.error("Sports events error:", err);
    return NextResponse.json({ events: [], error: "Failed to fetch events" }, { status: 500 });
  }
}
