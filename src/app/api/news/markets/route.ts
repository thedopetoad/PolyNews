import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY = "news-market-links";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface MarketLink {
  headlineIndex: number;
  marketId: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

async function fetchMarketPool(): Promise<{ id: string; question: string; slug: string; eventSlug: string; lastTradePrice?: number }[]> {
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

export async function GET() {
  try {
    const db = getDb();

    // Check cache
    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, CACHE_KEY))
      .limit(1);

    if (cached) {
      const age = Date.now() - new Date(cached.createdAt).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json(JSON.parse(cached.result));
      }
    }

    // Fetch headlines
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const newsRes = await fetch(`${baseUrl}/api/news`, { next: { revalidate: 300 } });
    if (!newsRes.ok) return NextResponse.json({ links: [] });
    const newsData = await newsRes.json();
    const headlines: { title: string }[] = (newsData.headlines || []).slice(0, 15);

    if (headlines.length === 0) return NextResponse.json({ links: [] });

    // Fetch market pool
    const allMarkets = await fetchMarketPool();
    if (allMarkets.length === 0) return NextResponse.json({ links: [] });

    // Build compact lists
    const headlineList = headlines.map((h, i) => `${i}: ${h.title}`).join("\n");
    const marketList = allMarkets.slice(0, 150).map((m, i) => `${i}: ${m.question}`).join("\n");

    // Ask GPT to match headlines to markets
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You match news headlines to prediction markets. For each headline, find the SINGLE most relevant prediction market (if any).

Return a JSON array of objects: [{"h": headlineIndex, "m": marketIndex}]

RULES:
- Only match if the headline is DIRECTLY about the same topic as the market
- Skip headlines with no relevant market (don't force matches)
- Maximum one market per headline
- Return valid JSON only, nothing else`,
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
      matches = JSON.parse(responseText);
      if (!Array.isArray(matches)) matches = [];
    } catch {
      matches = [];
    }

    // Build market links
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
        .where(eq(consensusCache.id, CACHE_KEY));
    } else {
      await db.insert(consensusCache).values({
        id: CACHE_KEY,
        marketQuestion: "news-market-links",
        result: resultJson,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [] });
  }
}
