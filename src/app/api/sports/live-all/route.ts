import { NextResponse } from "next/server";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

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

interface SeriesInfo {
  id: string;
  slug: string;
  title: string;
}

interface LiveEvent {
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
  closed?: boolean;
  archived?: boolean;
  ended?: boolean;
  isLive: true;
  score?: string;
  period?: string;
  elapsed?: string;
  series?: SeriesInfo;
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

/**
 * Returns every event Polymarket currently flags as live, across every
 * sport and esport series — no per-league fan-out needed.
 *
 * Uses Gamma's `live=true` query filter (the same signal that drives
 * polymarket.com's "Sports Live" page), so our coverage matches theirs:
 * UCL, WTA, ATP, Counter-Strike, League of Legends, NBA, MLB, etc.
 *
 * Migrated from `/events?live=true...&limit=200` (deprecated 2026-05-01)
 * to `/events/keyset` on 2026-04-27. Keyset is cursor-paginated with a
 * 100-row max page size, so we walk up to 3 pages (300 events) to keep
 * the same coverage.
 */
const MAX_KEYSET_PAGES = 3;
const KEYSET_PAGE_SIZE = 100;

export async function GET() {
  try {
    interface KeysetResponse { events?: unknown[]; next_cursor?: string | null }
    const rawEvents: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let cursor: string | null = null;
    for (let page = 0; page < MAX_KEYSET_PAGES; page++) {
      const params = new URLSearchParams({
        live: "true",
        closed: "false",
        limit: String(KEYSET_PAGE_SIZE),
      });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(
        `${GAMMA_API}/events/keyset?${params.toString()}`,
        { next: { revalidate: 15 } },
      );
      if (!res.ok) break;
      const body = (await res.json()) as KeysetResponse;
      if (Array.isArray(body.events)) rawEvents.push(...body.events);
      cursor = body.next_cursor ?? null;
      if (!cursor) break;
    }
    if (rawEvents.length === 0) return NextResponse.json({ events: [] });

    const events: LiveEvent[] = [];

    for (const event of rawEvents) {
      // Belt-and-suspenders — Gamma's live filter sometimes lags by a few
      // seconds and includes events that just ended.
      if (event.closed || event.archived || event.ended) continue;

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

      const firstMarket = (event.markets || [])[0];
      const gameTime =
        firstMarket?.gameStartTime ||
        event.startTime ||
        event.creationDate ||
        event.startDate ||
        "";

      const seriesRaw = (event.series || [])[0];
      const series: SeriesInfo | undefined = seriesRaw
        ? {
            id: String(seriesRaw.id || ""),
            slug: seriesRaw.slug || "",
            title: seriesRaw.title || "",
          }
        : undefined;

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
        ended: event.ended === true,
        isLive: true,
        score: typeof event.score === "string" ? event.score : undefined,
        period: typeof event.period === "string" ? event.period : undefined,
        elapsed: typeof event.elapsed === "string" ? event.elapsed : undefined,
        series,
      });
    }

    // Enrich top events with CLOB prices — mirrors what the per-league
    // events route does so the bet slip reflects the order book.
    const enrichPromises = events.slice(0, 20).map(async (event) => {
      for (const market of event.markets) {
        if (market.clobTokenIds[0]) {
          const mid = await getClobPrice(market.clobTokenIds[0]);
          if (mid !== null && mid > 0 && mid < 1) {
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

    return NextResponse.json({ events });
  } catch (err) {
    console.error("Sports live-all fetch error:", err);
    return NextResponse.json({ events: [], error: "Failed to fetch live events" }, { status: 500 });
  }
}
