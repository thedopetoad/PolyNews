import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CACHE_KEY_PREFIX = "news-mkt-v11-";

interface MarketLink {
  headlineIndex: number;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

const TODAY = () => new Date().toISOString().slice(0, 10);
const YEAR = () => new Date().getFullYear();

async function searchMarketsForHeadline(headline: string): Promise<{ q: string; slug: string; yes: number }[]> {
  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: `Search polymarket.com for 3 prediction markets about this news headline:

"${headline}"

TODAY: ${TODAY()}, YEAR: ${YEAR()}

STRICT RULES:
1. Markets MUST be about the EXACT same topic as the headline
2. Markets must be ACTIVE with end dates in ${YEAR()} or later (NOT expired, NOT resolved)
3. Do NOT return any market with a date that has already passed
4. Copy the EXACT slug from the Polymarket URL (polymarket.com/event/THE-SLUG-HERE)
5. If headline is about Iran war → find Iran conflict/ceasefire/regime markets
6. If headline is about Trump + NATO → find NATO markets, NOT Trump election markets
7. If headline is about Israel → find Israel conflict markets
8. Each market should be about a DIFFERENT aspect (not same question different dates)

Return JSON: [{"q": "exact market question from Polymarket", "slug": "exact-slug-from-url", "yes": 45}]
If no relevant active markets found, return: []
ONLY return valid JSON, nothing else.`,
    });

    const textOutput = response.output.find((o) => o.type === "message");
    if (textOutput && textOutput.type === "message") {
      const textContent = textOutput.content.find((c) => c.type === "output_text");
      if (textContent && textContent.type === "output_text") {
        const cleaned = textContent.text.replace(/```json\n?|\n?```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          // Filter out markets with past dates in their question
          const currentYear = YEAR();
          return parsed.filter((m: { q?: string; slug?: string; yes?: number }) => {
            if (!m.q || !m.slug) return false;
            // Check for past year references
            const yearMatch = m.q.match(/20\d{2}/g);
            if (yearMatch) {
              const years = yearMatch.map(Number);
              if (years.some((y) => y < currentYear)) return false;
            }
            return true;
          }).slice(0, 3);
        }
      }
    }
  } catch {}
  return [];
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

    // Process top 3 headlines ONE AT A TIME (stay well under 60s Vercel limit)
    const topHeadlines = headlines.slice(0, 3);
    const seenSlugs = new Set<string>();
    const links: MarketLink[] = [];

    for (let i = 0; i < topHeadlines.length; i++) {
      const markets = await searchMarketsForHeadline(topHeadlines[i]);

      for (const market of markets) {
        const slugKey = market.slug.toLowerCase();
        if (seenSlugs.has(slugKey)) continue;
        seenSlugs.add(slugKey);

        links.push({
          headlineIndex: i,
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
