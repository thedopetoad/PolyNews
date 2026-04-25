import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import {
  getDb,
  consensusRuns,
  consensusPersonaPredictions,
} from "@/db";
import { PERSONA_BY_ID } from "@/lib/consensus/personas";

// GET /api/consensus/run/[id]
//
// Drill-down endpoint for one consensus run. Returns the run row + every
// persona prediction (round 1 + round 2) with its bullets so the /ai page
// can show the per-persona breakdown when the user expands a market card.

export const dynamic = "force-dynamic";

interface PredictionView {
  persona: string;
  personaName: string;
  shortLabel: string;
  round: number;
  probability: number;
  bullets: string[];
  webContext?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const db = getDb();

    const runRows = await db
      .select()
      .from(consensusRuns)
      .where(eq(consensusRuns.id, id))
      .limit(1);
    if (runRows.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const run = runRows[0];

    const predictions = await db
      .select()
      .from(consensusPersonaPredictions)
      .where(eq(consensusPersonaPredictions.runId, id))
      .orderBy(asc(consensusPersonaPredictions.round), asc(consensusPersonaPredictions.persona));

    const view: PredictionView[] = predictions.map((p) => {
      const meta = PERSONA_BY_ID[p.persona];
      return {
        persona: p.persona,
        personaName: meta?.name ?? p.persona,
        shortLabel: meta?.shortLabel ?? p.persona,
        round: p.round,
        probability: p.probability,
        bullets: safeParseArr(p.bulletPoints),
        webContext: p.webContext ?? undefined,
      };
    });

    return NextResponse.json({
      run: {
        id: run.id,
        marketQuestion: run.marketQuestion,
        marketSlug: run.marketSlug,
        eventSlug: run.eventSlug,
        clobTokenIds: run.clobTokenIds,
        marketEndDate: run.marketEndDate,
        runDate: run.runDate,
        yesPriceAtRun: run.yesPriceAtRun,
        status: run.status,
        finalMean: run.finalMean,
        finalMode: run.finalMode,
        distributionP5: run.distributionP5,
        distributionP95: run.distributionP95,
        distributionHistogram: safeParseArr(run.distributionHistogram),
        triggerSource: run.triggerSource,
        step3At: run.step3At,
      },
      predictions: view,
    });
  } catch (err) {
    console.error("[consensus/run/:id] error:", err);
    return NextResponse.json(
      { error: "Failed to load run", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

function safeParseArr<T = string>(s: string | null): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
