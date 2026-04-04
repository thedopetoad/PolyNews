import { config } from "dotenv";
config({ path: ".env.local" });
import { runSwarmPrediction } from "../src/lib/swarm-engine";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";
import crypto from "crypto";

async function main() {
  console.log("========================================");
  console.log(" SUPER SWARM — S&P 500 April 6");
  console.log(" 4,096 agents × 10 rounds");
  console.log("========================================\n");

  const question = "S&P 500 Opens Up or Down on April 6?";
  const marketPrice = 0.50;
  const marketId = "sp500-opens-up-down-april-6";

  console.log("Starting swarm...\n");
  const start = Date.now();

  const result = await runSwarmPrediction(question, marketPrice, 4096);

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  console.log(`\n========== RESULTS (${elapsed} min) ==========`);
  console.log(`Consensus: ${result.consensus.toFixed(1)}%`);
  console.log(`Market: ${result.marketPrice.toFixed(0)}%`);
  console.log(`Edge: ${result.edge > 0 ? "+" : ""}${result.edge.toFixed(1)}%`);
  console.log(`Kelly: ${result.kellyScore.toFixed(3)}`);
  console.log(`Recommendation: ${result.recommendation}`);
  console.log(`Agents: ${result.agentCount}`);
  console.log(`Rounds: ${result.roundProgression?.join("% → ")}%`);
  console.log(`Stability: ${(result.consensusStability * 100).toFixed(0)}%`);

  // Save to DB
  console.log("\nSaving to database...");
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const predId = crypto.randomUUID();
  await db.insert(schema.swarmPredictions).values({
    id: predId,
    marketId,
    marketQuestion: question,
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

  console.log(`Saved! ID: ${predId}`);
  console.log("Check polystream.vercel.app/ai-beta to see results");
  console.log("==========================================");
}

main().catch((e) => {
  console.error("FATAL:", e.message || e);
  process.exit(1);
});
