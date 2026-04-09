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

// Validate a slug exists on Polymarket
async function validateSlug(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${GAMMA_API}/events?slug=${slug}&limit=1`);
    if (!res.ok) return false;
    const events = await res.json();
    return Array.isArray(events) && events.length > 0 && events[0].active && !events[0].closed;
  } catch {
    return false;
  }
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

    // For each headline, have GPT search Polymarket and find 3 DIRECTLY related markets
    // Process top 8 headlines (balance cost vs coverage)
    const topHeadlines = headlines.slice(0, 8);

    const searchPromises = topHeadlines.map(async (headline, idx) => {
      try {
        const response = await openai.responses.create({
          model: "gpt-4o-mini",
          tools: [{ type: "web_search_preview" }],
          input: `Search polymarket.com for prediction markets directly related to this specific news headline:

"${headline}"

Find 3 prediction markets on Polymarket that are DIRECTLY about the same event, person, country, or topic as this headline.

TODAY'S DATE: ${new Date().toISOString().slice(0, 10)}

STRICT RULES:
- Markets must be about the EXACT SAME TOPIC as the headline
- If headline is about "Iran war ceasefire" → find Iran ceasefire or Iran conflict markets
- If headline is about "Trump NATO" → find NATO or Trump foreign policy markets, NOT Trump 2028 election
- If headline is about "Israel bombing Beirut" → find Israel-Lebanon conflict markets
- Do NOT return sports markets for non-sports headlines
- Do NOT return markets about different topics that happen to mention the same country
- Only return markets that are STILL ACTIVE (not resolved, end date in the future)
- Copy the EXACT event slug from the Polymarket URL

Return JSON array: [{"q": "exact market question", "slug": "exact-slug-from-url", "yes": 45}]
If you cannot find any directly related markets, return an empty array: []
Return ONLY valid JSON.`,
        });

        const textOutput = response.output.find((o) => o.type === "message");
        if (textOutput && textOutput.type === "message") {
          const textContent = textOutput.content.find((c) => c.type === "output_text");
          if (textContent && textContent.type === "output_text") {
            const cleaned = textContent.text.replace(/```json\n?|\n?```/g, "").trim();
            const markets = JSON.parse(cleaned);
            if (Array.isArray(markets)) {
              return { headlineIndex: idx, markets: markets.slice(0, 3) };
            }
          }
        }
      } catch {}
      return { headlineIndex: idx, markets: [] };
    });

    const results = await Promise.all(searchPromises);

    // Validate all slugs and build links
    const allCandidates: { headlineIndex: number; q: string; slug: string; yes: number }[] = [];
    const seenSlugs = new Set<string>();

    for (const result of results) {
      for (const market of result.markets) {
        if (!market.q || !market.slug) continue;
        const slugKey = market.slug.toLowerCase();
        if (seenSlugs.has(slugKey)) continue;
        seenSlugs.add(slugKey);
        allCandidates.push({
          headlineIndex: result.headlineIndex,
          q: market.q,
          slug: market.slug,
          yes: market.yes || 50,
        });
      }
    }

    // Validate slugs in parallel
    const validated = await Promise.all(
      allCandidates.map(async (c) => {
        const valid = await validateSlug(c.slug);
        return valid ? c : null;
      })
    );

    const links: MarketLink[] = validated
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({
        headlineIndex: c.headlineIndex,
        question: c.q,
        slug: c.slug,
        eventSlug: c.slug,
        yesPrice: c.yes / 100,
      }));

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
