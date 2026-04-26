import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  selectCandidateMarkets,
  ensureRunRow,
  executeStep1,
  executeStep2,
  executeStep3,
  todayUtc,
  type CandidateMarket,
} from "@/lib/consensus/pipeline";

// POST /api/admin/consensus-run-now
//
// Admin-triggered manual run of the full consensus pipeline. Picks the
// top 10 markets right now, REPLACES any existing run rows for today
// (CASCADE drops the child predictions), and walks all 3 steps inline so
// the admin sees results in one request.
//
// Wall time on a fresh run is ~30s (web search dominates step 1). All
// three steps share the 60s budget. If we hit it in practice we'll need
// to split into a fire-and-forget step 1 + polling, but for now the
// simple inline path is fine.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t0 = Date.now();
  const runDate = todayUtc();

  let candidates: CandidateMarket[];
  try {
    candidates = await selectCandidateMarkets();
  } catch (err) {
    return NextResponse.json(
      { error: "Market selection failed", detail: (err as Error).message },
      { status: 502 },
    );
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: "No qualifying markets" }, { status: 502 });
  }

  // Step 1 — replace=true wipes any existing today rows and their predictions
  const ensured = await Promise.all(
    candidates.map((m) =>
      ensureRunRow(m, runDate, "admin", true).then((r) => ({ market: m, ...r })),
    ),
  );

  const step1Results = await Promise.all(
    ensured.map(async (e) => {
      try {
        return { runId: e.runId, market: e.market, ...(await executeStep1(e.runId, e.market)) };
      } catch (err) {
        console.error(
          `[consensus-run-now] step1 threw for ${e.runId}:`,
          (err as Error).message,
        );
        return { runId: e.runId, market: e.market, ok: false, succeeded: 0, failed: 20 };
      }
    }),
  );

  const step1Survivors = step1Results.filter((r) => r.ok);
  const step1Failed = step1Results.filter((r) => !r.ok);

  // Step 2 — only on runs that survived step 1
  const step2Results = await Promise.all(
    step1Survivors.map(async (r) => {
      try {
        return {
          runId: r.runId,
          question: r.market.question,
          ...(await executeStep2(r.runId, r.market)),
        };
      } catch (err) {
        console.error(
          `[consensus-run-now] step2 threw for ${r.runId}:`,
          (err as Error).message,
        );
        return { runId: r.runId, question: r.market.question, ok: false, succeeded: 0, failed: 20 };
      }
    }),
  );

  // Step 3 — bootstrap math on every run that has any predictions
  const step3Results = await Promise.all(
    step1Survivors.map(async (r) => {
      try {
        return {
          runId: r.runId,
          question: r.market.question,
          ...(await executeStep3(r.runId)),
        };
      } catch (err) {
        console.error(
          `[consensus-run-now] step3 threw for ${r.runId}:`,
          (err as Error).message,
        );
        return { runId: r.runId, question: r.market.question, ok: false, mean: 0, mode: 0, sampleSize: 0 };
      }
    }),
  );

  return NextResponse.json({
    runDate,
    triggeredBy: admin.pubkey,
    candidates: candidates.length,
    step1: {
      ok: step1Survivors.length,
      failed: step1Failed.length,
      results: step1Results,
    },
    step2: { results: step2Results },
    step3: { results: step3Results },
    durationMs: Date.now() - t0,
  });
}
