import { NextRequest, NextResponse } from "next/server";
import { getDb, swarmPredictions, swarmAgentLogs } from "@/db";
import { eq, desc } from "drizzle-orm";
import { runSwarmPrediction } from "@/lib/swarm-engine";
import crypto from "crypto";

function generateId() {
  return crypto.randomUUID();
}

/**
 * POST /api/swarm — Run a full swarm prediction
 * Body: { marketQuestion, marketPrice, marketId?, agentCount? }
 *
 * This is expensive (~$5-15 per run) and takes 60-120 seconds.
 * Results are stored in the database for historical tracking.
 */
export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "No API key" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { marketQuestion, marketPrice, marketId, agentCount } = body;

    if (!marketQuestion || typeof marketPrice !== "number") {
      return NextResponse.json({ error: "Missing marketQuestion or marketPrice" }, { status: 400 });
    }

    // Run the swarm
    const result = await runSwarmPrediction(
      marketQuestion,
      marketPrice,
      agentCount || 200
    );

    // Store in database
    const db = getDb();
    const predictionId = generateId();

    await db.insert(swarmPredictions).values({
      id: predictionId,
      marketId: marketId || "unknown",
      marketQuestion,
      marketPrice: marketPrice * 100,
      consensus: result.consensus,
      edge: result.edge,
      confidence: result.confidence,
      kellyScore: result.kellyScore,
      recommendation: result.recommendation,
      agentCount: result.agentCount,
      rounds: result.rounds,
      fullResult: JSON.stringify(result),
    });

    // Store agent logs (sample — store every 5th to keep DB reasonable)
    const sampledLogs = result.agentLogs.filter((_, i) => i % 5 === 0);
    for (const log of sampledLogs) {
      await db.insert(swarmAgentLogs).values({
        id: generateId(),
        predictionId,
        agentArchetype: log.archetype,
        round: log.round,
        probability: log.probability,
        confidence: log.confidence,
        reasoning: log.reasoning.slice(0, 500),
      });
    }

    return NextResponse.json({ ...result, predictionId });
  } catch (err) {
    console.error("[Swarm] Error:", err);
    return NextResponse.json({ error: "Swarm prediction failed" }, { status: 500 });
  }
}

/**
 * GET /api/swarm?marketId=X — Get historical predictions for a market
 */
export async function GET(request: NextRequest) {
  const marketId = request.nextUrl.searchParams.get("marketId");

  try {
    const db = getDb();

    if (marketId) {
      const predictions = await db
        .select()
        .from(swarmPredictions)
        .where(eq(swarmPredictions.marketId, marketId))
        .orderBy(desc(swarmPredictions.createdAt))
        .limit(20);

      return NextResponse.json({ predictions });
    }

    // Return all recent predictions
    const predictions = await db
      .select()
      .from(swarmPredictions)
      .orderBy(desc(swarmPredictions.createdAt))
      .limit(20);

    return NextResponse.json({ predictions });
  } catch {
    return NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 });
  }
}
