import { NextRequest, NextResponse } from "next/server";
import { processNewsMarkets } from "@/lib/news-markets";

// GET /api/cron/news-markets-warm
//
// Pre-warms the "Click to See Markets" cache so first-page-load users
// never have to wait for GPT to run. Fires every 10 minutes via Vercel
// Cron. Fetches the current RSS headlines from `/api/news`, runs them
// through `processNewsMarkets()` — already-processed headlines are a
// no-op (cache hit), only new rotations do work.
//
// Gated by CRON_SECRET. Also runnable manually with
//   curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/cron/news-markets-warm

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

  const t0 = Date.now();

  // Resolve the public base URL. Vercel exposes the deployment host via
  // VERCEL_URL (no scheme); in dev we fall back to localhost.
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  let headlines: string[] = [];
  try {
    const res = await fetch(`${baseUrl}/api/news`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch /api/news (${res.status})` },
        { status: 502 },
      );
    }
    const data = await res.json();
    headlines = ((data.headlines || []) as { title?: string }[])
      .map((h) => (typeof h.title === "string" ? h.title : ""))
      .filter((t): t is string => t.length > 0)
      .slice(0, 15);
  } catch (err) {
    return NextResponse.json(
      { error: "Headlines fetch failed", detail: (err as Error).message },
      { status: 502 },
    );
  }

  if (headlines.length === 0) {
    return NextResponse.json({ ok: true, headlineCount: 0, processedNew: 0, linkCount: 0 });
  }

  try {
    const result = await processNewsMarkets(headlines);
    return NextResponse.json({
      ok: true,
      headlineCount: headlines.length,
      processedNew: result.processedNew,
      linkCount: result.links.length,
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    console.error("[news-markets-warm] processing failed:", err);
    return NextResponse.json(
      { error: "Processing failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
