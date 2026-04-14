"use client";

/**
 * Polymarket Relay utilities for gasless USDC.e transfers.
 *
 * Uses the @polymarket/builder-relayer-client SDK which handles:
 * - Proxy wallet address derivation
 * - Relay hash construction + signing (via wagmi walletClient)
 * - Builder HMAC headers (via remote signer at /api/polymarket/builder-headers)
 * - Submission to relayer-v2.polymarket.com
 * - Polling for tx confirmation
 */

import { getCreate2Address, keccak256, encodePacked, encodeFunctionData, erc20Abi } from "viem";

// ── Constants ──────────────────────────────────────────────────────────────
export const RELAYER_URL = "https://relayer-v2.polymarket.com";
export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const PROXY_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052" as const;
export const PROXY_INIT_CODE_HASH = "0xd21df8dc65880a8606f09fe0ce3df9b8869287ab0b058be05aa9e8af6330a00b" as `0x${string}`;

/**
 * Derive the deterministic Polymarket proxy wallet address for an EOA.
 * This is the CREATE2 address where the user's USDC.e is held.
 */
export function deriveProxyAddress(eoaAddress: string): `0x${string}` {
  return getCreate2Address({
    bytecodeHash: PROXY_INIT_CODE_HASH,
    from: PROXY_FACTORY,
    salt: keccak256(encodePacked(["address"], [eoaAddress as `0x${string}`])),
  });
}

/**
 * Encode an ERC-20 transfer calldata for USDC.e (6 decimals).
 */
export function encodeUsdcTransfer(to: string, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to as `0x${string}`, amountRaw],
  });
}
