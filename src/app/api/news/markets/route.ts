import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY_PREFIX = "news-mkt-v5-";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface MarketLink {
  headlineIndex: number;
  marketId: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

async function fetchMarketPool() {
  // Fetch 200 events sorted by volume
  const offsets = [0, 50, 100, 150];
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

  const seenQuestions = new Set<string>();
  const markets: { id: string; question: string; slug: string; eventSlug: string; lastTradePrice?: number }[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      for (const m of event.markets || []) {
        if (m.closed || !m.active) continue;
        // Deduplicate by question (many similar markets like "ceasefire by X date")
        const qKey = m.question.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2})\b/gi, "").trim();
        if (seenQuestions.has(qKey)) continue;
        seenQuestions.add(qKey);
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = (body.headlines || []).slice(0, 15);
    if (headlines.length === 0) return NextResponse.json({ links: [] });

    const db = getDb();
    const cacheKey = CACHE_KEY_PREFIX + headlines[0]?.slice(0, 20).replace(/\W/g, "");

    // Check cache
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

    const allMarkets = await fetchMarketPool();
    if (allMarkets.length === 0) return NextResponse.json({ links: [] });

    const headlineList = headlines.map((h, i) => `${i}: ${h}`).join("\n");
    const marketList = allMarkets.slice(0, 200).map((m, i) => `${i}: ${m.question}`).join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You match news headlines to prediction markets. For EACH headline, find up to 3 relevant prediction markets.

Return a JSON array: [{"h": 0, "m": [12, 45, 67]}, {"h": 1, "m": [3, 89]}, ...]

Where "h" is the headline index and "m" is an array of up to 3 market indices.

IMPORTANT RULES:
- "Iran War" headlines should match Iran ceasefire, Iran regime, US invade Iran, Iran leadership markets — NOT "Iran FIFA World Cup"
- "Israel bombed" headlines should match Israel strikes, Israel conflict markets
- "Trump NATO" headlines should match Trump election, NATO markets
- "Ceasefire" headlines should match ceasefire markets
- Ignore sports markets unless the headline is about sports
- Be GENEROUS — if a headline mentions a country/topic and a market exists about that country/topic, MATCH IT
- Return 1-3 markets per headline, ranked by relevance
- Return VALID JSON only`,
        },
        {
          role: "user",
          content: `NEWS HEADLINES:\n${headlineList}\n\nPREDICTION MARKETS:\n${marketList}`,
        },
      ],
    });

    const responseText = completion.choices[0]?.message?.content?.trim() || "[]";
    let matches: { h: number; m: number[] }[] = [];
    try {
      const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
      matches = JSON.parse(cleaned);
      if (!Array.isArray(matches)) matches = [];
    } catch {
      matches = [];
    }

    const topMarkets = allMarkets.slice(0, 200);
    const links: MarketLink[] = [];

    for (const match of matches) {
      if (match.h < 0 || match.h >= headlines.length) continue;
      const marketIndices = Array.isArray(match.m) ? match.m : [match.m];
      for (const mi of marketIndices.slice(0, 3)) {
        if (mi < 0 || mi >= topMarkets.length) continue;
        const market = topMarkets[mi];
        links.push({
          headlineIndex: match.h,
          marketId: market.id,
          question: market.question,
          slug: market.slug,
          eventSlug: market.eventSlug,
          yesPrice: market.lastTradePrice || 0.5,
        });
      }
    }

    const result = { links, updatedAt: new Date().toISOString() };
    const resultJson = JSON.stringify(result);

    await db.insert(consensusCache).values({
      id: cacheKey,
      marketQuestion: "news-market-links",
      result: resultJson,
    }).onConflictDoUpdate({
      target: consensusCache.id,
      set: { result: resultJson, createdAt: new Date() },
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [] });
  }
}

export async function GET() {
  try {
    const db = getDb();
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
