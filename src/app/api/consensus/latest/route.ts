import { NextResponse } from "next/server";
import { eq, desc, and, gte, isNotNull } from "drizzle-orm";
import { getDb, consensusRuns } from "@/db";

// GET /api/consensus/latest
//
// Returns the most recent step3_done run for each distinct market
// (deduped by market_question_hash). Capped at 10 markets, newest run
// date first then by market end date soonest. Lightweight summary view —
// no persona bullets here, those load on demand via /api/consensus/run/[id].
//
// Used by /ai page on every render. Aggressive client cache (60s) is fine
// because runs only change once a day.

export const dynamic = "force-dynamic";

interface RunSummary {
  id: string;
  marketQuestion: string;
  marketSlug: string | null;
  eventSlug: string | null;
  clobTokenIds: string | null;
  marketEndDate: string | null;
  runDate: string;
  yesPriceAtRun: number;
  finalMean: number;
  finalMode: number;
  distributionP5: number;
  distributionP95: number;
  distributionHistogram: number[];
  step3At: string;
}

const LOOKBACK_DAYS = 7;

export async function GET() {
  try {
    const db = getDb();

    // Pull every step3_done run from the last week. We dedupe to the
    // newest per market_question_hash in JS — Drizzle's grouping support
    // for "max by partition" via SQL is awkward enough that this is
    // simpler and the row count is tiny.
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(consensusRuns)
      .where(
        and(
          eq(consensusRuns.status, "step3_done"),
          isNotNull(consensusRuns.finalMean),
          gte(consensusRuns.createdAt, cutoff),
        ),
      )
      .orderBy(desc(consensusRuns.runDate), desc(consensusRuns.step3At));

    const seen = new Set<string>();
    const unique: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.marketQuestionHash)) continue;
      seen.add(r.marketQuestionHash);
      unique.push(r);
      if (unique.length >= 10) break;
    }

    const runs: RunSummary[] = unique.map((r) => ({
      id: r.id,
      marketQuestion: r.marketQuestion,
      marketSlug: r.marketSlug,
      eventSlug: r.eventSlug,
      clobTokenIds: r.clobTokenIds,
      marketEndDate: r.marketEndDate,
      runDate: r.runDate,
      yesPriceAtRun: r.yesPriceAtRun,
      finalMean: r.finalMean ?? 0,
      finalMode: r.finalMode ?? 0,
      distributionP5: r.distributionP5 ?? 0,
      distributionP95: r.distributionP95 ?? 0,
      distributionHistogram: safeParse(r.distributionHistogram),
      step3At: r.step3At?.toISOString() ?? r.createdAt.toISOString(),
    }));

    return NextResponse.json({ runs });
  } catch (err) {
    console.error("[consensus/latest] error:", err);
    return NextResponse.json(
      { error: "Failed to load latest runs", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

function safeParse(s: string | null): number[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(Number) : [];
  } catch {
    return [];
  }
}
