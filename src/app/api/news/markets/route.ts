import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { consensusCache, getDb } from "@/db";
import {
  processNewsMarkets,
  NEWS_MARKETS_CACHE_KEY,
  type CachedNewsMarkets,
} from "@/lib/news-markets";

// POST /api/news/markets
// Reads current headlines, returns per-headline market matches. Delegates
// to the shared `processNewsMarkets` pipeline so the user-triggered path
// and the pre-warm cron share identical logic + cache row.
//
// GET /api/news/markets
// Returns whatever's currently in the cache, without triggering any
// processing. Used nowhere in the UI today but harmless as a debug probe.

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = Array.isArray(body.headlines) ? body.headlines : [];
    // `force: true` is used by the "Find Related Markets" button on
    // headlines that previously matched zero markets. It bypasses the
    // processed-hash cache so the pipeline reruns from scratch.
    // Hard-capped to 3 headlines per force request to prevent abusive
    // clients from triggering GPT calls on the full feed.
    const force = body.force === true;
    const capped = force ? headlines.slice(0, 3) : headlines;
    const result = await processNewsMarkets(capped, force);
    return NextResponse.json({
      links: result.links,
      remaining: result.remaining,
      processedNew: result.processedNew,
    });
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [], remaining: 0 });
  }
}

export async function GET() {
  try {
    const db = getDb();
    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, NEWS_MARKETS_CACHE_KEY))
      .limit(1);
    if (cached) {
      const data: CachedNewsMarkets = JSON.parse(cached.result);
      return NextResponse.json({ links: data.links, remaining: 0 });
    }
    return NextResponse.json({ links: [], remaining: 0 });
  } catch {
    return NextResponse.json({ links: [], remaining: 0 });
  }
}
