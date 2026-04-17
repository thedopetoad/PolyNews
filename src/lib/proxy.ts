// Server-safe Polymarket proxy derivation. Mirrors relay.ts's
// deriveProxyAddress but lives in a non-"use client" file so server
// routes (cron, admin API) can import it.

import { getCreate2Address, keccak256, encodePacked } from "viem";

export const PROXY_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052" as const;
export const PROXY_INIT_CODE_HASH = "0xd21df8dc65880a8606f09fe0ce3df9b8869287ab0b058be05aa9e8af6330a00b" as `0x${string}`;
export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

/** Polymarket's CREATE2 proxy wallet for a given EOA. */
export function deriveProxyAddress(eoaAddress: string): `0x${string}` {
  return getCreate2Address({
    bytecodeHash: PROXY_INIT_CODE_HASH,
    from: PROXY_FACTORY,
    salt: keccak256(encodePacked(["address"], [eoaAddress as `0x${string}`])),
  });
}
