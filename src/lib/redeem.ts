"use client";

import { encodeFunctionData, parseUnits } from "viem";

/**
 * Cash out a winning Polymarket position by redeeming the outcome
 * tokens 1-for-1 for USDC.e.
 *
 * Used when a market has resolved and the CLOB orderbook has been
 * torn down — "sell" is no longer possible, but every 1.0 (winning)
 * share becomes redeemable for 1 USDC.e (and every 0.0-side share
 * becomes redeemable for 0). Polymarket's UI shows a Redeem button
 * for this; this file gives us the in-app equivalent so users never
 * need to leave.
 *
 * Two redemption paths exist, one per market type:
 *
 *   1. STANDARD (binary YES/NO) — CTF.redeemPositions(…, indexSets).
 *      Every sports market, every two-outcome question. Pass both
 *      index bit-flags and the contract figures out who won.
 *
 *   2. NEG RISK (multi-outcome, only one can win) — e.g. "Who wins
 *      the presidential election?" with 5+ candidates. Uses
 *      NegRiskAdapter.redeemPositions(conditionId, amountsPerOutcome)
 *      with raw 6-decimal share amounts instead of bit-flags.
 *
 * Routing is controlled by the market's `negRisk` flag (available on
 * every Gamma-API market response). See `getNegRiskFlag()` for the
 * cached per-conditionId lookup.
 */

// ── Polygon mainnet Polymarket contracts ─────────────────────────────
export const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
export const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as `0x${string}`;

// Top-level collection for a condition (= bytes32(0) when the position
// isn't nested inside another collection, which is every Polymarket
// market).
const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

// Outcome tokens on Polymarket are 6-decimal fixed-point (same as USDC.e).
const OUTCOME_DECIMALS = 6;

const CTF_REDEEM_ABI = [
  {
    name: "redeemPositions",
    type: "function",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const NEG_RISK_REDEEM_ABI = [
  {
    name: "redeemPositions",
    type: "function",
    inputs: [
      { name: "_conditionId", type: "bytes32" },
      { name: "_amounts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

function assertConditionId(conditionId: string): asserts conditionId is `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(conditionId)) {
    throw new Error(`Invalid conditionId: ${conditionId}`);
  }
}

/**
 * Encode CTF.redeemPositions for a standard binary (YES/NO) market.
 *
 * `indexSets` is a bit-flag array, one per outcome:
 *   - 1 (binary 01) = YES outcome
 *   - 2 (binary 10) = NO outcome
 * Passing both redeems every outcome the user holds — losing shares
 * return 0 USDC and winning shares return shares × $1, so there's no
 * downside to including both.
 */
export function encodeBinaryRedeem(conditionId: string): `0x${string}` {
  assertConditionId(conditionId);
  return encodeFunctionData({
    abi: CTF_REDEEM_ABI,
    functionName: "redeemPositions",
    args: [
      USDC_E,
      PARENT_COLLECTION_ID,
      conditionId,
      [BigInt(1), BigInt(2)],
    ],
  });
}

/**
 * Encode NegRiskAdapter.redeemPositions for a multi-outcome NegRisk
 * market. The amounts argument is raw (6-decimal) share amounts per
 * outcome index — most users only hold one side, so the other entry
 * is zero.
 *
 * Example: user has 10 YES shares on a candidate condition →
 *   encodeNegRiskRedeem(conditionId, 10, 0)
 * Contract will burn the 10 YES tokens and mint whatever USDC.e is
 * owed based on the resolution.
 */
export function encodeNegRiskRedeem(
  conditionId: string,
  yesShares: number,
  noShares: number,
): `0x${string}` {
  assertConditionId(conditionId);
  const amounts: bigint[] = [
    parseUnits(yesShares.toString(), OUTCOME_DECIMALS),
    parseUnits(noShares.toString(), OUTCOME_DECIMALS),
  ];
  return encodeFunctionData({
    abi: NEG_RISK_REDEEM_ABI,
    functionName: "redeemPositions",
    args: [conditionId, amounts],
  });
}

// ── negRisk lookup ───────────────────────────────────────────────────
//
// Polymarket's Gamma API returns `negRisk: boolean` on every market
// metadata response. We cache the result per conditionId for the
// lifetime of the page — it never changes for a given market, so
// refetching is a waste.

const negRiskCache = new Map<string, boolean>();
const GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * Fetch + cache the `negRisk` flag for a market. Returns false if
 * Gamma doesn't know the market (shouldn't happen for any position
 * we could actually hold, but the guard keeps redemption from
 * mis-routing if the API ever hiccups).
 */
export async function getNegRiskFlag(conditionId: string): Promise<boolean> {
  if (negRiskCache.has(conditionId)) return negRiskCache.get(conditionId)!;
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?condition_ids=${encodeURIComponent(conditionId)}&limit=1`,
    );
    if (!res.ok) {
      negRiskCache.set(conditionId, false);
      return false;
    }
    const data = await res.json();
    const flag = Array.isArray(data) && data[0]?.negRisk === true;
    negRiskCache.set(conditionId, flag);
    return flag;
  } catch {
    negRiskCache.set(conditionId, false);
    return false;
  }
}
