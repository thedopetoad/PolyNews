/**
 * GET /api/vault/balance?userId=0x...
 *
 * Returns the user's vault balance from our DB (reconciled against on-chain
 * events by /api/vault/sync). Portfolio reads this instead of the wallet's
 * USDC.e balance.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb, vaultBalances } from "@/db";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.toLowerCase();
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const row = await getDb()
    .select()
    .from(vaultBalances)
    .where(eq(vaultBalances.userId, userId))
    .limit(1);

  if (row.length === 0) {
    return NextResponse.json({
      userId,
      balance: "0",
      totalDeposited: "0",
      totalWithdrawn: "0",
      maticDispensed: "0",
      hasMaticAirdrop: false,
    });
  }

  return NextResponse.json(row[0]);
}
