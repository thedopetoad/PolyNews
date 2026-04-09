import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY = "news-mkt-v13";

// Normalize headline for comparison (strip special chars, lowercase)
function normalizeTitle(t: string): string {
  return t.replace(/[^\w\s]/g, "").toLowerCase().trim().slice(0, 60);
}

interface MarketLink {
  headlineTitle: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

interface CachedData {
  links: MarketLink[];
  processedTitles: string[];
  updatedAt: string;
}

// Search Gamma API for REAL markets matching keywords
async function searchGammaMarkets(keywords: string[]): Promise<{ question: string; slug: string; eventSlug: string; yesPrice: number }[]> {
  // Fetch large pool of active events
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

  const allMarkets: { question: string; slug: string; eventSlug: string; yesPrice: number }[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      for (const m of event.markets || []) {
        if (m.closed || !m.active || seen.has(m.id)) continue;
        seen.add(m.id);
        allMarkets.push({
          question: m.question,
          slug: m.slug,
          eventSlug: event.slug,
          yesPrice: m.lastTradePrice || 0.5,
        });
      }
    }
  }

  // Filter by keywords
  const matched: typeof allMarkets = [];
  for (const market of allMarkets) {
    const q = market.question.toLowerCase();
    if (keywords.some((kw) => q.includes(kw.toLowerCase()))) {
      matched.push(market);
    }
  }

  return matched;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = (body.headlines || []).slice(0, 15);
    if (headlines.length === 0) return NextResponse.json({ links: [] });

    const db = getDb();

    // Load existing cache
    const [cached] = await db.select().from(consensusCache).where(eq(consensusCache.id, CACHE_KEY)).limit(1);
    let existing: CachedData = cached
      ? JSON.parse(cached.result)
      : { links: [], processedTitles: [], updatedAt: "" };

    // Find unprocessed headlines (normalize for comparison)
    const processedSet = new Set(existing.processedTitles.map(normalizeTitle));
    const unprocessed = headlines.filter((h) => !processedSet.has(normalizeTitle(h)));
    if (unprocessed.length === 0 || existing.processedTitles.length >= 20) {
      return NextResponse.json({ links: existing.links, remaining: 0 });
    }

    // Process next 3
    const batch = unprocessed.slice(0, 3);

    // Step 1: Ask GPT for search keywords for each headline (cheap, fast, no web search)
    const keywordResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `For each headline, extract 3-5 single-word keywords that would appear in related prediction market questions on Polymarket.

Examples:
"Iran War Cease-Fire Tested by Confusion Over Strait" → ["iran", "ceasefire", "strait", "hormuz"]
"Trump slams NATO over Iran" → ["nato", "trump", "iran"]
"Israel bombed Beirut" → ["israel", "lebanon", "strike", "beirut"]
"Man rescued from Mexico mine" → ["mexico"]

Return JSON: [{"h": "headline text", "kw": ["word1", "word2"]}]
ONLY return valid JSON.`,
        },
        {
          role: "user",
          content: batch.map((h, i) => `${i}: ${h}`).join("\n"),
        },
      ],
    });

    let kwResults: { h: string; kw: string[] }[] = [];
    try {
      const cleaned = (keywordResponse.choices[0]?.message?.content || "[]").replace(/```json\n?|\n?```/g, "").trim();
      kwResults = JSON.parse(cleaned);
      if (!Array.isArray(kwResults)) kwResults = [];
    } catch {
      kwResults = [];
    }

    // Step 2: Search Gamma API with those keywords (REAL markets, verified slugs)
    const allKeywords = kwResults.flatMap((r) => r.kw || []);
    const uniqueKeywords = [...new Set(allKeywords)].filter((k) => k.length > 2);
    const gammaMarkets = await searchGammaMarkets(uniqueKeywords);

    // Step 3: Ask GPT to match headlines to the REAL markets found
    if (gammaMarkets.length === 0) {
      // No markets found — still mark as processed
      const updated: CachedData = {
        links: existing.links,
        processedTitles: [...existing.processedTitles, ...batch],
        updatedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(updated);
      if (cached) {
        await db.update(consensusCache).set({ result: json, createdAt: new Date() }).where(eq(consensusCache.id, CACHE_KEY));
      } else {
        await db.insert(consensusCache).values({ id: CACHE_KEY, marketQuestion: "news-market-links", result: json });
      }
      return NextResponse.json({ links: updated.links, remaining: unprocessed.length - batch.length });
    }

    // Deduplicate similar markets (keep highest volume)
    const deduped = new Map<string, typeof gammaMarkets[0]>();
    for (const m of gammaMarkets) {
      const key = m.question.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2},?\s*20\d{2})\b/gi, "").trim().toLowerCase();
      if (!deduped.has(key)) deduped.set(key, m);
    }
    const uniqueMarkets = [...deduped.values()].slice(0, 30);

    const marketList = uniqueMarkets.map((m, i) => `${i}: ${m.question}`).join("\n");
    const headlineList = batch.map((h, i) => `${i}: ${h}`).join("\n");

    const matchResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Match headlines to prediction markets. Pick up to 3 DIRECTLY related markets per headline.

RULES:
✅ Same topic, same country, same event = MATCH
❌ Different topic, different context = NO MATCH
❌ "Iran war" → "Iran FIFA World Cup" = NO
❌ "Trump NATO" → "Trump 2028 election" = NO

Return: [{"h": 0, "m": [1, 5, 8]}]
ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `HEADLINES:\n${headlineList}\n\nMARKETS:\n${marketList}`,
        },
      ],
    });

    let matches: { h: number; m: number[] }[] = [];
    try {
      const cleaned = (matchResponse.choices[0]?.message?.content || "[]").replace(/```json\n?|\n?```/g, "").trim();
      matches = JSON.parse(cleaned);
      if (!Array.isArray(matches)) matches = [];
    } catch {
      matches = [];
    }

    // Build new links
    const existingSlugs = new Set(existing.links.map((l) => l.slug));
    const newLinks: MarketLink[] = [];

    for (const match of matches) {
      if (match.h < 0 || match.h >= batch.length || !Array.isArray(match.m)) continue;
      for (const mi of match.m.slice(0, 3)) {
        if (mi < 0 || mi >= uniqueMarkets.length) continue;
        const market = uniqueMarkets[mi];
        if (existingSlugs.has(market.slug)) continue;
        existingSlugs.add(market.slug);
        newLinks.push({
          headlineTitle: batch[match.h],
          question: market.question,
          slug: market.slug,
          eventSlug: market.eventSlug,
          yesPrice: market.yesPrice,
        });
      }
    }

    // Save
    const updated: CachedData = {
      links: [...existing.links, ...newLinks],
      processedTitles: [...existing.processedTitles, ...batch],
      updatedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(updated);
    if (cached) {
      await db.update(consensusCache).set({ result: json, createdAt: new Date() }).where(eq(consensusCache.id, CACHE_KEY));
    } else {
      await db.insert(consensusCache).values({ id: CACHE_KEY, marketQuestion: "news-market-links", result: json });
    }

    return NextResponse.json({
      links: updated.links,
      remaining: unprocessed.length - batch.length,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [] });
  }
}

export async function GET() {
  try {
    const db = getDb();
    const [cached] = await db.select().from(consensusCache).where(eq(consensusCache.id, CACHE_KEY)).limit(1);
    if (cached) {
      const data: CachedData = JSON.parse(cached.result);
      // Always return remaining > 0 so the frontend keeps polling via POST
      const remaining = data.processedTitles.length < 20 ? 1 : 0;
      return NextResponse.json({ links: data.links, remaining });
    }
    return NextResponse.json({ links: [], remaining: 1 });
  } catch {
    return NextResponse.json({ links: [], remaining: 1 });
  }
}
