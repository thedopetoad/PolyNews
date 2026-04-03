import { NextResponse } from "next/server";

const GAMMA_API = "https://gamma-api.polymarket.com";

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  outcomePrices: string;
  outcomes: string;
  clobTokenIds: string;
  volume: string;
  liquidity: string;
  [key: string]: unknown;
}

interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  endDate: string;
  markets: GammaMarket[];
}

async function fetchBtc5mEvent(windowTs: number): Promise<GammaEvent | null> {
  try {
    const slug = `btc-updown-5m-${windowTs}`;
    const res = await fetch(`${GAMMA_API}/events?slug=${slug}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    const events: GammaEvent[] = await res.json();
    return events.length > 0 ? events[0] : null;
  } catch {
    return null;
  }
}

/**
 * Fetch real-time CLOB midpoint price for a token
 */
async function getClobPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.mid === "string" ? parseFloat(data.mid) : (data.mid ?? null);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const currentWindow = Math.floor(nowSec / 300) * 300;
    const previousWindow = currentWindow - 300;

    // Fetch current and previous markets in parallel
    const [activeEvent, previousEvent] = await Promise.all([
      fetchBtc5mEvent(currentWindow),
      fetchBtc5mEvent(previousWindow),
    ]);

    const activeMarket = activeEvent?.markets?.[0] || null;
    const previousMarket = previousEvent?.markets?.[0] || null;

    // Get live CLOB price for the active market
    let upPrice = 0.5;
    let downPrice = 0.5;
    if (activeMarket?.clobTokenIds) {
      try {
        const tokenIds = JSON.parse(activeMarket.clobTokenIds);
        if (tokenIds[0]) {
          const price = await getClobPrice(tokenIds[0]);
          if (price !== null && price > 0 && price < 1) {
            upPrice = price;
            downPrice = 1 - price;
          }
        }
      } catch {}
    }

    // Determine resolution outcome of previous market
    let previousResolved = false;
    let previousOutcome: string | null = null;
    if (previousMarket?.closed) {
      previousResolved = true;
      try {
        const prices = JSON.parse(previousMarket.outcomePrices);
        const outcomes = JSON.parse(previousMarket.outcomes);
        const upIdx = outcomes.indexOf("Up");
        const downIdx = outcomes.indexOf("Down");
        if (parseFloat(prices[upIdx]) > 0.5) previousOutcome = "Up";
        else if (parseFloat(prices[downIdx]) > 0.5) previousOutcome = "Down";
      } catch {}
    }

    // Calculate time remaining in the current window
    const windowEndSec = currentWindow + 300;
    const secondsRemaining = Math.max(0, windowEndSec - nowSec);

    return NextResponse.json({
      active: activeMarket ? {
        id: activeMarket.id,
        question: activeMarket.question,
        slug: activeMarket.slug,
        endDate: activeMarket.endDate,
        marketId: activeMarket.id,
        conditionId: activeMarket.conditionId,
        upPrice,
        downPrice,
        volume: activeMarket.volume,
        windowStart: currentWindow,
        windowEnd: windowEndSec,
        secondsRemaining,
      } : null,
      previous: previousMarket ? {
        id: previousMarket.id,
        marketId: previousMarket.id,
        question: previousMarket.question,
        closed: previousMarket.closed,
        resolved: previousResolved,
        outcome: previousOutcome,
      } : null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch BTC 5-min market" }, { status: 502 });
  }
}
