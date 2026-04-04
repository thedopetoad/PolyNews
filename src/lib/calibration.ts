/**
 * Pure live calibration — learns exclusively from our own swarm predictions
 * vs actual market outcomes. No historical baseline. Starts from zero and
 * improves as more markets resolve.
 */

import { getDb, swarmPredictions } from "@/db";
import { isNotNull } from "drizzle-orm";

interface CalibrationBin {
  range: string;
  predicted: number;
  actual: number;
  count: number;
  error: number;
}

/**
 * Build live calibration from resolved swarm predictions.
 * Returns calibration bins showing how accurate the swarm has been
 * at various prediction levels.
 */
export async function getLiveCalibration(): Promise<{
  bins: CalibrationBin[];
  totalPredictions: number;
  resolvedPredictions: number;
  accuracy: number;
}> {
  try {
    const db = getDb();
    const resolved = await db
      .select()
      .from(swarmPredictions)
      .where(isNotNull(swarmPredictions.resolvedOutcome));

    if (resolved.length === 0) {
      return { bins: [], totalPredictions: 0, resolvedPredictions: 0, accuracy: 0 };
    }

    // Build bins (10% increments)
    const bins: Record<string, { predicted: number; actuals: number[]; count: number }> = {};
    for (let i = 0; i < 10; i++) {
      const label = `${i * 10}-${(i + 1) * 10}%`;
      bins[label] = { predicted: 0, actuals: [], count: 0 };
    }

    let correct = 0;
    for (const pred of resolved) {
      const consensus = pred.consensus;
      const actual = pred.resolvedOutcome!;
      const binIdx = Math.min(9, Math.floor(consensus / 10));
      const label = `${binIdx * 10}-${(binIdx + 1) * 10}%`;

      bins[label].predicted += consensus;
      bins[label].actuals.push(actual);
      bins[label].count++;

      // Correct if prediction direction matches outcome
      const predictedYes = consensus > 50;
      const actualYes = actual > 50;
      if (predictedYes === actualYes) correct++;
    }

    const calibrationBins: CalibrationBin[] = Object.entries(bins)
      .filter(([, b]) => b.count > 0)
      .map(([range, b]) => {
        const avgPredicted = b.predicted / b.count;
        const avgActual = b.actuals.reduce((s, v) => s + v, 0) / b.count;
        return {
          range,
          predicted: Math.round(avgPredicted * 10) / 10,
          actual: Math.round(avgActual * 10) / 10,
          count: b.count,
          error: Math.round((avgActual - avgPredicted) * 10) / 10,
        };
      });

    const allPreds = await db.select().from(swarmPredictions);

    return {
      bins: calibrationBins,
      totalPredictions: allPreds.length,
      resolvedPredictions: resolved.length,
      accuracy: Math.round((correct / resolved.length) * 1000) / 10,
    };
  } catch {
    return { bins: [], totalPredictions: 0, resolvedPredictions: 0, accuracy: 0 };
  }
}

/**
 * Simple calibration pass-through — no adjustment until we have live data.
 * As live predictions resolve, this can be enhanced with learned biases.
 */
export function calibrateSwarmPrediction(
  swarmConsensus: number,
  _marketPrice: number,
): {
  calibrated: number;
  calibrationAdjustment: number;
  historicalBias: string;
} {
  // Pure pass-through: no adjustment until live data accumulates
  return {
    calibrated: swarmConsensus,
    calibrationAdjustment: 0,
    historicalBias: "building calibration from live data",
  };
}
