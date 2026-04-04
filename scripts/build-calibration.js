/**
 * Build calibration model from historical Polymarket data.
 *
 * Analyzes 100K+ resolved markets to answer:
 * "When Polymarket says X%, how often does Yes actually win?"
 *
 * Output: calibration.json with bins of market prices → actual outcomes
 * This tells the swarm engine how to adjust its predictions.
 *
 * Usage: node scripts/build-calibration.js
 */

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const MARKETS_CSV = path.join(__dirname, "..", "data", "polymarket_markets.csv");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "calibration.json");

console.log("Loading markets CSV...");
const raw = fs.readFileSync(MARKETS_CSV, "utf8");

console.log("Parsing CSV (this may take a minute)...");
const records = parse(raw, {
  columns: true,
  skip_empty_lines: true,
  relax_column_count: true,
});

console.log(`Parsed ${records.length} records.`);

// Filter to resolved binary markets with meaningful volume
const resolved = records.filter((r) => {
  if (r.closed?.toLowerCase() !== "true") return false;
  if (!r.outcomePrices) return false;
  if (!r.volume || parseFloat(r.volume) < 1000) return false;

  // Must be binary (2 outcomes)
  try {
    const outcomes = JSON.parse(r.outcomes || "[]");
    if (outcomes.length !== 2) return false;
  } catch {
    return false;
  }

  // Must have a clear resolution (price near 0 or 1)
  try {
    const prices = JSON.parse(r.outcomePrices);
    const p0 = parseFloat(prices[0]);
    if (isNaN(p0)) return false;
    // Resolved if one outcome is >0.95 or <0.05
    if (p0 > 0.95 || p0 < 0.05) return true;
  } catch {}

  return false;
});

console.log(`Found ${resolved.length} resolved binary markets with >$1K volume.`);

// For each resolved market, determine:
// - The final YES price before resolution (use lastTradePrice or bestBid as proxy)
// - Whether YES actually won
const dataPoints = [];

for (const r of resolved) {
  try {
    const finalPrices = JSON.parse(r.outcomePrices);
    const yesWon = parseFloat(finalPrices[0]) > 0.5;

    // The "market price" is the last trade price or best bid BEFORE resolution
    // Since we only have snapshot data, use lastTradePrice as proxy
    let marketPrice = parseFloat(r.lastTradePrice || "0");

    // If lastTradePrice is the resolved price (0 or 1), use bestBid instead
    if (marketPrice > 0.95 || marketPrice < 0.05) {
      marketPrice = parseFloat(r.bestBid || "0");
    }

    // Skip if we can't determine a meaningful pre-resolution price
    if (marketPrice <= 0.03 || marketPrice >= 0.97) continue;
    if (isNaN(marketPrice)) continue;

    const volume = parseFloat(r.volume || "0");

    dataPoints.push({
      question: (r.question || "").slice(0, 100),
      marketPrice,
      yesWon,
      volume,
    });
  } catch {}
}

console.log(`Built ${dataPoints.length} calibration data points.`);

// Build calibration bins (5% increments)
const bins = {};
for (let i = 0; i < 20; i++) {
  const lower = i * 5;
  const upper = (i + 1) * 5;
  const label = `${lower}-${upper}%`;
  bins[label] = { lower, upper, total: 0, yesWins: 0, avgPrice: 0, priceSum: 0 };
}

for (const dp of dataPoints) {
  const pct = dp.marketPrice * 100;
  const binIdx = Math.min(19, Math.floor(pct / 5));
  const lower = binIdx * 5;
  const upper = (binIdx + 1) * 5;
  const label = `${lower}-${upper}%`;

  bins[label].total++;
  if (dp.yesWon) bins[label].yesWins++;
  bins[label].priceSum += dp.marketPrice;
}

// Calculate actual win rates and calibration error
const calibration = [];
for (const [label, bin] of Object.entries(bins)) {
  if (bin.total < 10) continue; // Need minimum sample size

  const actualWinRate = bin.yesWins / bin.total;
  const avgMarketPrice = bin.priceSum / bin.total;
  const calibrationError = actualWinRate - avgMarketPrice; // Positive = market underestimates

  calibration.push({
    bin: label,
    lower: bin.lower / 100,
    upper: bin.upper / 100,
    midpoint: (bin.lower + bin.upper) / 200,
    sampleSize: bin.total,
    yesWins: bin.yesWins,
    actualWinRate: Math.round(actualWinRate * 1000) / 1000,
    avgMarketPrice: Math.round(avgMarketPrice * 1000) / 1000,
    calibrationError: Math.round(calibrationError * 1000) / 1000,
  });
}

// Also compute overall stats
const totalPoints = dataPoints.length;
const overallAccuracy = dataPoints.filter((dp) => {
  const predicted = dp.marketPrice > 0.5;
  return predicted === dp.yesWon;
}).length / totalPoints;

// Volume-weighted calibration
const highVolume = dataPoints.filter((dp) => dp.volume >= 100000);
const highVolAccuracy = highVolume.length > 0
  ? highVolume.filter((dp) => (dp.marketPrice > 0.5) === dp.yesWon).length / highVolume.length
  : 0;

const result = {
  generatedAt: new Date().toISOString(),
  totalMarkets: records.length,
  resolvedBinary: resolved.length,
  calibrationPoints: dataPoints.length,
  overallAccuracy: Math.round(overallAccuracy * 1000) / 1000,
  highVolumeAccuracy: Math.round(highVolAccuracy * 1000) / 1000,
  highVolumeCount: highVolume.length,
  bins: calibration,
  // Summary: where does Polymarket systematically over/under estimate?
  insights: calibration
    .filter((b) => Math.abs(b.calibrationError) > 0.03 && b.sampleSize >= 50)
    .map((b) => ({
      bin: b.bin,
      direction: b.calibrationError > 0 ? "underestimates" : "overestimates",
      magnitude: Math.abs(b.calibrationError),
      sampleSize: b.sampleSize,
    })),
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
console.log(`\nCalibration model saved to ${OUTPUT_PATH}`);
console.log(`\nSummary:`);
console.log(`  Total markets analyzed: ${records.length}`);
console.log(`  Resolved binary markets: ${resolved.length}`);
console.log(`  Calibration data points: ${dataPoints.length}`);
console.log(`  Overall accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
console.log(`  High-volume (>$100K) accuracy: ${(highVolAccuracy * 100).toFixed(1)}% (${highVolume.length} markets)`);
console.log(`\nCalibration bins:`);
for (const bin of calibration) {
  const bar = bin.calibrationError > 0 ? "+" : "";
  console.log(`  ${bin.bin.padEnd(8)} | n=${String(bin.sampleSize).padStart(5)} | actual=${(bin.actualWinRate * 100).toFixed(0)}% vs market=${(bin.avgMarketPrice * 100).toFixed(0)}% | error=${bar}${(bin.calibrationError * 100).toFixed(1)}%`);
}
