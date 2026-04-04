import { config } from "dotenv";
config({ path: ".env.local" });

import { runSwarmPrediction } from "../src/lib/swarm-engine";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";
import crypto from "crypto";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function main() {
  console.log(`\n${BOLD}${CYAN}========================================${RESET}`);
  console.log(`${BOLD}${CYAN} SUPER SWARM — S&P 500 April 6${RESET}`);
  console.log(`${BOLD}${CYAN} 500 agents × 10 rounds (direct mode)${RESET}`);
  console.log(`${BOLD}${CYAN}========================================${RESET}\n`);

  const question = "S&P 500 Opens Up or Down on April 6?";
  const marketPrice = 0.50;
  const marketId = "sp500-opens-up-down-april-6";

  console.log(`${DIM}Market: ${question}${RESET}`);
  console.log(`${DIM}Price: ${(marketPrice * 100).toFixed(0)}%${RESET}`);
  console.log(`${DIM}Agents: 500 | Batch: 10 | Delay: 1.5s${RESET}\n`);

  const start = Date.now();

  const onProgress = (phase: string, round: number, totalRounds: number, agentsDone: number, totalAgents: number) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const min = Math.floor(Number(elapsed) / 60);
    const sec = Number(elapsed) % 60;
    const pct = Math.round((agentsDone / totalAgents) * 100);
    const bar = "█".repeat(Math.round(pct / 2.5)) + "░".repeat(40 - Math.round(pct / 2.5));
    process.stdout.write(`\r  ${YELLOW}[${min}m${sec.toString().padStart(2, "0")}s]${RESET} R${round}/${totalRounds} ${bar} ${pct}% (${agentsDone}/${totalAgents}) — ${phase}    `);
  };

  console.log(`${BOLD}Starting swarm...${RESET}\n`);

  const result = await runSwarmPrediction(question, marketPrice, 500, onProgress);

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);

  console.log(`\n\n${BOLD}${GREEN}========================================${RESET}`);
  console.log(`${BOLD}${GREEN} RESULTS (${elapsed} minutes)${RESET}`);
  console.log(`${BOLD}${GREEN}========================================${RESET}\n`);

  const edgeColor = result.edge > 3 ? GREEN : result.edge < -3 ? RED : YELLOW;

  console.log(`  ${BOLD}Consensus:${RESET}    ${CYAN}${BOLD}${result.consensus.toFixed(1)}%${RESET}`);
  console.log(`  ${BOLD}Market:${RESET}       ${result.marketPrice.toFixed(0)}%`);
  console.log(`  ${BOLD}Edge:${RESET}         ${edgeColor}${result.edge > 0 ? "+" : ""}${result.edge.toFixed(1)}%${RESET}`);
  console.log(`  ${BOLD}Kelly:${RESET}        ${result.kellyScore.toFixed(3)}`);
  console.log(`  ${BOLD}Signal:${RESET}       ${BOLD}${result.recommendation}${RESET}`);
  console.log(`  ${BOLD}Stability:${RESET}    ${(result.consensusStability * 100).toFixed(0)}%`);
  console.log(`  ${BOLD}Agents:${RESET}       ${result.agentCount}`);

  if (result.roundProgression) {
    console.log(`\n  ${BOLD}Trajectory:${RESET}`);
    result.roundProgression.forEach((r, i) => {
      const bar = "█".repeat(Math.round(r / 2.5));
      const color = r > 55 ? GREEN : r < 45 ? RED : YELLOW;
      console.log(`    R${(i + 1).toString().padStart(2, " ")}: ${color}${bar} ${r}%${RESET}`);
    });
  }

  if (result.clusterAnalysis) {
    console.log(`\n  ${GREEN}${BOLD}BULL${RESET} (${result.clusterAnalysis.bullCluster.size} agents, avg ${result.clusterAnalysis.bullCluster.avgPrediction}%)`);
    console.log(`  ${DIM}"${result.clusterAnalysis.bullCluster.topArgument.slice(0, 120)}"${RESET}`);
    console.log(`\n  ${RED}${BOLD}BEAR${RESET} (${result.clusterAnalysis.bearCluster.size} agents, avg ${result.clusterAnalysis.bearCluster.avgPrediction}%)`);
    console.log(`  ${DIM}"${result.clusterAnalysis.bearCluster.topArgument.slice(0, 120)}"${RESET}`);
  }

  // Save to DB
  console.log(`\n  ${DIM}Saving to database...${RESET}`);
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

  console.log(`  ${GREEN}✓ Saved!${RESET} ID: ${predId}`);
  console.log(`  ${CYAN}Results live at polystream.vercel.app/ai-beta${RESET}\n`);
}

main().catch((e) => {
  console.error(`\n${RED}FATAL:${RESET}`, e.message || e);
  process.exit(1);
});
