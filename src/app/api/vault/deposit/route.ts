/**
 * POST /api/vault/deposit
 *
 * Gasless deposit into PolyStreamVault. User signs an EIP-2612 permit on the
 * USDC.e token (spender = vault, value = amount, deadline). Backend admin
 * relays that signature to the vault via depositWithPermit — admin pays the
 * gas, user pays $0 in MATIC.
 *
 * Auth: the Authorization header must match body.userId (same pattern as
 * other user-scoped routes). The permit signature itself is additional
 * cryptographic proof of intent — without the user's private key, you can't
 * forge a valid permit.
 *
 * Body:
 *   {
 *     userId:   "0x...",                 // user's Polygon EOA
 *     amount:   "3400000",               // USDC.e smallest units (6 decimals)
 *     deadline: 1776146511,              // unix seconds, permit expiry
 *     v: 27 | 28,                        // signature v
 *     r: "0x...",                        // signature r (32 bytes hex)
 *     s: "0x..."                         // signature s (32 bytes hex)
 *   }
 *
 * Response: { success: true, txHash } | { error: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { isAddress, isHex, type Hex } from "viem";
import { writeVault } from "@/lib/vault";
import { getDb, vaultBalances, users } from "@/db";
import { eq } from "drizzle-orm";

interface Body {
  userId: string;
  amount: string;
  deadline: number;
  v: number;
  r: string;
  s: string;
}

export async function POST(req: NextRequest) {
  if (!process.env.OWNER_PRIVATE_KEY || !process.env.VAULT_ADDRESS) {
    return NextResponse.json(
      { error: "Vault not configured (missing OWNER_PRIVATE_KEY or VAULT_ADDRESS)" },
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

  const { userId, amount, deadline, v, r, s } = body;

  if (!userId || !auth || auth.toLowerCase() !== userId.toLowerCase()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAddress(userId)) {
    return NextResponse.json({ error: "Invalid userId (must be EVM address)" }, { status: 400 });
  }
  if (!amount || typeof amount !== "string") {
    return NextResponse.json({ error: "Missing amount" }, { status: 400 });
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
  if (!Number.isInteger(deadline) || deadline < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "Permit expired or invalid deadline" }, { status: 400 });
  }
  if (v !== 27 && v !== 28 && v !== 0 && v !== 1) {
    return NextResponse.json({ error: "Invalid v" }, { status: 400 });
  }
  if (!isHex(r) || !isHex(s)) {
    return NextResponse.json({ error: "Invalid signature r/s" }, { status: 400 });
  }

  // Upsert the user row in case they're brand new (vaultBalances FKs users.id)
  const db = getDb();
  await db
    .insert(users)
    .values({
      id: userId.toLowerCase(),
      authMethod: "wallet",
      walletAddress: userId,
      referralCode: `PS-${userId.slice(2, 10).toUpperCase()}`,
    })
    .onConflictDoNothing();

  // Submit the permit tx via admin
  try {
    const vault = writeVault();
    const txHash = await vault.write.depositWithPermit([
      userId as `0x${string}`,
      amountBig,
      BigInt(deadline),
      v as number,
      r as Hex,
      s as Hex,
    ]);

    // Ensure a vault_balances row exists so the sync job doesn't race the
    // upsert on first deposit. We don't credit here — the indexer handles
    // that via the Deposited event to keep the DB a faithful mirror.
    await db
      .insert(vaultBalances)
      .values({ userId: userId.toLowerCase() })
      .onConflictDoNothing();

    return NextResponse.json({ success: true, txHash });
  } catch (err) {
    const msg = (err as Error).message || "Vault deposit failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
