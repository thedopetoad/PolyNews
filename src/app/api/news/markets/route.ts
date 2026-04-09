import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CACHE_KEY_PREFIX = "news-mkt-v9-";

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

    // STEP 1: Extract search keywords from each headline
    const keywordResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Extract 2-3 search keywords from each news headline that would find RELATED PREDICTION MARKETS on Polymarket.

Examples:
- "Iran War Live Updates: Cease-Fire Tested" → "Iran ceasefire, Iran war, US Iran"
- "Trump slams NATO over Iran" → "NATO leave, Trump NATO, US NATO withdrawal"
- "13-year-old girl captures terrifying moment Israel bombed Beirut" → "Israel strikes, Israel Lebanon, Israel Iran war"
- "Man rescued after two weeks trapped in collapsed Mexico mine" → "Mexico earthquake, Mexico disaster"

Return JSON: [{"h": 0, "kw": ["Iran ceasefire", "Iran war"]}, ...]
Return ONLY the JSON array.`,
        },
        {
          role: "user",
          content: headlines.map((h, i) => `${i}: ${h}`).join("\n"),
        },
      ],
    });

    let keywords: { h: number; kw: string[] }[] = [];
    try {
      const cleaned = (keywordResponse.choices[0]?.message?.content || "[]").replace(/```json\n?|\n?```/g, "").trim();
      keywords = JSON.parse(cleaned);
      if (!Array.isArray(keywords)) keywords = [];
    } catch {
      keywords = [];
    }

    if (keywords.length === 0) return NextResponse.json({ links: [] });

    // STEP 2: Search Polymarket with those keywords using web search
    const allKeywords = keywords.flatMap((k) => k.kw).filter(Boolean);
    const uniqueKeywords = [...new Set(allKeywords)].slice(0, 15);
    const searchQueries = uniqueKeywords.map((kw) => `site:polymarket.com ${kw}`).join("\n");

    const searchResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: `Search Polymarket for prediction markets matching these topics. For EACH search query, find real markets on polymarket.com:

${searchQueries}

For each market you find, extract:
1. The exact market question as shown on Polymarket
2. The event slug from the URL (polymarket.com/event/THIS-PART)
3. The current Yes price percentage (if visible)

Return a JSON array of ALL unique markets found:
[{"q": "Will US withdraw from NATO by December 31?", "slug": "will-us-withdraw-from-nato-by-december-31", "yes": 13, "topics": ["NATO leave", "Trump NATO"]}]

The "topics" field should list which search keywords this market matched.

IMPORTANT:
- Only return markets that ACTUALLY EXIST on polymarket.com
- Do NOT make up markets or slugs
- Include the "topics" field so I can match back to headlines
- Find at least 20 unique markets across all topics
- Return ONLY valid JSON`,
    });

    let foundMarkets: { q: string; slug: string; yes: number; topics: string[] }[] = [];
    try {
      const textOutput = searchResponse.output.find((o) => o.type === "message");
      if (textOutput && textOutput.type === "message") {
        const textContent = textOutput.content.find((c) => c.type === "output_text");
        if (textContent && textContent.type === "output_text") {
          const cleaned = textContent.text.replace(/```json\n?|\n?```/g, "").trim();
          foundMarkets = JSON.parse(cleaned);
          if (!Array.isArray(foundMarkets)) foundMarkets = [];
        }
      }
    } catch {
      foundMarkets = [];
    }

    if (foundMarkets.length === 0) return NextResponse.json({ links: [] });

    // STEP 3: Match each headline to its best markets AND validate relevance
    const marketList = foundMarkets.map((m, i) => `${i}: ${m.q} [topics: ${m.topics?.join(", ") || ""}]`).join("\n");
    const headlineList = headlines.map((h, i) => `${i}: ${h}`).join("\n");

    const matchResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Match news headlines to prediction markets. For each headline, pick up to 3 markets that are DIRECTLY about the same topic.

VALIDATION RULES — a match is ONLY valid if:
✅ "Iran war ceasefire headline" → "US x Iran ceasefire" market (SAME TOPIC)
✅ "Trump slams NATO" → "Will US withdraw from NATO?" (DIRECTLY RELATED)
✅ "Israel bombed Beirut" → "Israel strikes Lebanon" (SAME EVENT)
❌ "Man rescued from Mexico mine" → "Will cryptocurrency exchange fail?" (COMPLETELY UNRELATED)
❌ "Iran war" → "Iran FIFA World Cup" (WRONG CONTEXT)
❌ "Trump NATO" → "Eric Trump 2028 election" (WRONG PERSON)
❌ "Ponzi scheme watches" → "Treasury yield" (UNRELATED)

If NO market is relevant to a headline, SKIP IT. Do not force bad matches.

Return JSON: [{"h": 0, "m": [2, 5, 8]}, {"h": 1, "m": [0, 3]}]
Where "h" is headline index and "m" is array of market indices.
Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `HEADLINES:\n${headlineList}\n\nMARKETS:\n${marketList}`,
        },
      ],
    });

    let finalMatches: { h: number; m: number[] }[] = [];
    try {
      const cleaned = (matchResponse.choices[0]?.message?.content || "[]").replace(/```json\n?|\n?```/g, "").trim();
      finalMatches = JSON.parse(cleaned);
      if (!Array.isArray(finalMatches)) finalMatches = [];
    } catch {
      finalMatches = [];
    }

    // Build deduplicated links
    const seenSlugs = new Set<string>();
    const links: MarketLink[] = [];

    for (const match of finalMatches) {
      if (match.h < 0 || match.h >= headlines.length || !Array.isArray(match.m)) continue;
      for (const mi of match.m.slice(0, 3)) {
        if (mi < 0 || mi >= foundMarkets.length) continue;
        const market = foundMarkets[mi];
        const slugKey = market.slug?.toLowerCase() || "";
        if (seenSlugs.has(slugKey)) continue;
        seenSlugs.add(slugKey);

        links.push({
          headlineIndex: match.h,
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
