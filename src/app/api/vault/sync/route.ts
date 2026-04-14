/**
 * POST /api/vault/sync
 *
 * Incremental event indexer for PolyStreamVault. Scans from the last
 * processed block to `latest`, decodes Deposited/Withdrawn/MaticDispensed
 * events, and updates vault_balances + vault_events in the DB.
 *
 * Invoke from:
 *   - A cron job every ~30s (Vercel cron or external)
 *   - After each admin mutation (deposit/withdraw) for fast convergence
 *   - Manually for debugging
 *
 * Idempotent: (tx_hash, log_index) has a unique constraint in vault_events,
 * so repeated runs over the same block range are safe.
 *
 * No auth on this route in MVP — it's a read-only indexer. If that's too
 * open, gate it behind a CRON_SECRET env var later.
 */
import { NextResponse } from "next/server";
import { decodeEventLog, type Hex } from "viem";
import {
  publicClient,
  getVaultAddress,
  VAULT_ABI,
  DEPOSITED_EVENT,
  WITHDRAWN_EVENT,
  MATIC_DISPENSED_EVENT,
} from "@/lib/vault";
import { getDb, vaultEvents, vaultBalances, vaultSyncState, users } from "@/db";
import { eq, sql } from "drizzle-orm";

const SYNC_ID = "singleton";
// Max blocks per request — Polygon produces a block every ~2s, so this is
// ~1hr of history at a time. Chunk if the diff is larger.
const MAX_BLOCK_RANGE = 2000;
// Start block for fresh indexers — fetched from VAULT_DEPLOY_BLOCK env,
// falls back to "recent" to avoid scanning millions of old blocks.
const DEFAULT_START_LOOKBACK = 100;

export async function POST() {
  if (!process.env.VAULT_ADDRESS) {
    return NextResponse.json({ error: "VAULT_ADDRESS not configured" }, { status: 503 });
  }

  const client = publicClient();
  const db = getDb();
  const vaultAddr = getVaultAddress();

  const latest = await client.getBlockNumber();

  // Find where to start
  let startBlock: bigint;
  const state = await db.select().from(vaultSyncState).where(eq(vaultSyncState.id, SYNC_ID)).limit(1);
  if (state[0]) {
    startBlock = BigInt(state[0].lastProcessedBlock) + BigInt(1);
  } else {
    const deployBlock = process.env.VAULT_DEPLOY_BLOCK
      ? BigInt(process.env.VAULT_DEPLOY_BLOCK)
      : latest - BigInt(DEFAULT_START_LOOKBACK);
    startBlock = deployBlock;
  }

  if (startBlock > latest) {
    return NextResponse.json({ synced: true, processedBlocks: 0, latest: latest.toString() });
  }

  const endBlock = startBlock + BigInt(MAX_BLOCK_RANGE) - BigInt(1) > latest
    ? latest
    : startBlock + BigInt(MAX_BLOCK_RANGE) - BigInt(1);

  // Fetch all three event types in one call
  const logs = await client.getLogs({
    address: vaultAddr,
    fromBlock: startBlock,
    toBlock: endBlock,
    events: [DEPOSITED_EVENT, WITHDRAWN_EVENT, MATIC_DISPENSED_EVENT],
  });

  let processed = 0;
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: VAULT_ABI,
        data: log.data,
        // viem types `topics` as a tuple; our getLogs call returns a generic
        // array, so cast to the expected shape.
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });

      const eventId = `${log.transactionHash}-${log.logIndex}`;
      const kind = decoded.eventName as "Deposited" | "Withdrawn" | "MaticDispensed";

      let userId: string | null = null;
      let amount: string = "0";
      let counterparty: string | null = null;
      let withdrawIdHex: string | null = null;

      if (kind === "Deposited") {
        const args = decoded.args as { user: string; amount: bigint; by: string };
        userId = args.user.toLowerCase();
        amount = args.amount.toString();
        counterparty = args.by.toLowerCase();
      } else if (kind === "Withdrawn") {
        const args = decoded.args as { user: string; amount: bigint; to: string; withdrawId: Hex };
        userId = args.user.toLowerCase();
        amount = args.amount.toString();
        counterparty = args.to.toLowerCase();
        withdrawIdHex = args.withdrawId;
      } else if (kind === "MaticDispensed") {
        const args = decoded.args as { user: string; amount: bigint };
        userId = args.user.toLowerCase();
        amount = args.amount.toString();
      }

      // Ensure user row exists for FK
      if (userId) {
        await db
          .insert(users)
          .values({
            id: userId,
            authMethod: "wallet",
            walletAddress: userId,
            referralCode: `PS-${userId.slice(2, 10).toUpperCase()}`,
          })
          .onConflictDoNothing();
      }

      // Insert event (idempotent via unique constraint on tx_hash+log_index)
      await db
        .insert(vaultEvents)
        .values({
          id: eventId,
          kind: kind === "Deposited" ? "deposit" : kind === "Withdrawn" ? "withdrawal" : "matic_dispensed",
          userId,
          amount,
          counterparty,
          withdrawId: withdrawIdHex,
          txHash: log.transactionHash,
          logIndex: Number(log.logIndex),
          blockNumber: Number(log.blockNumber),
        })
        .onConflictDoNothing();

      // Update derived balance
      if (userId) {
        await db
          .insert(vaultBalances)
          .values({ userId })
          .onConflictDoNothing();

        if (kind === "Deposited") {
          await db
            .update(vaultBalances)
            .set({
              balance: sql`(${vaultBalances.balance}::numeric + ${amount}::numeric)::text`,
              totalDeposited: sql`(${vaultBalances.totalDeposited}::numeric + ${amount}::numeric)::text`,
              updatedAt: new Date(),
            })
            .where(eq(vaultBalances.userId, userId));
        } else if (kind === "Withdrawn") {
          await db
            .update(vaultBalances)
            .set({
              balance: sql`(${vaultBalances.balance}::numeric - ${amount}::numeric)::text`,
              totalWithdrawn: sql`(${vaultBalances.totalWithdrawn}::numeric + ${amount}::numeric)::text`,
              updatedAt: new Date(),
            })
            .where(eq(vaultBalances.userId, userId));
        } else if (kind === "MaticDispensed") {
          await db
            .update(vaultBalances)
            .set({
              maticDispensed: sql`(${vaultBalances.maticDispensed}::numeric + ${amount}::numeric)::text`,
              hasMaticAirdrop: true,
              updatedAt: new Date(),
            })
            .where(eq(vaultBalances.userId, userId));
        }
      }

      processed++;
    } catch (err) {
      console.error("Failed to process log", log.transactionHash, err);
      // Continue — one bad log shouldn't block the indexer
    }
  }

  // Save cursor
  await db
    .insert(vaultSyncState)
    .values({ id: SYNC_ID, lastProcessedBlock: Number(endBlock) })
    .onConflictDoUpdate({
      target: vaultSyncState.id,
      set: { lastProcessedBlock: Number(endBlock), updatedAt: new Date() },
    });

  return NextResponse.json({
    synced: true,
    fromBlock: startBlock.toString(),
    toBlock: endBlock.toString(),
    processedEvents: processed,
    latest: latest.toString(),
  });
}
