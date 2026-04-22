import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb, consensusCache, marketsCatalog } from "@/db";

// GET /api/markets/live
//
// Powers the scrolling "Live Markets" chyron at the bottom of the news
// page. No GPT, no Gamma, no CLOB — this is pure projection over the
// already-matched links that /api/news/markets produced for the
// "Click to See Markets" buttons. Whatever markets got surfaced there,
// roll them up here.
//
// Pipeline:
//   1. Read the news-mkt-v16 cache row from consensus_cache.
//   2. Flatten + dedupe by slug (multiple headlines often match the
//      same market).
//   3. Join against markets_catalog for up-to-date volume/lastTradePrice
//      and to drop any markets that have since closed.
//   4. Sort by volume desc so the chyron leads with the most liquid
//      markets.

const NEWS_CACHE_KEY = "news-mkt-v16";

interface CachedLink {
  headlineHash: string;
  headlineTitle: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

interface CachedData {
  links: CachedLink[];
  processedHashes: string[];
  updatedAt: string;
}

export async function GET() {
  try {
    const db = getDb();

    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, NEWS_CACHE_KEY))
      .limit(1);

    if (!cached) {
      return NextResponse.json({ markets: [], source: "empty-cache" });
    }

    let data: CachedData;
    try {
      data = JSON.parse(cached.result);
    } catch {
      return NextResponse.json({ markets: [], source: "parse-error" });
    }

    const bySlug = new Map<string, CachedLink>();
    for (const l of data.links || []) {
      if (!l.slug || bySlug.has(l.slug)) continue;
      bySlug.set(l.slug, l);
    }
    const slugs = [...bySlug.keys()];
    if (slugs.length === 0) {
      return NextResponse.json({ markets: [], source: "no-links" });
    }

    const catalogRows = await db
      .select({
        slug: marketsCatalog.slug,
        eventSlug: marketsCatalog.eventSlug,
        volume: marketsCatalog.volume,
        endDate: marketsCatalog.endDate,
        lastTradePrice: marketsCatalog.lastTradePrice,
      })
      .from(marketsCatalog)
      .where(inArray(marketsCatalog.slug, slugs));

    const catalogBySlug = new Map(catalogRows.map((r) => [r.slug, r]));

    const markets = [...bySlug.values()]
      // Drop markets that have been removed from the catalog (closed / delisted).
      .filter((l) => catalogBySlug.has(l.slug))
      .map((l) => {
        const info = catalogBySlug.get(l.slug)!;
        const yesPrice =
          typeof info.lastTradePrice === "number" ? info.lastTradePrice : l.yesPrice ?? 0.5;
        return {
          id: l.slug,
          question: l.question,
          slug: l.slug,
          eventSlug: info.eventSlug || l.eventSlug,
          volume: info.volume || "0",
          endDate: info.endDate || "",
          yesPrice,
          noPrice: 1 - yesPrice,
        };
      })
      .sort((a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"));

    return NextResponse.json({
      markets,
      source: "news-mkt",
      updatedAt: data.updatedAt,
    });
  } catch (err) {
    console.error("Live markets error:", err);
    return NextResponse.json(
      { markets: [], error: "Failed to fetch live markets" },
      { status: 500 },
    );
  }
}
