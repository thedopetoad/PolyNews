import { NextRequest, NextResponse } from "next/server";
import { sql, lt } from "drizzle-orm";
import { getDb, marketsCatalog } from "@/db";

// GET /api/cron/catalog-refresh
//
// Pulls the active Polymarket catalog from Gamma's keyset endpoint and
// upserts every market into markets_catalog. Rows not touched during
// this sync are deleted at the end, which handles closed/delisted
// markets naturally.
//
// Migrated from offset-based /events to cursor-based /events/keyset
// on 2026-04-23 (old endpoint deprecated 2026-05-01). Cursor pagination
// is inherently sequential so we can't parallelize; capped at MAX_PAGES
// so the whole sync fits comfortably inside the Vercel 60s limit.
//
// Gated by CRON_SECRET. Also runnable manually with
//   curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/cron/catalog-refresh

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GAMMA_API = "https://gamma-api.polymarket.com";
const PAGE_SIZE = 100;
// 50 pages × 100 = 5000 most-liquid markets. Matches the prior offset-
// based cap (MAX_OFFSET = 5000). Cron runs every 6h so we re-cover the
// same slice continuously.
const MAX_PAGES = 50;
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

interface KeysetResponse {
  events?: GammaEvent[];
  next_cursor?: string | null;
}

async function fetchPage(cursor: string | null): Promise<KeysetResponse> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(PAGE_SIZE),
    order: "volume",
    ascending: "false",
  });
  if (cursor) params.set("cursor", cursor);
  try {
    const res = await fetch(`${GAMMA_API}/events/keyset?${params.toString()}`);
    if (!res.ok) return { events: [], next_cursor: null };
    return (await res.json()) as KeysetResponse;
  } catch {
    return { events: [], next_cursor: null };
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

  const allRows: CatalogRow[] = [];
  const seen = new Set<string>();

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(cursor);
    const events = data.events ?? [];
    if (events.length === 0) break;

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

    const next = data.next_cursor ?? null;
    if (!next || next === cursor) break; // reached the end
    cursor = next;
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
