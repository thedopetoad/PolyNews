import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CACHE_KEY_PREFIX = "news-mkt-v10-";
const GAMMA_API = "https://gamma-api.polymarket.com";

interface MarketLink {
  headlineIndex: number;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = (body.headlines || []).slice(0, 15);
    if (headlines.length === 0) return NextResponse.json({ links: [] });

    const db = getDb();
    const headlineHash = crypto.createHash("sha256").update(headlines.join("|")).digest("hex").slice(0, 16);
    const cacheKey = CACHE_KEY_PREFIX + headlineHash;

    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, cacheKey))
      .limit(1);

    if (cached) {
      return NextResponse.json(JSON.parse(cached.result));
    }

    // Single GPT web search call with ALL headlines (avoids Vercel timeout)
    const headlineSummary = headlines.slice(0, 8).map((h, i) => `${i}: ${h}`).join("\n");

    const searchResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: `Search polymarket.com for prediction markets related to each of these news headlines:

${headlineSummary}

TODAY: ${new Date().toISOString().slice(0, 10)}

For EACH headline, find 2-3 DIRECTLY related prediction markets on Polymarket.

RULES:
- "Iran war ceasefire" → find Iran ceasefire, Iran strikes, Iran regime markets
- "Trump NATO" → find NATO withdrawal, NATO membership markets (NOT Trump 2028 election)
- "Israel bombed Beirut" → find Israel-Lebanon, Israel strikes markets
- Markets MUST be about the SAME topic as the headline
- Only ACTIVE markets with future end dates
- Copy EXACT slug from Polymarket URL

Return JSON: [{"h": 0, "markets": [{"q": "question", "slug": "exact-slug", "yes": 45}]}, ...]
Return ONLY valid JSON.`,
    });

    let results: { headlineIndex: number; markets: { q: string; slug: string; yes: number }[] }[] = [];
    try {
      const textOutput = searchResponse.output.find((o) => o.type === "message");
      if (textOutput && textOutput.type === "message") {
        const textContent = textOutput.content.find((c) => c.type === "output_text");
        if (textContent && textContent.type === "output_text") {
          const cleaned = textContent.text.replace(/```json\n?|\n?```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            results = parsed.map((r: { h: number; markets: { q: string; slug: string; yes: number }[] }) => ({
              headlineIndex: r.h,
              markets: Array.isArray(r.markets) ? r.markets.slice(0, 3) : [],
            }));
          }
        }
      }
    } catch {}

    if (results.length === 0) {
      // Cache empty result so we don't retry immediately
      const emptyResult = { links: [], updatedAt: new Date().toISOString() };
      await db.insert(consensusCache).values({
        id: cacheKey, marketQuestion: "news-market-links", result: JSON.stringify(emptyResult),
      }).onConflictDoUpdate({ target: consensusCache.id, set: { result: JSON.stringify(emptyResult), createdAt: new Date() } });
      return NextResponse.json(emptyResult);
    }

    // Build candidate links, deduplicating by slug
    const seenSlugs = new Set<string>();
    const links: MarketLink[] = [];

    for (const result of results) {
      for (const market of result.markets) {
        if (!market.q || !market.slug) continue;
        const slugKey = market.slug.toLowerCase();
        if (seenSlugs.has(slugKey)) continue;
        seenSlugs.add(slugKey);
        links.push({
          headlineIndex: result.headlineIndex,
          question: market.q,
          slug: market.slug,
          eventSlug: market.slug,
          yesPrice: (market.yes || 50) / 100,
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
      return NextResponse.json(JSON.parse(rows[0].result));
    }
    return NextResponse.json({ links: [] });
  } catch {
    return NextResponse.json({ links: [] });
  }
}
