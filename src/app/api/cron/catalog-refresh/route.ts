import { NextRequest, NextResponse } from "next/server";
import { sql, lt } from "drizzle-orm";
import { getDb, marketsCatalog } from "@/db";

// GET /api/cron/catalog-refresh
//
// Pulls the full active Polymarket catalog from Gamma and upserts every
// market into markets_catalog. Rows not touched during this sync are
// deleted at the end, which handles closed/delisted markets naturally.
//
// Gated by CRON_SECRET. Also runnable manually with
//   curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/cron/catalog-refresh
// to bootstrap a fresh deploy.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GAMMA_API = "https://gamma-api.polymarket.com";
const PAGE_SIZE = 100;
const MAX_OFFSET = 5000; // up to 50 pages = ~5k markets, well above typical active count
const CONCURRENCY = 10;
const UPSERT_CHUNK = 100;

interface CatalogRow {
  slug: string;
  eventSlug: string;
  question: string;
  volume: string;
  endDate: string;
  clobTokenIds: string;
  lastTradePrice: number;
}

interface GammaMarket {
  slug?: string;
  question?: string;
  volume?: string;
  endDate?: string;
  clobTokenIds?: string;
  lastTradePrice?: number;
  closed?: boolean;
  active?: boolean;
}

interface GammaEvent {
  slug?: string;
  markets?: GammaMarket[];
}

async function fetchPage(offset: number): Promise<GammaEvent[]> {
  const url = `${GAMMA_API}/events?active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}&order=volume&ascending=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Cron not configured. Set CRON_SECRET in Vercel env to enable." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const t0 = Date.now();

  const offsets: number[] = [];
  for (let o = 0; o <= MAX_OFFSET; o += PAGE_SIZE) offsets.push(o);

  const allRows: CatalogRow[] = [];
  const seen = new Set<string>();
  let reachedEnd = false;

  for (let i = 0; i < offsets.length && !reachedEnd; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY);
    const pages = await Promise.all(batch.map(fetchPage));
    let batchHadRows = false;

    for (const events of pages) {
      if (!events || events.length === 0) continue;
      batchHadRows = true;
      for (const event of events) {
        if (!event?.slug) continue;
        for (const m of event.markets || []) {
          if (!m.slug || m.closed === true || m.active === false) continue;
          if (seen.has(m.slug)) continue;
          seen.add(m.slug);
          allRows.push({
            slug: m.slug,
            eventSlug: event.slug,
            question: m.question || "",
            volume: m.volume || "0",
            endDate: m.endDate || "",
            clobTokenIds: m.clobTokenIds || "[]",
            lastTradePrice: typeof m.lastTradePrice === "number" ? m.lastTradePrice : 0.5,
          });
        }
      }
    }

    if (!batchHadRows) reachedEnd = true;
  }

  if (allRows.length === 0) {
    return NextResponse.json({ error: "Gamma returned no markets", upserted: 0 }, { status: 502 });
  }

  const db = getDb();
  let upserted = 0;
  for (let i = 0; i < allRows.length; i += UPSERT_CHUNK) {
    const chunk = allRows.slice(i, i + UPSERT_CHUNK).map((r) => ({ ...r, updatedAt: startedAt }));
    await db
      .insert(marketsCatalog)
      .values(chunk)
      .onConflictDoUpdate({
        target: marketsCatalog.slug,
        set: {
          eventSlug: sql`excluded.event_slug`,
          question: sql`excluded.question`,
          volume: sql`excluded.volume`,
          endDate: sql`excluded.end_date`,
          clobTokenIds: sql`excluded.clob_token_ids`,
          lastTradePrice: sql`excluded.last_trade_price`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    upserted += chunk.length;
  }

  // Drop rows the sync didn't touch — markets that have closed or been delisted.
  const deleted = await db
    .delete(marketsCatalog)
    .where(lt(marketsCatalog.updatedAt, startedAt))
    .returning({ slug: marketsCatalog.slug });

  return NextResponse.json({
    upserted,
    deleted: deleted.length,
    durationMs: Date.now() - t0,
  });
}
