import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { polygon } from "viem/chains";

// GET /api/portfolio/bridge-history?user=<proxyAddress>
//
// Returns USDC.e ERC-20 Transfer events touching the given proxy
// wallet — both incoming (deposits) and outgoing (withdraws). The
// frontend cross-references the resulting tx hashes with Polymarket's
// /activity feed to subtract trade-settlement transfers; the leftovers
// are real bridge deposits + withdraws.
//
// Reads on-chain Transfer logs directly via Alchemy's Polygon RPC.
// Polygonscan's V1 REST endpoint was deprecated mid-Apr 2026 and now
// returns NOTOK for every request — silently emptied this list until
// anyone noticed. drpc.org (which we use for browser/wagmi) caps free
// eth_getLogs at ~1k blocks practically (despite advertising 10k), so
// it can't reach back far enough for a useful "Recent activity" view.
// Alchemy serves up to 100k-block eth_getLogs ranges with no key on
// their public endpoint, more with `ALCHEMY_API_KEY` set.

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
// USDC.e on Polygon has 6 decimals.
const USDC_DECIMALS = 6;

// Standard ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

// ~2.3 days at Polygon's ~2s block time. Alchemy's free tier handles
// this in a single call, so no chunking needed.
const LOOKBACK_BLOCKS = 100_000n;

// Alchemy's demo key works for low-volume reads without signup. If a
// real key is set we use it (higher rate limits + no risk of demo
// being throttled or removed). Both endpoints expose the same
// alchemy_getAssetTransfers + eth_getLogs surface.
function rpcUrl(): string {
  const key = process.env.ALCHEMY_API_KEY;
  return `https://polygon-mainnet.g.alchemy.com/v2/${key || "demo"}`;
}

interface BridgeTx {
  type: "deposit" | "withdraw";
  amountUsdc: number;
  timestamp: number; // ms
  txHash: string;
  counterparty: string;
}

type TransferLog = Log<bigint, number, false, typeof TRANSFER_EVENT> & {
  args: { from: `0x${string}`; to: `0x${string}`; value: bigint };
};

export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user");
  if (!user || !/^0x[a-fA-F0-9]{40}$/.test(user)) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }
  const userLower = user.toLowerCase() as `0x${string}`;

  const client = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl()),
  });

  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;

    // Two parallel queries — incoming (proxy is the `to`) and outgoing
    // (proxy is the `from`). Can't OR these in a single getLogs call
    // because event topics combine as AND across positions.
    const [incoming, outgoing] = await Promise.all([
      client.getLogs({
        address: USDC_E,
        event: TRANSFER_EVENT,
        args: { to: userLower },
        fromBlock,
        toBlock: latest,
      }),
      client.getLogs({
        address: USDC_E,
        event: TRANSFER_EVENT,
        args: { from: userLower },
        fromBlock,
        toBlock: latest,
      }),
    ]) as [TransferLog[], TransferLog[]];

    const allLogs: TransferLog[] = [...incoming, ...outgoing];
    if (allLogs.length === 0) return NextResponse.json({ bridges: [] });

    // Stamp every log with its block timestamp. One getBlock per unique
    // block — usually only a handful even when the log count is high.
    const uniqueBlocks = Array.from(new Set(allLogs.map((l) => l.blockNumber)));
    const blockTimes = new Map<bigint, number>();
    await Promise.all(
      uniqueBlocks.map(async (n) => {
        try {
          const block = await client.getBlock({ blockNumber: n });
          blockTimes.set(n, Number(block.timestamp) * 1000);
        } catch {
          blockTimes.set(n, 0);
        }
      })
    );

    const bridges: BridgeTx[] = allLogs
      .map((log) => {
        const isDeposit = log.args.to.toLowerCase() === userLower;
        const amount = Number(log.args.value) / 10 ** USDC_DECIMALS;
        return {
          type: (isDeposit ? "deposit" : "withdraw") as BridgeTx["type"],
          amountUsdc: amount,
          timestamp: blockTimes.get(log.blockNumber) ?? 0,
          txHash: log.transactionHash,
          counterparty: isDeposit ? log.args.from : log.args.to,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json({ bridges });
  } catch (err) {
    console.error("Bridge history error:", err);
    return NextResponse.json({ bridges: [] });
  }
}
