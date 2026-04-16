"use client";

interface OrderBookLevel {
  price: string;
  size: string;
}

interface OrderBook {
  bids: OrderBookLevel[]; // sorted best (highest) first
  asks: OrderBookLevel[]; // sorted best (lowest) first
}

export interface SlippageEstimate {
  avgFillPrice: number;  // weighted average price the order would fill at
  slippagePct: number;   // % difference from best price (bid for sell, ask for buy)
  filled: boolean;       // false if book has insufficient depth
  warn: boolean;         // true if slippage > warnThreshold
}

const WARN_THRESHOLD_PCT = 3; // warn above 3% slippage

/**
 * Compute expected fill price by walking the order book.
 * For BUY, walks up the asks (cheapest first) until `amountUsd` filled.
 * For SELL, walks down the bids (highest first) until `shares` filled.
 */
export function estimateSlippage(
  book: OrderBook,
  side: "BUY" | "SELL",
  amount: number // USDC for BUY, shares for SELL
): SlippageEstimate {
  const levels = side === "BUY" ? book.asks : book.bids;
  if (levels.length === 0) {
    return { avgFillPrice: 0, slippagePct: 0, filled: false, warn: true };
  }

  // Sort best first (asks ascending, bids descending)
  const sorted = [...levels].sort((a, b) => {
    const pa = parseFloat(a.price);
    const pb = parseFloat(b.price);
    return side === "BUY" ? pa - pb : pb - pa;
  });

  const bestPrice = parseFloat(sorted[0].price);
  let remaining = amount;
  let totalCost = 0; // USDC for BUY, USDC received for SELL
  let totalShares = 0;

  for (const level of sorted) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (side === "BUY") {
      // How many USDC can we spend at this level?
      const levelUsd = price * size;
      const usdToSpend = Math.min(remaining, levelUsd);
      const sharesAtLevel = usdToSpend / price;
      totalCost += usdToSpend;
      totalShares += sharesAtLevel;
      remaining -= usdToSpend;
      if (remaining <= 0.0001) break;
    } else {
      // SELL: how many shares can we sell at this level?
      const sharesAtLevel = Math.min(remaining, size);
      totalCost += sharesAtLevel * price;
      totalShares += sharesAtLevel;
      remaining -= sharesAtLevel;
      if (remaining <= 0.0001) break;
    }
  }

  if (remaining > 0.0001) {
    // Not enough liquidity to fill the full amount
    return { avgFillPrice: 0, slippagePct: 0, filled: false, warn: true };
  }

  const avgFillPrice = totalCost / totalShares;
  const slippagePct = Math.abs(((avgFillPrice - bestPrice) / bestPrice) * 100);
  const warn = slippagePct > WARN_THRESHOLD_PCT;

  return { avgFillPrice, slippagePct, filled: true, warn };
}
