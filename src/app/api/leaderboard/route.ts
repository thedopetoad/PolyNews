import { NextRequest, NextResponse } from "next/server";
import { getDb, users } from "@/db";
import { positions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

async function fetchLivePrices(tokenIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const unique = [...new Set(tokenIds.filter(Boolean))];
  if (unique.length === 0) return prices;

  const results = await Promise.allSettled(
    unique.map(async (tokenId) => {
      const res = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const mid = parseFloat(data.mid);
      if (!isNaN(mid)) prices.set(tokenId, mid);
    })
  );

  return prices;
}

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const authedUser = getAuthenticatedUser(request);

    // Get all users
    const allUsers = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        balance: users.balance,
      })
      .from(users);

    // Get all open positions
    const allPositions = await db
      .select({
        userId: positions.userId,
        shares: positions.shares,
        avgPrice: positions.avgPrice,
        clobTokenId: positions.clobTokenId,
      })
      .from(positions);

    // Fetch live prices for all position tokens
    const tokenIds = allPositions.map((p) => p.clobTokenId).filter(Boolean) as string[];
    const livePrices = await fetchLivePrices(tokenIds);

    // Group positions by user and calculate position value with live prices
    const positionValueByUser = new Map<string, number>();
    for (const pos of allPositions) {
      const price = (pos.clobTokenId && livePrices.get(pos.clobTokenId)) || pos.avgPrice;
      const value = pos.shares * price;
      positionValueByUser.set(pos.userId, (positionValueByUser.get(pos.userId) || 0) + value);
    }

    // Calculate portfolio value and sort
    const ranked = allUsers
      .map((u) => ({
        ...u,
        portfolioValue: u.balance + (positionValueByUser.get(u.id) || 0),
      }))
      .sort((a, b) => b.portfolioValue - a.portfolioValue)
      .slice(0, 50);

    // Mask wallet addresses for privacy — only show to the user themselves
    const masked = ranked.map((u) => ({
      id: u.id === authedUser ? u.id : u.id.startsWith("0x")
        ? `${u.id.slice(0, 6)}...${u.id.slice(-4)}`
        : u.id.slice(0, 8) + "...",
      displayName: u.displayName,
      balance: Math.round(u.portfolioValue),
    }));

    return NextResponse.json(
      { leaderboard: masked },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
