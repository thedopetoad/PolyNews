/**
 * POST /api/vault/withdraw
 *
 * Admin-signed withdrawal from PolyStreamVault to a destination address.
 * Same-chain Polygon USDC.e only in MVP — cross-chain withdrawals (Relay
 * bridge from vault → user's destination on Solana/Ethereum/etc.) are
 * deferred to a follow-up iteration.
 *
 * Auth: Authorization Bearer must match body.userId.
 *
 * Body:
 *   { userId: "0x...", amount: "3400000", toAddress: "0x..." }
 *
 * Response: { success, txHash, withdrawalId } | { error }
 */
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { writeVault, withdrawIdFor } from "@/lib/vault";
import { getDb, vaultBalances, vaultWithdrawals } from "@/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

interface Body {
  userId: string;
  amount: string;                 // USDC.e smallest units
  toAddress: string;              // Polygon EVM destination
}

export async function POST(req: NextRequest) {
  if (!process.env.OWNER_PRIVATE_KEY || !process.env.VAULT_ADDRESS) {
    return NextResponse.json(
      { error: "Vault not configured" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, amount, toAddress } = body;
  if (!userId || !auth || auth.toLowerCase() !== userId.toLowerCase()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAddress(userId) || !isAddress(toAddress)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  let amountBig: bigint;
  try {
    amountBig = BigInt(amount);
  } catch {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (amountBig <= BigInt(0)) {
    return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  }

  const db = getDb();

  // Balance check — against DB, since that's our source of truth (reconciled
  // from on-chain events). Defense in depth: the contract ALSO reverts on
  // insufficient balance in balanceOf, so a stale DB can't drain.
  const balanceRow = await db
    .select()
    .from(vaultBalances)
    .where(eq(vaultBalances.userId, userId.toLowerCase()))
    .limit(1);
  const currentBalance = balanceRow[0] ? BigInt(balanceRow[0].balance) : BigInt(0);
  if (currentBalance < amountBig) {
    return NextResponse.json(
      { error: "Insufficient vault balance", available: currentBalance.toString() },
      { status: 400 },
    );
  }

  // Create a DB record FIRST so there's idempotency if the tx broadcast retries.
  const withdrawalId = randomUUID();
  await db.insert(vaultWithdrawals).values({
    id: withdrawalId,
    userId: userId.toLowerCase(),
    amount: amountBig.toString(),
    toAddress: toAddress.toLowerCase(),
    toChainId: 137,
    status: "signing",
  });

  const withdrawIdBytes32 = withdrawIdFor(withdrawalId);

  try {
    const vault = writeVault();
    const txHash = await vault.write.withdraw([
      userId as `0x${string}`,
      amountBig,
      toAddress as `0x${string}`,
      withdrawIdBytes32,
    ]);

    await db
      .update(vaultWithdrawals)
      .set({ status: "broadcast", txHash, updatedAt: new Date() })
      .where(eq(vaultWithdrawals.id, withdrawalId));

    return NextResponse.json({ success: true, txHash, withdrawalId });
  } catch (err) {
    const msg = (err as Error).message || "Vault withdraw failed";
    await db
      .update(vaultWithdrawals)
      .set({ status: "failed", error: msg, updatedAt: new Date() })
      .where(eq(vaultWithdrawals.id, withdrawalId));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
