import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CACHE_KEY = "news-mkt-incremental";
const MAX_PROCESSED = 20;
const BATCH_SIZE = 3;

interface MarketLink {
  headlineIndex: number;
  headlineTitle: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

interface CachedData {
  links: MarketLink[];
  processedTitles: string[]; // Which headlines have been searched
  updatedAt: string;
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

RULES:
1. Markets MUST be about the EXACT same topic as the headline
2. Markets must be ACTIVE with end dates in ${YEAR()} or later
3. Do NOT return any market with a date that has already passed
4. Copy the EXACT slug from the Polymarket URL
5. If headline is about Iran war → find Iran conflict/ceasefire/regime markets
6. If headline is about Trump + NATO → find NATO markets, NOT Trump election
7. If headline is about Israel → find Israel conflict markets
8. Each market should be DIFFERENT (not same question different dates)

Return: [{"q": "market question", "slug": "slug-from-url", "yes": 45}]
No relevant markets? Return: []
ONLY valid JSON.`,
    });

    const textOutput = response.output.find((o) => o.type === "message");
    if (textOutput && textOutput.type === "message") {
      const textContent = textOutput.content.find((c) => c.type === "output_text");
      if (textContent && textContent.type === "output_text") {
        const cleaned = textContent.text.replace(/```json\n?|\n?```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          const currentYear = YEAR();
          return parsed.filter((m: { q?: string; slug?: string }) => {
            if (!m.q || !m.slug) return false;
            const yearMatch = m.q.match(/20\d{2}/g);
            if (yearMatch && yearMatch.map(Number).some((y) => y < currentYear)) return false;
            return true;
          }).slice(0, 3);
        }
      }
    }
  } catch {}
  return [];
}

// GET — return cached results instantly
export async function GET() {
  try {
    const db = getDb();
    const [cached] = await db.select().from(consensusCache).where(eq(consensusCache.id, CACHE_KEY)).limit(1);
    if (cached) {
      const data: CachedData = JSON.parse(cached.result);
      return NextResponse.json({ links: data.links, updatedAt: data.updatedAt });
    }
    return NextResponse.json({ links: [] });
  } catch {
    return NextResponse.json({ links: [] });
  }
}

// POST — process the NEXT batch of unprocessed headlines
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = (body.headlines || []).slice(0, 15);
    if (headlines.length === 0) return NextResponse.json({ links: [] });

    const db = getDb();

    // Load existing cached data
    const [cached] = await db.select().from(consensusCache).where(eq(consensusCache.id, CACHE_KEY)).limit(1);
    let existing: CachedData = cached
      ? JSON.parse(cached.result)
      : { links: [], processedTitles: [], updatedAt: "" };

    // Find headlines that haven't been processed yet
    const unprocessed = headlines.filter((h) => !existing.processedTitles.includes(h));

    // If all are processed or we've hit the cap, return existing
    if (unprocessed.length === 0 || existing.processedTitles.length >= MAX_PROCESSED) {
      return NextResponse.json({ links: existing.links, updatedAt: existing.updatedAt });
    }

    // Process next BATCH_SIZE headlines
    const batch = unprocessed.slice(0, BATCH_SIZE);
    const seenSlugs = new Set(existing.links.map((l) => l.slug.toLowerCase()));
    const newLinks: MarketLink[] = [];

    for (const headline of batch) {
      const headlineIdx = headlines.indexOf(headline);
      const markets = await searchMarketsForHeadline(headline);

      for (const market of markets) {
        const slugKey = market.slug.toLowerCase();
        if (seenSlugs.has(slugKey)) continue;
        seenSlugs.add(slugKey);
        newLinks.push({
          headlineIndex: headlineIdx,
          headlineTitle: headline,
          question: market.q,
          slug: market.slug,
          eventSlug: market.slug,
          yesPrice: (market.yes || 50) / 100,
        });
      }
    }

    // Merge with existing
    const updatedData: CachedData = {
      links: [...existing.links, ...newLinks],
      processedTitles: [...existing.processedTitles, ...batch],
      updatedAt: new Date().toISOString(),
    };

    // Save to cache
    const resultJson = JSON.stringify(updatedData);
    if (cached) {
      await db.update(consensusCache)
        .set({ result: resultJson, createdAt: new Date() })
        .where(eq(consensusCache.id, CACHE_KEY));
    } else {
      await db.insert(consensusCache).values({
        id: CACHE_KEY,
        marketQuestion: "news-market-links",
        result: resultJson,
      });
    }

    return NextResponse.json({
      links: updatedData.links,
      updatedAt: updatedData.updatedAt,
      processed: updatedData.processedTitles.length,
      remaining: headlines.filter((h) => !updatedData.processedTitles.includes(h)).length,
    });
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [] });
  }
}
