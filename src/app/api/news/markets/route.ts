import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CACHE_KEY_PREFIX = "news-mkt-v8-";
const POLYMARKET_BASE = "https://polymarket.com";

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

    // Return cached if headlines haven't changed
    const [cached] = await db
      .select()
      .from(consensusCache)
      .where(eq(consensusCache.id, cacheKey))
      .limit(1);

    if (cached) {
      return NextResponse.json(JSON.parse(cached.result));
    }

    // SINGLE PASS: GPT web searches Polymarket for EACH headline and returns 3 markets each
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: `You are a prediction market researcher. For each news headline below, search polymarket.com to find 3 DIRECTLY RELEVANT prediction markets.

NEWS HEADLINES:
${headlines.map((h, i) => `${i}: ${h}`).join("\n")}

INSTRUCTIONS:
1. For each headline, search Polymarket for markets about the SAME topic
2. For "Iran war" headlines, find Iran ceasefire, Iran regime, US-Iran conflict markets
3. For "Trump NATO" headlines, find NATO withdrawal, NATO membership markets (NOT Trump 2028 election)
4. For "Israel bombed" headlines, find Israel strike, Israel-Iran conflict markets
5. Each market should be DIFFERENT — no duplicate markets across headlines
6. Extract the event slug from the Polymarket URL (the part after /event/)
7. Include the current Yes price if visible

Return a JSON array. Each entry has "h" (headline index) and "markets" (array of up to 3):
[
  {"h": 0, "markets": [{"q": "market question", "slug": "event-slug-from-url", "yes": 45}]},
  {"h": 1, "markets": [{"q": "another market", "slug": "another-slug", "yes": 72}]}
]

IMPORTANT: Return ONLY valid JSON. Every headline should have at least 1 market if possible. Aim for 3 unique markets per headline.`,
    });

    // Extract text from response
    let responseText = "";
    const textOutput = response.output.find((o) => o.type === "message");
    if (textOutput && textOutput.type === "message") {
      const textContent = textOutput.content.find((c) => c.type === "output_text");
      if (textContent && textContent.type === "output_text") {
        responseText = textContent.text;
      }
    }

    // Parse the response
    let matches: { h: number; markets: { q: string; slug: string; yes: number }[] }[] = [];
    try {
      const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
      matches = JSON.parse(cleaned);
      if (!Array.isArray(matches)) matches = [];
    } catch {
      matches = [];
    }

    // Build links, deduplicating markets across headlines
    const seenSlugs = new Set<string>();
    const links: MarketLink[] = [];

    for (const match of matches) {
      if (match.h < 0 || match.h >= headlines.length || !Array.isArray(match.markets)) continue;
      for (const m of match.markets.slice(0, 3)) {
        if (!m.q || !m.slug) continue;
        // Deduplicate
        const slugKey = m.slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (seenSlugs.has(slugKey)) continue;
        seenSlugs.add(slugKey);

        links.push({
          headlineIndex: match.h,
          question: m.q,
          slug: m.slug,
          eventSlug: m.slug,
          yesPrice: (m.yes || 50) / 100,
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
