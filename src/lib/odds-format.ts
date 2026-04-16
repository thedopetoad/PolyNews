/**
 * Odds format conversion — sports bettors read American or Decimal odds
 * natively, not percentages. A probability p in [0, 1] maps cleanly to each
 * format; we clamp edge cases (0 / 1) to 0.01 / 0.99 so the conversions
 * don't blow up at the rails.
 *
 * Source of truth for the chosen format is `use-odds-format.ts`.
 */

export type OddsFormat =
  | "price"      // 47¢
  | "american"   // +113 / -115
  | "decimal"    // 2.13
  | "fractional" // 9/8
  | "percentage" // 47%
  | "indonesian" // +1.13 / -1.15
  | "hongkong"   // 1.13
  | "malaysian"; // +0.88 / -0.87

const ORDER: OddsFormat[] = [
  "price",
  "american",
  "decimal",
  "fractional",
  "percentage",
  "indonesian",
  "hongkong",
  "malaysian",
];

export const ODDS_FORMAT_LABEL: Record<OddsFormat, string> = {
  price: "Price",
  american: "American",
  decimal: "Decimal",
  fractional: "Fractional",
  percentage: "Percentage",
  indonesian: "Indonesian",
  hongkong: "Hong Kong",
  malaysian: "Malaysian",
};

export function oddsFormatList(): OddsFormat[] {
  return ORDER;
}

function clamp(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  if (p <= 0.0001) return 0.0001;
  if (p >= 0.9999) return 0.9999;
  return p;
}

/**
 * Reduce n/d to lowest terms. Used for fractional odds so 78/156 displays as 1/2.
 */
function reduceFraction(n: number, d: number): [number, number] {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(n), Math.round(d)) || 1;
  return [Math.round(n / g), Math.round(d / g)];
}

/**
 * Convert a probability (0-1) to the user's chosen odds format.
 * Returns a short string ready to drop into a `<span>`.
 */
export function formatOdds(probability: number, format: OddsFormat): string {
  const p = clamp(probability);

  switch (format) {
    case "price":
      return `${Math.round(p * 100)}¢`;

    case "percentage":
      return `${Math.round(p * 100)}%`;

    case "decimal":
      // Decimal = 1 / probability; shown to 2dp.
      return (1 / p).toFixed(2);

    case "american": {
      // Favorites (p > 0.5): -(p / (1-p)) * 100 → negative, how much to risk to win 100
      // Underdogs (p < 0.5): ((1-p) / p) * 100 → positive, how much you win on 100 risked
      if (p === 0.5) return "+100";
      if (p > 0.5) {
        const val = Math.round((p / (1 - p)) * 100);
        return `-${val}`;
      }
      const val = Math.round(((1 - p) / p) * 100);
      return `+${val}`;
    }

    case "fractional": {
      // Fractional = (1-p)/p, reduced to smallest integers.
      const numerator = 1 - p;
      const denominator = p;
      // Multiply both by 100 and round to get integer pair, then reduce.
      const [n, d] = reduceFraction(numerator * 100, denominator * 100);
      return `${n}/${d}`;
    }

    case "indonesian": {
      // Same sign rules as American, divided by 100.
      if (p === 0.5) return "+1.00";
      if (p > 0.5) return `-${(p / (1 - p)).toFixed(2)}`;
      return `+${((1 - p) / p).toFixed(2)}`;
    }

    case "hongkong":
      // Decimal minus 1, to 2dp.
      return (1 / p - 1).toFixed(2);

    case "malaysian": {
      // Favorites: negative, magnitude 1/((1-p)/p) = p/(1-p) but capped at ≤1
      // Actually Malaysian: if decimal ≥ 2.00 → positive = decimal - 1; if decimal < 2.00 → negative = -1/(decimal-1)
      const dec = 1 / p;
      if (dec >= 2) return `+${(dec - 1).toFixed(2)}`;
      return `-${(1 / (dec - 1)).toFixed(2)}`;
    }
  }
}
