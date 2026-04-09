import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY = "news-market-links-v3";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface MarketLink {
  headlineIndex: number;
  marketId: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

async function fetchMarketPool() {
  const offsets = [0, 50, 100];
  const results = await Promise.allSettled(
    offsets.map(async (offset) => {
      const res = await fetch(
        `${GAMMA_API}/events?active=true&closed=false&limit=50&order=volume&ascending=false&offset=${offset}`,
        { next: { revalidate: 300 } }
      );
      if (!res.ok) return [];
      return await res.json();
    })
  );

  const seenIds = new Set<string>();
  const markets: { id: string; question: string; slug: string; eventSlug: string; lastTradePrice?: number }[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      for (const m of event.markets || []) {
        if (seenIds.has(m.id) || m.closed || !m.active) continue;
        seenIds.add(m.id);
        markets.push({
          id: m.id,
          question: m.question,
          slug: m.slug,
          eventSlug: event.slug,
          lastTradePrice: m.lastTradePrice,
        });
      }
    }
  }
  return markets;
}

// POST accepts headlines from the client
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = (body.headlines || []).slice(0, 15);

    if (headlines.length === 0) {
      return NextResponse.json({ links: [] });
    }

    const db = getDb();

    // Check cache (keyed by first headline to detect staleness)
    const cacheKey = CACHE_KEY + "-" + headlines[0]?.slice(0, 30).replace(/\W/g, "");
    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, cacheKey))
      .limit(1);

    if (cached) {
      const age = Date.now() - new Date(cached.createdAt).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json(JSON.parse(cached.result));
      }
    }

    // Fetch market pool
    const allMarkets = await fetchMarketPool();
    if (allMarkets.length === 0) return NextResponse.json({ links: [] });

    // Build compact lists
    const headlineList = headlines.map((h, i) => `${i}: ${h}`).join("\n");
    const marketList = allMarkets.slice(0, 150).map((m, i) => `${i}: ${m.question}`).join("\n");

    // Ask GPT to match
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Match news headlines to prediction markets. Find the BEST matching market for EACH headline.

Return JSON array: [{"h": headlineIndex, "m": marketIndex}]

MATCHING RULES:
- Iran war headlines → match to Iran war/ceasefire/regime/military markets
- Israel/Lebanon/Gaza headlines → match to Israel/Middle East conflict markets
- Trump/NATO/politics headlines → match to Trump/election/political markets
- Ukraine/Russia headlines → match to Ukraine/ceasefire/NATO markets
- Crypto headlines → match to Bitcoin/crypto markets
- Be GENEROUS with matching — if a headline is about Iran and there's ANY Iran-related market, match it
- Match as many headlines as possible — aim for 8+ matches out of 15 headlines
- Return valid JSON array only, no explanation`,
        },
        {
          role: "user",
          content: `HEADLINES:\n${headlineList}\n\nMARKETS:\n${marketList}`,
        },
      ],
    });

    const responseText = completion.choices[0]?.message?.content?.trim() || "[]";
    let matches: { h: number; m: number }[] = [];
    try {
      // Handle GPT sometimes wrapping in ```json ... ```
      const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
      matches = JSON.parse(cleaned);
      if (!Array.isArray(matches)) matches = [];
    } catch {
      matches = [];
    }

    const topMarkets = allMarkets.slice(0, 150);
    const links: MarketLink[] = matches
      .filter((match) => match.h >= 0 && match.h < headlines.length && match.m >= 0 && match.m < topMarkets.length)
      .map((match) => {
        const market = topMarkets[match.m];
        return {
          headlineIndex: match.h,
          marketId: market.id,
          question: market.question,
          slug: market.slug,
          eventSlug: market.eventSlug,
          yesPrice: market.lastTradePrice || 0.5,
        };
      });

    const result = { links, updatedAt: new Date().toISOString() };

    // Cache
    const resultJson = JSON.stringify(result);
    if (cached) {
      await db
        .update(consensusCache)
        .set({ result: resultJson, createdAt: new Date() })
        .where(eq(consensusCache.id, cacheKey));
    } else {
      await db.insert(consensusCache).values({
        id: cacheKey,
        marketQuestion: "news-market-links",
        result: resultJson,
      }).onConflictDoUpdate({
        target: consensusCache.id,
        set: { result: resultJson, createdAt: new Date() },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [] });
  }
}

// GET returns cached links (if available)
export async function GET() {
  try {
    const db = getDb();
    // Return any recent cache
    const rows = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.marketQuestion, "news-market-links"))
      .limit(1);

    if (rows.length > 0) {
      const age = Date.now() - new Date(rows[0].createdAt).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json(JSON.parse(rows[0].result));
      }
    }
    return NextResponse.json({ links: [] });
  } catch {
    return NextResponse.json({ links: [] });
  }
}
