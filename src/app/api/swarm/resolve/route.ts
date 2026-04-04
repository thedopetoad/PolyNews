import { NextResponse } from "next/server";
import { getDb, swarmPredictions, swarmAgentMemory } from "@/db";
import { isNull, eq } from "drizzle-orm";

const GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * GET /api/swarm/resolve
 *
 * Checks if any tracked markets have resolved on Polymarket.
 * If resolved, updates predictions and agent memory with actual outcomes.
 * Designed to be called by Vercel Cron every 5 minutes.
 */
export async function GET() {
  try {
    const db = getDb();

    // Find predictions without resolved outcomes
    const unresolved = await db
      .select()
      .from(swarmPredictions)
      .where(isNull(swarmPredictions.resolvedOutcome));

    if (unresolved.length === 0) {
      return NextResponse.json({ message: "No unresolved predictions", checked: 0 });
    }

    // Group by unique market questions
    const uniqueMarkets = [...new Set(unresolved.map((p) => p.marketQuestion))];
    let resolvedCount = 0;

    for (const question of uniqueMarkets) {
      try {
        // Search for this market on Polymarket
        const searchQ = encodeURIComponent(question.slice(0, 50));
        const res = await fetch(`${GAMMA_API}/markets?closed=true&limit=10`, {
          headers: { Accept: "application/json" },
        });

        if (!res.ok) continue;
        const markets = await res.json();

        // Find matching market
        const match = markets.find((m: { question?: string; closed?: boolean }) =>
          m.question?.toLowerCase().includes(question.toLowerCase().slice(0, 30)) && m.closed
        );

        if (!match) continue;

        // Determine outcome
        const prices = JSON.parse(match.outcomePrices || "[0.5, 0.5]");
        const yesPrice = parseFloat(prices[0]);

        // Only count as resolved if clearly resolved (>0.95 or <0.05)
        if (yesPrice > 0.95 || yesPrice < 0.05) {
          const actualOutcome = yesPrice > 0.5 ? 100 : 0;

          // Update all predictions for this market
          const marketPreds = unresolved.filter((p) => p.marketQuestion === question);
          for (const pred of marketPreds) {
            await db.update(swarmPredictions).set({
              resolvedOutcome: actualOutcome,
              resolvedAt: new Date(),
            }).where(eq(swarmPredictions.id, pred.id));

            // Update agent memory
            const wasCorrect = (pred.consensus > 50) === (actualOutcome > 50);
            await db.update(swarmAgentMemory).set({
              actualOutcome: actualOutcome,
              wasCorrect,
            }).where(eq(swarmAgentMemory.marketId, pred.marketQuestion.slice(0, 100)));

            resolvedCount++;
          }
        }
      } catch {}
    }

    return NextResponse.json({
      message: `Checked ${uniqueMarkets.length} markets, resolved ${resolvedCount} predictions`,
      checked: uniqueMarkets.length,
      resolved: resolvedCount,
    });
  } catch {
    return NextResponse.json({ error: "Resolution check failed" }, { status: 500 });
  }
}
