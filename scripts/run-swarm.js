/**
 * CLI Swarm Runner — runs the Super Swarm from your terminal.
 * No Vercel timeout limits. Saves results to Neon DB.
 *
 * Usage: node scripts/run-swarm.js
 *
 * Requires .env.local with OPENAI_API_KEY and DATABASE_URL
 */

const { config } = require("dotenv");
const path = require("path");

// Load env vars
config({ path: path.join(__dirname, "..", ".env.local") });

const MARKETS = [
  {
    id: "us-forces-iran-april-2026",
    question: "US Forces enter Iran by April 30?",
    searchSlug: "us-forces-iran",
  },
  {
    id: "wti-crude-oil-april-2026",
    question: "What will WTI Crude Oil (WTI) hit in April 2026?",
    searchSlug: "wti-crude-oil-april-2026",
  },
  {
    id: "sp500-opens-up-down-april-6",
    question: "S&P 500 Opens Up or Down on April 6?",
    searchSlug: "sp-500-opens-up-or-down-april-6",
  },
];

async function fetchMarketPrice(searchSlug) {
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?slug=${searchSlug}&closed=false`
    );
    if (!res.ok) return null;
    const events = await res.json();
    if (events.length === 0) return null;
    const market = events[0].markets?.[0];
    if (!market) return null;
    const prices = JSON.parse(market.outcomePrices || "[0.5, 0.5]");
    return {
      price: parseFloat(prices[0]),
      marketId: market.id,
      question: market.question,
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     SUPER SWARM — 4,096 Agent Prediction    ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Dynamically import the swarm engine (ESM)
  // We need to compile and run the TypeScript module
  const { execSync } = require("child_process");

  for (const market of MARKETS) {
    console.log(`\n━━━ ${market.question} ━━━`);

    // Fetch live Polymarket price
    console.log("Fetching live Polymarket price...");
    const priceData = await fetchMarketPrice(market.searchSlug);

    if (!priceData) {
      console.log("⚠ Could not fetch market price. Trying with default 0.5...");
    }

    const price = priceData?.price || 0.5;
    const question = priceData?.question || market.question;
    console.log(`Market price: ${(price * 100).toFixed(0)}%`);
    console.log(`Question: ${question}`);

    // Call the swarm API endpoint (running locally or on Vercel)
    const apiUrl = process.env.SWARM_API_URL || "http://localhost:3000";
    console.log(`\nRunning swarm via ${apiUrl}/api/swarm ...`);
    console.log("This will take 8-15 minutes for 4,096 agents × 10 rounds.\n");

    const startTime = Date.now();

    try {
      const res = await fetch(`${apiUrl}/api/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketQuestion: question,
          marketPrice: price,
          marketId: market.id,
          agentCount: 4096,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("✗ Swarm failed:", err.error || res.status);
        continue;
      }

      const result = await res.json();
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

      console.log(`\n✓ Swarm complete in ${elapsed} minutes`);
      console.log(`  Consensus: ${result.consensus?.toFixed(1)}%`);
      console.log(`  Market:    ${result.marketPrice?.toFixed(0)}%`);
      console.log(`  Edge:      ${result.edge > 0 ? "+" : ""}${result.edge?.toFixed(1)}%`);
      console.log(`  Kelly:     ${result.kellyScore?.toFixed(3)}`);
      console.log(`  Rec:       ${result.recommendation}`);
      console.log(`  Agents:    ${result.agentCount}`);
      console.log(`  Stability: ${(result.consensusStability * 100)?.toFixed(0)}%`);
      console.log(`  Saved:     ${result.predictionId}`);
    } catch (err) {
      console.error("✗ Error:", err.message || err);
    }
  }

  console.log("\n━━━ Done ━━━\n");
}

main().catch(console.error);
