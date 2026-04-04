import { config } from "dotenv";
config({ path: ".env.local" });

import { runSwarmPrediction, SwarmProgressCallback } from "../src/lib/swarm-engine";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";
import crypto from "crypto";

const CLEAR = "\x1b[2J\x1b[H";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let startTime = Date.now();
let roundAvgs: number[] = [];
let totalCalls = 0;
let successCalls = 0;

function renderDashboard(phase: string, round: number, totalRounds: number, agentsDone: number, totalAgents: number) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;
  const pct = Math.round((agentsDone / totalAgents) * 100);
  const barWidth = 40;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  totalCalls = agentsDone;

  // Build display
  let out = CLEAR;
  out += `${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}\n`;
  out += `${BOLD}${CYAN}║         SUPER SWARM — S&P 500 April 6               ║${RESET}\n`;
  out += `${BOLD}${CYAN}║         4,096 Agents × 10 Rounds                    ║${RESET}\n`;
  out += `${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}\n\n`;

  out += `  ${DIM}Elapsed:${RESET} ${minutes}m ${seconds}s\n\n`;

  // Phase indicator
  const phases = [
    { name: "Knowledge Gathering", rounds: "—" },
    { name: "Independent Analysis", rounds: "1-2" },
    { name: "Social Feed", rounds: "3-5" },
    { name: "Cluster Debate", rounds: "6-8" },
    { name: "Final Calibration", rounds: "9-10" },
  ];

  out += `  ${BOLD}PHASE${RESET}\n`;
  for (const p of phases) {
    const isCurrent = phase.includes(p.name.split(" ")[0]);
    const isDone = (phase === "Social Feed" && p.name === "Independent Analysis") ||
                   (phase === "Cluster Debate" && (p.name === "Independent Analysis" || p.name === "Social Feed")) ||
                   (phase === "Final Calibration" && p.name !== "Final Calibration");
    const icon = isDone ? `${GREEN}✓${RESET}` : isCurrent ? `${YELLOW}▶${RESET}` : `${DIM}○${RESET}`;
    const label = isCurrent ? `${BOLD}${p.name}${RESET}` : isDone ? `${GREEN}${p.name}${RESET}` : `${DIM}${p.name}${RESET}`;
    out += `  ${icon} ${label} ${DIM}(R${p.rounds})${RESET}\n`;
  }

  out += `\n  ${BOLD}ROUND ${round}/${totalRounds}${RESET}\n`;
  out += `  ${YELLOW}${bar}${RESET} ${pct}%\n`;
  out += `  ${DIM}${agentsDone}/${totalAgents} agents processed${RESET}\n\n`;

  // Round progression
  if (roundAvgs.length > 0) {
    out += `  ${BOLD}CONSENSUS TRAJECTORY${RESET}\n  `;
    for (let i = 0; i < roundAvgs.length; i++) {
      const avg = roundAvgs[i];
      const color = avg > 55 ? GREEN : avg < 45 ? RED : YELLOW;
      out += `${color}R${i + 1}:${avg}%${RESET}  `;
    }
    out += `\n`;
  }

  out += `\n  ${DIM}Results will appear on polystream.vercel.app/ai-beta${RESET}\n`;

  process.stdout.write(out);
}

async function main() {
  const question = "S&P 500 Opens Up or Down on April 6?";
  const marketPrice = 0.50;
  const marketId = "sp500-opens-up-down-april-6";

  console.log("Fetching live Polymarket price...");
  try {
    const res = await fetch("https://gamma-api.polymarket.com/events?active=true&limit=100");
    const events = await res.json();
    const market = events.flatMap((e: { markets?: { question?: string; outcomePrices?: string }[] }) => e.markets || [])
      .find((m: { question?: string }) => (m.question || "").toLowerCase().includes("s&p 500") && (m.question || "").toLowerCase().includes("opens"));
    if (market?.outcomePrices) {
      const prices = JSON.parse(market.outcomePrices);
      const p = parseFloat(prices[0]);
      if (p > 0 && p < 1) {
        console.log(`Found: ${market.question} — ${(p * 100).toFixed(0)}%`);
      }
    }
  } catch {}

  startTime = Date.now();

  const onProgress: SwarmProgressCallback = (phase, round, totalRounds, agentsDone, totalAgents) => {
    renderDashboard(phase, round, totalRounds, agentsDone, totalAgents);
  };

  // Initial render
  renderDashboard("Knowledge Gathering", 0, 10, 0, 4096);

  const result = await runSwarmPrediction(question, marketPrice, 4096, onProgress);

  // Collect round avgs for final display
  roundAvgs = result.roundProgression || [];

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Final results
  const edgeColor = result.edge > 3 ? GREEN : result.edge < -3 ? RED : YELLOW;

  console.log(CLEAR);
  console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║              SUPER SWARM COMPLETE                    ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}\n`);
  console.log(`  ${BOLD}Market:${RESET}       ${question}`);
  console.log(`  ${BOLD}Time:${RESET}         ${elapsed} minutes`);
  console.log(`  ${BOLD}Agents:${RESET}       ${result.agentCount.toLocaleString()}`);
  console.log(`  ${BOLD}Rounds:${RESET}       ${result.rounds}`);
  console.log(`\n  ${BOLD}Consensus:${RESET}    ${CYAN}${BOLD}${result.consensus.toFixed(1)}%${RESET}`);
  console.log(`  ${BOLD}Market:${RESET}       ${result.marketPrice.toFixed(0)}%`);
  console.log(`  ${BOLD}Edge:${RESET}         ${edgeColor}${result.edge > 0 ? "+" : ""}${result.edge.toFixed(1)}%${RESET}`);
  console.log(`  ${BOLD}Kelly:${RESET}        ${result.kellyScore.toFixed(3)}`);
  console.log(`  ${BOLD}Signal:${RESET}       ${BOLD}${result.recommendation}${RESET}`);
  console.log(`  ${BOLD}Stability:${RESET}    ${(result.consensusStability * 100).toFixed(0)}%`);

  if (result.roundProgression) {
    console.log(`\n  ${BOLD}Trajectory:${RESET}   ${result.roundProgression.map((r, i) => `R${i + 1}:${r}%`).join(" → ")}`);
  }

  if (result.clusterAnalysis) {
    console.log(`\n  ${GREEN}BULL${RESET} (${result.clusterAnalysis.bullCluster.size} agents, avg ${result.clusterAnalysis.bullCluster.avgPrediction}%)`);
    console.log(`  ${DIM}"${result.clusterAnalysis.bullCluster.topArgument.slice(0, 100)}"${RESET}`);
    console.log(`\n  ${RED}BEAR${RESET} (${result.clusterAnalysis.bearCluster.size} agents, avg ${result.clusterAnalysis.bearCluster.avgPrediction}%)`);
    console.log(`  ${DIM}"${result.clusterAnalysis.bearCluster.topArgument.slice(0, 100)}"${RESET}`);
  }

  // Save to DB
  console.log(`\n  Saving to database...`);
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
  console.log(`  ${CYAN}Check polystream.vercel.app/ai-beta${RESET}\n`);
}

main().catch((e) => {
  console.error(`${RED}FATAL:${RESET}`, e.message || e);
  process.exit(1);
});
