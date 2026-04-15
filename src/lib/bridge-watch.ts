/**
 * Chain-activity probes for deposit-address watching.
 *
 * Each deposit address returned by bridge.polymarket.com is freshly derived
 * per user, so it starts with zero balance and zero prior activity. Any
 * non-zero balance OR any transaction history on the address means the user
 * has deposited (or the bridge has already swept).
 *
 * We detect with two signals:
 *   1. Current balance > 0 (caught before bridge sweep)
 *   2. transactionCount > 0 / signature count > 0 (caught even after sweep)
 *
 * Returns the block/tx timestamp when detected so the pending indicator can
 * anchor its countdown to the real wall-clock start rather than guessing.
 */

import { createPublicClient, erc20Abi, http } from "viem";
import {
  arbitrum,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";

export interface WatchResult {
  detected: boolean;
  /** Epoch ms of the detected tx (block timestamp). Falls back to now(). */
  txTime?: number;
}

// Public RPCs we can hit without an API key. drpc.org is the same provider
// wagmi's Polygon config uses.
const EVM_CHAINS: Record<string, { chain: typeof mainnet; rpc: string; usdc: `0x${string}` }> = {
  "1": {
    chain: mainnet,
    rpc: "https://eth.drpc.org",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  "137": {
    chain: polygon,
    rpc: "https://polygon.drpc.org",
    usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  },
  "8453": {
    chain: base,
    rpc: "https://base.drpc.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "42161": {
    chain: arbitrum,
    rpc: "https://arbitrum.drpc.org",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  "10": {
    chain: optimism,
    rpc: "https://optimism.drpc.org",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  "56": {
    chain: bsc,
    rpc: "https://bsc.drpc.org",
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  },
};

const SOLANA_CHAIN_ID = "1151111081099710";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

export function isWatchableChain(chainId: string): boolean {
  return chainId in EVM_CHAINS || chainId === SOLANA_CHAIN_ID;
}

async function checkEvm(chainId: string, address: string): Promise<WatchResult> {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg) return { detected: false };

  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });

  // Three parallel probes:
  //   - native balance (catches ETH / MATIC / BNB etc. deposits)
  //   - USDC balance (catches USDC deposits — most common)
  //   - tx nonce (catches addresses that have already been swept by the bridge)
  const addr = address as `0x${string}`;
  const [nativeBal, usdcBal, txCount] = await Promise.allSettled([
    client.getBalance({ address: addr }),
    client.readContract({
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    }),
    client.getTransactionCount({ address: addr }),
  ]);

  const native = nativeBal.status === "fulfilled" ? nativeBal.value : 0n;
  const usdc = usdcBal.status === "fulfilled" ? usdcBal.value : 0n;
  const count = txCount.status === "fulfilled" ? txCount.value : 0;

  if (native > 0n || usdc > 0n || count > 0) {
    // We detected something. Try to pin down when — grab the most recent
    // block and use its timestamp. Good enough; actual tx lookup is costlier.
    try {
      const block = await client.getBlock({ blockTag: "latest" });
      return { detected: true, txTime: Number(block.timestamp) * 1000 };
    } catch {
      return { detected: true, txTime: Date.now() };
    }
  }
  return { detected: false };
}

async function checkSolana(address: string): Promise<WatchResult> {
  // Two probes: recent signatures (catches swept addresses too) + account
  // info (catches unswept, where the account exists with non-zero lamports).
  try {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [address, { limit: 1 }],
      }),
    });
    const data = await res.json();
    const sigs = data?.result as Array<{ blockTime?: number }> | undefined;
    if (sigs && sigs.length > 0) {
      const bt = sigs[0].blockTime;
      return {
        detected: true,
        txTime: bt ? bt * 1000 : Date.now(),
      };
    }
  } catch {
    /* ignore, try balance probe */
  }

  try {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    const data = await res.json();
    const lamports = data?.result?.value as number | undefined;
    if (lamports && lamports > 0) {
      return { detected: true, txTime: Date.now() };
    }
  } catch {
    /* ignore */
  }

  return { detected: false };
}

export async function checkChainActivity(
  chainId: string,
  address: string,
): Promise<WatchResult> {
  if (chainId === SOLANA_CHAIN_ID) return checkSolana(address);
  if (chainId in EVM_CHAINS) return checkEvm(chainId, address);
  return { detected: false };
}
