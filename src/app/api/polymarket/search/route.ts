import { NextRequest, NextResponse } from "next/server";
import { ilike, sql } from "drizzle-orm";
import { getDb, marketsCatalog } from "@/db";

// GET /api/polymarket/search?q=<query>
//
// ILIKE search across the full live Polymarket catalog (~5000 active
// markets, refreshed every 6h by /api/cron/catalog-refresh). Returns
// up to 50 results sorted by volume desc.
//
// Empty query returns the top 50 markets by volume so the parlay
// search panel always has something to show on first paint.
//
// Response shape mirrors the MarketWithPrices subset the parlay page
// consumes: id, question, slug, eventSlug, clobTokenIds, endDate,
// volume, yesPrice, noPrice. We use the catalog row's slug as the id
// (stable, unique, available) since markets_catalog doesn't store the
// numeric Polymarket market id.

export const dynamic = "force-dynamic";
const MAX_RESULTS = 50;

interface SearchHit {
  id: string;
  question: string;
  slug: string;
  eventSlug: string;
  clobTokenIds: string;
  endDate: string;
  volume: string;
  yesPrice: number;
  noPrice: number;
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();

  try {
    const db = getDb();
    // Cast volume (stored as text) to numeric for proper sort. Coalesce
    // to 0 so empty/null values land at the bottom instead of failing
    // the cast.
    const orderClause = sql`COALESCE(NULLIF(${marketsCatalog.volume}, ''), '0')::float DESC`;

    const rows = q
      ? await db
          .select()
          .from(marketsCatalog)
          .where(ilike(marketsCatalog.question, `%${q}%`))
          .orderBy(orderClause)
          .limit(MAX_RESULTS)
      : await db
          .select()
          .from(marketsCatalog)
          .orderBy(orderClause)
          .limit(MAX_RESULTS);

    const hits: SearchHit[] = rows.map((r) => {
      const yes = typeof r.lastTradePrice === "number" && r.lastTradePrice > 0 && r.lastTradePrice < 1
        ? r.lastTradePrice
        : 0.5;
      return {
        id: r.slug,
        question: r.question,
        slug: r.slug,
        eventSlug: r.eventSlug,
        clobTokenIds: r.clobTokenIds || "[]",
        endDate: r.endDate || "",
        volume: r.volume || "0",
        yesPrice: yes,
        noPrice: 1 - yes,
      };
    });

    return NextResponse.json({ q, count: hits.length, hits });
  } catch (err) {
    console.error("[polymarket/search] error:", err);
    return NextResponse.json(
      { error: "Search failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
