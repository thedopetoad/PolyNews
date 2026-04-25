import { NextRequest, NextResponse } from "next/server";
import {
  selectCandidateMarkets,
  ensureRunRow,
  executeStep1,
  todayUtc,
  type CandidateMarket,
} from "@/lib/consensus/pipeline";

// GET /api/cron/consensus-step1
//
// Daily 06:00 UTC kickoff. Picks today's top 10 markets (same filter the
// /ai page used to apply client-side), creates a consensus_runs row for
// each in step1_pending, then runs the 20-persona web search + initial
// vote in parallel for all 10 markets.
//
// 60s budget: 10 markets × 20 personas = 200 parallel OpenAI calls. Each
// call is capped at 25s (see pipeline.ts), so worst-case wall time is
// ~25s. Comfortable margin under the 60s Vercel limit.
//
// Idempotent on re-run within the same day: existing rows are left alone,
// only newly-discovered markets get fresh runs. Use the admin "Run Now"
// button for force-replace.

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

  let candidates: CandidateMarket[];
  try {
    candidates = await selectCandidateMarkets();
  } catch (err) {
    console.error("[consensus-step1] market selection failed:", err);
    return NextResponse.json(
      { error: "Market selection failed", detail: (err as Error).message },
      { status: 502 },
    );
  }

  if (candidates.length === 0) {
    return NextResponse.json({ error: "No qualifying markets" }, { status: 502 });
  }

  // Create rows (idempotent — only fresh markets get a new row)
  const ensured = await Promise.all(
    candidates.map((m) =>
      ensureRunRow(m, runDate, "cron", false).then((r) => ({ market: m, ...r })),
    ),
  );

  // Only execute step 1 for runs we just created. If a row already exists
  // it's because a prior cron tick handled it (or is in-flight) — leave it.
  const toRun = ensured.filter((e) => e.created);

  const results = await Promise.all(
    toRun.map(async (e) => {
      try {
        const r = await executeStep1(e.runId, e.market);
        return { runId: e.runId, question: e.market.question, ...r };
      } catch (err) {
        console.error(
          `[consensus-step1] executeStep1 threw for ${e.runId}:`,
          (err as Error).message,
        );
        return {
          runId: e.runId,
          question: e.market.question,
          ok: false,
          succeeded: 0,
          failed: 20,
        };
      }
    }),
  );

  return NextResponse.json({
    runDate,
    candidates: candidates.length,
    newRuns: toRun.length,
    skippedExisting: ensured.length - toRun.length,
    results,
    durationMs: Date.now() - t0,
  });
}
