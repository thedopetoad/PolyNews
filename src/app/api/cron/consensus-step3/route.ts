import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, consensusRuns } from "@/db";
import { executeStep3, todayUtc } from "@/lib/consensus/pipeline";

// GET /api/cron/consensus-step3
//
// Daily 06:30 UTC closer. Finds runs that finished step 2 today and runs
// the bootstrap math (10K resamples of the 40 persona predictions) to
// produce mean / mode / 90% CI / 40-bin histogram. Pure local math, no
// AI calls — runs in <100ms per market.

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
    .where(eq(consensusRuns.status, "step2_done"));

  const todays = ready.filter((r) => r.runDate === runDate);

  const results = await Promise.all(
    todays.map(async (run) => {
      try {
        const r = await executeStep3(run.id);
        return { runId: run.id, question: run.marketQuestion, ...r };
      } catch (err) {
        console.error(
          `[consensus-step3] executeStep3 threw for ${run.id}:`,
          (err as Error).message,
        );
        return {
          runId: run.id,
          question: run.marketQuestion,
          ok: false,
          mean: 0,
          mode: 0,
          sampleSize: 0,
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
