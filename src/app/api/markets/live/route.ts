import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getDb, consensusCache, youtubeStreamCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const CACHE_KEY = "live-markets-v2";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface MarketEntry {
  id: string;
  question: string;
  slug: string;
  eventSlug: string;
  volume: string;
  endDate: string;
  clobTokenIds: string;
  lastTradePrice?: number;
}

// Fetch live stream titles from DB cache
async function getStreamTitles(): Promise<string[]> {
  try {
    const db = getDb();
    const cached = await db.select().from(youtubeStreamCache);
    const titles: string[] = [];
    for (const row of cached) {
      try {
        const streams = JSON.parse(row.streams);
        for (const s of streams) if (s.title) titles.push(s.title);
      } catch {}
    }
    return titles;
  } catch {
    return [];
  }
}

// Fetch RSS headlines server-side
async function getHeadlines(): Promise<string[]> {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/news`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.headlines || []).slice(0, 15).map((h: { title: string }) => h.title);
  } catch {
    return [];
  }
}

// Fetch a large pool of events from Gamma API sorted by volume (no tag filter)
async function fetchMarketPool(): Promise<MarketEntry[]> {
  // Fetch 4 pages of 50 = up to 200 events
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

  const seenIds = new Set<string>();
  const markets: MarketEntry[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      for (const m of (event.markets || [])) {
        if (seenIds.has(m.id) || m.closed || !m.active) continue;
        seenIds.add(m.id);
        markets.push({
          id: m.id,
          question: m.question,
          slug: m.slug,
          eventSlug: event.slug,
          volume: m.volume,
          endDate: m.endDate,
          clobTokenIds: m.clobTokenIds || "[]",
          lastTradePrice: m.lastTradePrice,
        });
      }
    }
  }

  return markets;
}

// Get CLOB midpoint price
async function getClobPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${CLOB_API}/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.mid ? parseFloat(data.mid) : null;
  } catch {
    return null;
  }
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

    // Gather all context in parallel
    const [streamTitles, headlines, allMarkets] = await Promise.all([
      getStreamTitles(),
      getHeadlines(),
      fetchMarketPool(),
    ]);

    if (allMarkets.length === 0) {
      return NextResponse.json({ markets: [], context: "No markets available" });
    }

    // Build the news context
    const newsContext = headlines.join("\n");

    // Build compact market list (index: question) — send ALL markets to GPT
    const marketList = allMarkets
      .map((m, i) => `${i}: ${m.question}`)
      .join("\n");

    // Single GPT call: give it the headlines and ALL markets, let it pick
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You match prediction markets to breaking news. Given current headlines and a list of prediction markets, pick the 8-10 markets that are DIRECTLY related to the news topics being discussed.

RULES:
- Only pick markets that are clearly about the same topics as the headlines
- If headlines are about Iran/war, pick Iran/war markets — NOT unrelated politics
- If headlines are about crypto, pick crypto markets
- Prioritize markets about CURRENT events, not distant future speculation
- Return ONLY a JSON array of index numbers, nothing else`
        },
        {
          role: "user",
          content: `CURRENT HEADLINES:\n${newsContext}\n\nLIVE STREAMS:\n${streamTitles.join("\n")}\n\nAVAILABLE MARKETS:\n${marketList}\n\nReturn a JSON array of the 8-10 most relevant market indices.`
        },
      ],
    });

    const responseText = completion.choices[0]?.message?.content?.trim() || "[]";
    let selectedIndices: number[] = [];
    try {
      selectedIndices = JSON.parse(responseText);
      if (!Array.isArray(selectedIndices)) selectedIndices = [];
    } catch {
      const matches = responseText.match(/\d+/g);
      if (matches) selectedIndices = matches.map(Number);
    }

    const selected = selectedIndices
      .filter((i) => i >= 0 && i < allMarkets.length)
      .slice(0, 10)
      .map((i) => allMarkets[i]);

    // Enrich with live CLOB prices
    const enriched = await Promise.all(
      selected.map(async (m) => {
        let yesPrice = m.lastTradePrice || 0.5;
        let noPrice = 1 - yesPrice;

        try {
          const ids = JSON.parse(m.clobTokenIds);
          if (ids[0]) {
            const mid = await getClobPrice(ids[0]);
            if (mid !== null) {
              yesPrice = mid;
              noPrice = 1 - mid;
            }
          }
        } catch {}

        return {
          id: m.id,
          question: m.question,
          slug: m.slug,
          eventSlug: m.eventSlug,
          volume: m.volume,
          endDate: m.endDate,
          yesPrice,
          noPrice,
        };
      })
    );

    const result = {
      markets: enriched,
      context: newsContext.slice(0, 200),
      updatedAt: new Date().toISOString(),
    };

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
        marketQuestion: "live-market-selection-v2",
        result: resultJson,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Live markets error:", err);
    return NextResponse.json({ markets: [], error: "Failed to fetch live markets" }, { status: 500 });
  }
}
