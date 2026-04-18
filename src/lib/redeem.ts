"use client";

import { encodeFunctionData } from "viem";

/**
 * Cash out a winning Polymarket position by redeeming the outcome
 * tokens 1-for-1 for USDC.e via the ConditionalTokens contract.
 *
 * Used when a market has resolved and the CLOB orderbook has been
 * torn down — "sell" is no longer possible, but every 1.0 YES share
 * becomes redeemable for 1 USDC.e (and every 0.0-side share becomes
 * redeemable for 0). Polymarket's UI shows a Redeem button for this;
 * this file gives us the in-app equivalent so users never need to
 * leave.
 *
 * Scope note: this implementation only supports the standard CTF
 * binary (YES/NO) redemption. Multi-outcome "Neg Risk" markets use a
 * different adapter contract (NegRiskAdapter at 0xd91E80...) and will
 * need their own encode helper when we enable them.
 */

// Polygon mainnet Polymarket contracts.
export const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;

// Top-level collection for a condition (= bytes32(0) when the position
// isn't nested inside another collection, which is every Polymarket
// market).
const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const REDEEM_ABI = [
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

/**
 * Encode a call to CTF.redeemPositions for a binary (YES/NO) market.
 *
 * The `indexSets` parameter is a set of bit-flags, one per outcome:
 *   - 1 (binary 01) = YES outcome
 *   - 2 (binary 10) = NO outcome
 * Passing both redeems every outcome the user holds — losing shares
 * return 0 USDC and winning shares return shares × $1, so there's no
 * downside to including both.
 */
export function encodeBinaryRedeem(conditionId: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(conditionId)) {
    throw new Error(`Invalid conditionId: ${conditionId}`);
  }
  return encodeFunctionData({
    abi: REDEEM_ABI,
    functionName: "redeemPositions",
    args: [
      USDC_E,
      PARENT_COLLECTION_ID,
      conditionId as `0x${string}`,
      [BigInt(1), BigInt(2)],
    ],
  });
}
