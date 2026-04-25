import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, consensusRuns } from "@/db";
import { executeStep2, todayUtc, type CandidateMarket } from "@/lib/consensus/pipeline";

// GET /api/cron/consensus-step2
//
// Daily 06:15 UTC follow-up. Finds runs that finished step 1 today and
// asks the same 20 personas (minus any that failed step 1) to re-assess
// after seeing the round-1 dataset. No new web search.
//
// 60s budget: 10 markets × 20 personas = 200 parallel chat completions
// (no web search this time). Wall time typically <10s.

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
  const runDate = todayUtc();
  const db = getDb();

  const ready = await db
    .select()
    .from(consensusRuns)
    .where(eq(consensusRuns.status, "step1_done"));

  // Only process runs from today's batch — if yesterday's run somehow
  // never made it to step 2, leave it alone (avoids burning budget on
  // stale snapshots).
  const todays = ready.filter((r) => r.runDate === runDate);

  const results = await Promise.all(
    todays.map(async (run) => {
      const market: CandidateMarket = {
        question: run.marketQuestion,
        yesPrice: run.yesPriceAtRun,
        slug: run.marketSlug,
        eventSlug: run.eventSlug,
        clobTokenIds: run.clobTokenIds,
        endDate: run.marketEndDate,
      };
      try {
        const r = await executeStep2(run.id, market);
        return { runId: run.id, question: run.marketQuestion, ...r };
      } catch (err) {
        console.error(
          `[consensus-step2] executeStep2 threw for ${run.id}:`,
          (err as Error).message,
        );
        return {
          runId: run.id,
          question: run.marketQuestion,
          ok: false,
          succeeded: 0,
          failed: 20,
        };
      }
    }),
  );

  return NextResponse.json({
    runDate,
    eligible: todays.length,
    skippedOld: ready.length - todays.length,
    results,
    durationMs: Date.now() - t0,
  });
}
