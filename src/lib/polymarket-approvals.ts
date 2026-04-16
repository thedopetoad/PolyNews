"use client";

import { encodeFunctionData, erc20Abi, PublicClient } from "viem";
import { polygon } from "viem/chains";

// ── Polymarket contract addresses (Polygon) ──────────────────────────
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as `0x${string}`;
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a" as `0x${string}`;
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as `0x${string}`;

const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// ERC-1155 setApprovalForAll ABI (only what we need)
const ERC1155_APPROVAL_ABI = [
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "isApprovedForAll",
    type: "function",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

export interface ApprovalTransaction {
  to: string;
  data: string;
  value: string;
}

/**
 * Build ALL 7 approval transactions needed for Polymarket trading:
 * 4 USDC.e ERC-20 approvals + 3 outcome token ERC-1155 approvals.
 */
export function buildApprovalTransactions(): ApprovalTransaction[] {
  const txs: ApprovalTransaction[] = [];

  // 4 USDC.e approvals (ERC-20 approve with max uint256)
  const usdcSpenders = [CTF, CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER];
  for (const spender of usdcSpenders) {
    txs.push({
      to: USDC_E,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, BigInt(MAX_UINT256)],
      }),
      value: "0",
    });
  }

  // 3 outcome token approvals (ERC-1155 setApprovalForAll)
  const outcomeSpenders = [CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER];
  for (const spender of outcomeSpenders) {
    txs.push({
      to: CTF,
      data: encodeFunctionData({
        abi: ERC1155_APPROVAL_ABI,
        functionName: "setApprovalForAll",
        args: [spender, true],
      }),
      value: "0",
    });
  }

  return txs;
}

/**
 * Check if a proxy wallet has all required approvals for trading.
 * Returns true only if ALL 7 approvals are in place.
 */
export async function checkApprovals(
  publicClient: PublicClient,
  proxyAddress: `0x${string}`
): Promise<{ allApproved: boolean; usdcApproved: boolean; tokensApproved: boolean }> {
  try {
    // Check one USDC.e approval (CTF Exchange — the main one)
    const usdcAllowance = await publicClient.readContract({
      address: USDC_E,
      abi: erc20Abi,
      functionName: "allowance",
      args: [proxyAddress, CTF_EXCHANGE],
    });
    const usdcApproved = usdcAllowance > BigInt(0);

    // Check one outcome token approval (CTF → CTF Exchange)
    const tokenApproved = await publicClient.readContract({
      address: CTF,
      abi: ERC1155_APPROVAL_ABI,
      functionName: "isApprovedForAll",
      args: [proxyAddress, CTF_EXCHANGE],
    });
    const tokensApproved = Boolean(tokenApproved);

    return {
      allApproved: usdcApproved && tokensApproved,
      usdcApproved,
      tokensApproved,
    };
  } catch {
    // If reads fail, proxy likely isn't deployed yet
    return { allApproved: false, usdcApproved: false, tokensApproved: false };
  }
}

export { polygon, USDC_E, CTF, CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER };
