import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY_PREFIX = "news-mkt-v6-";

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

    // Cache key = hash of all headline titles. New headline = new key = fresh search
    const headlineHash = crypto.createHash("sha256").update(headlines.join("|")).digest("hex").slice(0, 16);
    const cacheKey = CACHE_KEY_PREFIX + headlineHash;

    // Check cache — if headlines haven't changed, return cached result (no TTL needed)
    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, cacheKey))
      .limit(1);

    if (cached) {
      return NextResponse.json(JSON.parse(cached.result));
    }

    // PASS 0: Web search Polymarket for markets related to headline topics
    let webSearchMarkets: { question: string; slug: string }[] = [];
    try {
      const topicSummary = headlines.slice(0, 10).join("; ");
      const searchResponse = await openai.responses.create({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search_preview" }],
        input: `Search polymarket.com for prediction markets related to these news topics: ${topicSummary}

For each relevant Polymarket market you find, extract:
- The market question
- The event slug from the URL (the part after polymarket.com/event/)

Return a JSON array: [{"question": "...", "slug": "..."}]
Find as many relevant markets as possible (aim for 10-20). Only return the JSON array.`,
      });

      const textOutput = searchResponse.output.find((o) => o.type === "message");
      if (textOutput && textOutput.type === "message") {
        const textContent = textOutput.content.find((c) => c.type === "output_text");
        if (textContent && textContent.type === "output_text") {
          const cleaned = textContent.text.replace(/```json\n?|\n?```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            webSearchMarkets = parsed.filter((m: { question?: string; slug?: string }) => m.question && m.slug);
          }
        }
      }
    } catch {
      // Web search failed — continue with pool only
    }

    const allMarkets = await fetchMarketPool();

    // Merge web search results into the market pool
    for (const wsm of webSearchMarkets) {
      // Only add if not already in pool
      if (!allMarkets.some((m) => m.question === wsm.question || m.slug === wsm.slug)) {
        allMarkets.push({
          id: `ws-${wsm.slug}`,
          question: wsm.question,
          slug: wsm.slug,
          eventSlug: wsm.slug,
          lastTradePrice: undefined,
        });
      }
    }

    if (allMarkets.length === 0) return NextResponse.json({ links: [] });

    const headlineList = headlines.map((h, i) => `${i}: ${h}`).join("\n");
    const marketList = allMarkets.slice(0, 250).map((m, i) => `${i}: ${m.question}`).join("\n");

    // PASS 1: Match headlines to markets
    const pass1 = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You match news headlines to prediction markets. For EACH headline, find up to 3 relevant prediction markets.

Return JSON: [{"h": 0, "m": [12, 45, 67]}, {"h": 1, "m": [3, 89]}, ...]

RULES:
- "Iran War" → Iran ceasefire, Iran regime, US invade Iran markets (NOT "Iran FIFA World Cup")
- "Israel bombed" → Israel strikes, Israel conflict markets
- "Trump/NATO" → Trump election, NATO leave markets
- "Ceasefire" → ceasefire markets
- Ignore sports markets unless headline is about sports
- Match as many headlines as possible
- Return VALID JSON only`,
        },
        {
          role: "user",
          content: `HEADLINES:\n${headlineList}\n\nMARKETS:\n${marketList}`,
        },
      ],
    });

    const pass1Text = pass1.choices[0]?.message?.content?.trim() || "[]";
    let rawMatches: { h: number; m: number[] }[] = [];
    try {
      rawMatches = JSON.parse(pass1Text.replace(/```json\n?|\n?```/g, "").trim());
      if (!Array.isArray(rawMatches)) rawMatches = [];
    } catch {
      rawMatches = [];
    }

    // Build candidate pairs for validation
    const topMarkets = allMarkets.slice(0, 250);
    const candidates: { h: number; headline: string; mi: number; question: string }[] = [];
    for (const match of rawMatches) {
      if (match.h < 0 || match.h >= headlines.length) continue;
      const indices = Array.isArray(match.m) ? match.m : [match.m];
      for (const mi of indices.slice(0, 3)) {
        if (mi >= 0 && mi < topMarkets.length) {
          candidates.push({ h: match.h, headline: headlines[match.h], mi, question: topMarkets[mi].question });
        }
      }
    }

    if (candidates.length === 0) return NextResponse.json({ links: [], updatedAt: new Date().toISOString() });

    // PASS 2: Validate — ask GPT to confirm each match is actually relevant
    const validationList = candidates.map((c, i) => `${i}: "${c.headline}" → "${c.question}"`).join("\n");

    const pass2 = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You validate whether news headlines are truly related to prediction markets.
For each pair, return YES or NO.

Return a JSON array of indices that ARE valid matches: [0, 2, 5, 7]

A match is VALID if:
- The headline and market are about the SAME topic, country, person, or event
- Example VALID: "Iran War ceasefire confusion" → "US x Iran ceasefire by April 30?" ✓
- Example INVALID: "Iran War strikes" → "Will Iran win the 2026 FIFA World Cup?" ✗
- Example INVALID: "Trump criticises NATO" → "Will Eric Trump win 2028 election?" ✗ (different person)
- Example VALID: "Trump criticises NATO" → "Will any country leave NATO by June 30?" ✓

Return ONLY the JSON array of valid indices.`,
        },
        {
          role: "user",
          content: `Validate these headline→market pairs:\n${validationList}`,
        },
      ],
    });

    const pass2Text = pass2.choices[0]?.message?.content?.trim() || "[]";
    let validIndices: number[] = [];
    try {
      validIndices = JSON.parse(pass2Text.replace(/```json\n?|\n?```/g, "").trim());
      if (!Array.isArray(validIndices)) validIndices = [];
    } catch {
      // If validation fails, keep all candidates
      validIndices = candidates.map((_, i) => i);
    }

    // Build final links from validated candidates
    const links: MarketLink[] = [];
    for (const idx of validIndices) {
      if (idx < 0 || idx >= candidates.length) continue;
      const c = candidates[idx];
      const market = topMarkets[c.mi];
      links.push({
        headlineIndex: c.h,
        marketId: market.id,
        question: market.question,
        slug: market.slug,
        eventSlug: market.eventSlug,
        yesPrice: market.lastTradePrice || 0.5,
      });
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
      return NextResponse.json(JSON.parse(rows[0].result));
    }
    return NextResponse.json({ links: [] });
  } catch {
    return NextResponse.json({ links: [] });
  }
}
