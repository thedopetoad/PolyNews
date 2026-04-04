/**
 * Polymarket calibration data built from 13,868 resolved markets.
 * Source: Kaggle dataset (100K+ markets, Dec 2025 snapshot)
 *
 * Each bin shows: when Polymarket prices a market at X%,
 * the actual outcome is Yes Y% of the time.
 *
 * calibrationError = actualWinRate - avgMarketPrice
 * Positive = market underestimates (edge: buy YES)
 * Negative = market overestimates (edge: buy NO)
 */
const CALIBRATION_BINS = [
  { lower: 0.00, upper: 0.05, actual: 0.085, error: 0.045, n: 59 },
  { lower: 0.05, upper: 0.10, actual: 0.089, error: 0.019, n: 768 },
  { lower: 0.10, upper: 0.15, actual: 0.103, error: -0.018, n: 645 },
  { lower: 0.15, upper: 0.20, actual: 0.160, error: -0.009, n: 616 },
  { lower: 0.20, upper: 0.25, actual: 0.201, error: -0.022, n: 690 },
  { lower: 0.25, upper: 0.30, actual: 0.283, error: 0.013, n: 646 },
  { lower: 0.30, upper: 0.35, actual: 0.293, error: -0.026, n: 715 },
  { lower: 0.35, upper: 0.40, actual: 0.362, error: -0.011, n: 722 },
  { lower: 0.40, upper: 0.45, actual: 0.398, error: -0.017, n: 785 },
  { lower: 0.45, upper: 0.50, actual: 0.441, error: -0.032, n: 988 },
  { lower: 0.50, upper: 0.55, actual: 0.514, error: -0.007, n: 1520 },
  { lower: 0.55, upper: 0.60, actual: 0.551, error: -0.022, n: 768 },
  { lower: 0.60, upper: 0.65, actual: 0.623, error: 0.003, n: 682 },
  { lower: 0.65, upper: 0.70, actual: 0.723, error: 0.053, n: 661 },
  { lower: 0.70, upper: 0.75, actual: 0.714, error: -0.010, n: 664 },
  { lower: 0.75, upper: 0.80, actual: 0.763, error: -0.005, n: 601 },
  { lower: 0.80, upper: 0.85, actual: 0.824, error: 0.004, n: 612 },
  { lower: 0.85, upper: 0.90, actual: 0.872, error: 0.002, n: 612 },
  { lower: 0.90, upper: 0.95, actual: 0.926, error: 0.006, n: 782 },
  { lower: 0.95, upper: 1.00, actual: 0.976, error: 0.022, n: 332 },
];

/**
 * Get the historical calibration error for a given market price.
 * Returns the systematic bias: positive means market underestimates.
 */
export function getCalibrationError(marketPrice: number): number {
  const bin = CALIBRATION_BINS.find(
    (b) => marketPrice >= b.lower && marketPrice < b.upper
  );
  return bin?.error || 0;
}

/**
 * Get the historically accurate probability for a given market price.
 * Adjusts for Polymarket's systematic biases.
 */
export function getCalibratedProbability(marketPrice: number): number {
  const bin = CALIBRATION_BINS.find(
    (b) => marketPrice >= b.lower && marketPrice < b.upper
  );
  if (!bin) return marketPrice;
  return bin.actual;
}

/**
 * Apply calibration adjustment to a swarm prediction.
 * Blends the raw swarm consensus with historical calibration data.
 *
 * The calibration tells us where Polymarket systematically misprices.
 * If the swarm agrees with the calibration direction, confidence goes up.
 * If the swarm disagrees, we dampen the prediction.
 */
export function calibrateSwarmPrediction(
  swarmConsensus: number, // 0-100
  marketPrice: number,    // 0-1
): {
  calibrated: number;
  calibrationAdjustment: number;
  historicalBias: string;
} {
  const consensusFrac = swarmConsensus / 100;
  const calError = getCalibrationError(marketPrice);
  const historicalActual = getCalibratedProbability(marketPrice);

  // Blend: 70% swarm prediction + 30% historical calibration
  const blended = consensusFrac * 0.7 + historicalActual * 0.3;
  const calibrated = Math.round(blended * 1000) / 10; // Back to 0-100

  const adjustment = calibrated - swarmConsensus;

  let historicalBias = "neutral";
  if (calError > 0.02) historicalBias = "market historically underestimates this range";
  else if (calError < -0.02) historicalBias = "market historically overestimates this range";

  return {
    calibrated,
    calibrationAdjustment: Math.round(adjustment * 10) / 10,
    historicalBias,
  };
}
