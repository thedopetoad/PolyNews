import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getDb,
  consensusRuns,
} from "@/db";
import {
  selectCandidateMarkets,
  ensureRunRow,
  executeStep1,
  executeStep2,
  executeStep3,
  pruneOldRuns,
  todayUtc,
  type CandidateMarket,
} from "@/lib/consensus/pipeline";

/**
 * Map a thrown error into a UI-friendly code so the admin component can
 * show specific remediation instead of a raw stack trace.
 *
 *   schema_missing  - consensus_runs / consensus_persona_predictions
 *                     don't exist yet. Run `npx drizzle-kit push`.
 *   openai_missing  - OPENAI_API_KEY env var unset on Vercel.
 *   openai_quota    - OpenAI returned 429 / quota exceeded.
 *   db_unreachable  - Neon connection failed (DNS / network / bad URL).
 *   unknown         - anything else; show raw message.
 */
type ErrorCode =
  | "schema_missing"
  | "openai_missing"
  | "openai_quota"
  | "db_unreachable"
  | "unknown";

function classifyError(err: unknown): ErrorCode {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("relation") && msg.includes("does not exist")) return "schema_missing";
  if (msg.includes("consensus_runs") || msg.includes("consensus_persona_predictions")) return "schema_missing";
  if (msg.includes("missing credentials") || msg.includes("openai_api_key")) return "openai_missing";
  if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("429")) return "openai_quota";
  if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("error connecting to database")) return "db_unreachable";
  return "unknown";
}

/**
 * Cheap upfront probe: try to read 0 rows from consensus_runs. If the
 * table doesn't exist, we get a "relation does not exist" error and can
 * return a clean schema_missing response without spinning up 200 OpenAI
 * calls that all fail at the insert step.
 */
async function checkSchema(): Promise<{ ok: true } | { ok: false; code: ErrorCode; detail: string }> {
  try {
    const db = getDb();
    await db.select({ id: consensusRuns.id }).from(consensusRuns).limit(1);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: classifyError(err),
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

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

  // Cheap probe before we burn $5 in OpenAI calls — make sure the
  // tables actually exist and the DB is reachable.
  const schemaCheck = await checkSchema();
  if (!schemaCheck.ok) {
    return NextResponse.json(
      { error: schemaCheck.code, detail: schemaCheck.detail },
      { status: schemaCheck.code === "schema_missing" ? 412 : 503 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "openai_missing", detail: "OPENAI_API_KEY env var is not set in this environment" },
      { status: 412 },
    );
  }

  let candidates: CandidateMarket[];
  try {
    candidates = await selectCandidateMarkets();
  } catch (err) {
    return NextResponse.json(
      { error: classifyError(err), detail: (err as Error).message },
      { status: 502 },
    );
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: "no_markets", detail: "Polymarket returned 0 qualifying markets right now" }, { status: 502 });
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

  // Sweep older snapshots so the DB doesn't accumulate. Done AFTER step 3
  // succeeds so /ai never goes blank — old data sticks around until the
  // fresh snapshot is fully baked, then it's wiped.
  const anySucceeded = step3Results.some((r) => r.ok);
  const prune = anySucceeded ? await pruneOldRuns(runDate) : { deleted: 0 };

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
    pruned: prune.deleted,
    durationMs: Date.now() - t0,
  });
}
