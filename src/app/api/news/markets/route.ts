import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY = "news-mkt-v15";
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours — reset stale caches
const BATCH_SIZE = 3;

interface MarketLink {
  headlineHash: string;
  headlineTitle: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

interface CachedData {
  links: MarketLink[];
  processedHashes: string[];
  cursor: number; // Next index to process
  updatedAt: string;
}

// Normalize title the same way as the frontend for consistent matching
function normalizeTitle(title: string): string {
  return title.replace(/[^\w\s]/g, "").toLowerCase().slice(0, 40);
}

function hashTitle(title: string): string {
  return crypto.createHash("md5").update(normalizeTitle(title)).digest("hex").slice(0, 12);
}

async function searchGammaMarkets(keywords: string[]) {
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

  return allMarkets.filter((market) => {
    const q = market.question.toLowerCase();
    return keywords.some((kw) => kw.length > 2 && q.includes(kw.toLowerCase()));
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headlines: string[] = (body.headlines || []).slice(0, 15);
    if (headlines.length === 0) return NextResponse.json({ links: [], remaining: 0 });

    const db = getDb();

    // Load cache
    const [cached] = await db.select().from(consensusCache).where(eq(consensusCache.id, CACHE_KEY)).limit(1);
    let existing: CachedData = cached
      ? JSON.parse(cached.result)
      : { links: [], processedHashes: [], cursor: 0, updatedAt: "" };

    // Expire stale cache — reset everything after 2 hours so new headlines get processed
    if (existing.updatedAt) {
      const age = Date.now() - new Date(existing.updatedAt).getTime();
      if (age > CACHE_TTL) {
        existing = { links: [], processedHashes: [], cursor: 0, updatedAt: "" };
      }
    }

    // Find headlines that haven't been processed yet (by hash)
    const processedSet = new Set(existing.processedHashes);
    const unprocessed = headlines.filter((h) => !processedSet.has(hashTitle(h)));

    if (unprocessed.length === 0) {
      // Keep existing links that match current headlines (fuzzy by normalized title)
      const currentNormalized = new Set(headlines.map(normalizeTitle));
      const relevantLinks = existing.links.filter((l) => currentNormalized.has(normalizeTitle(l.headlineTitle)));
      return NextResponse.json({ links: relevantLinks, remaining: 0 });
    }

    // Process next batch of unprocessed headlines
    const toProcess = unprocessed.slice(0, BATCH_SIZE);

    if (toProcess.length === 0) {
      return NextResponse.json({ links: existing.links, remaining: 0 });
    }

    // Step 1: Extract keywords
    const kwResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Extract 3-5 single lowercase keywords from each headline for searching prediction markets.
"Iran War Cease-Fire Tested" → ["iran", "ceasefire", "hormuz", "war"]
"Trump slams NATO" → ["nato", "trump", "alliance"]
"Israel bombed Beirut" → ["israel", "lebanon", "beirut", "strike"]
Return: [{"kw": ["word1", "word2"]}] — one object per headline. ONLY JSON.`,
        },
        { role: "user", content: toProcess.join("\n") },
      ],
    });

    let kwResults: { kw: string[] }[] = [];
    try {
      kwResults = JSON.parse((kwResponse.choices[0]?.message?.content || "[]").replace(/```json\n?|\n?```/g, "").trim());
    } catch { kwResults = []; }

    const allKw = [...new Set(kwResults.flatMap((r) => r.kw || []))].filter((k) => k.length > 2);

    // Step 2: Search Gamma API
    const gammaMarkets = allKw.length > 0 ? await searchGammaMarkets(allKw) : [];

    const newLinks: MarketLink[] = [];

    if (gammaMarkets.length > 0) {
      // Deduplicate similar markets
      const deduped = new Map<string, typeof gammaMarkets[0]>();
      for (const m of gammaMarkets) {
        const key = m.question.replace(/\b\d{1,2}[,.]?\s*(january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b/gi, "").trim().toLowerCase().slice(0, 50);
        if (!deduped.has(key)) deduped.set(key, m);
      }
      const unique = [...deduped.values()].slice(0, 30);
      const marketList = unique.map((m, i) => `${i}: ${m.question}`).join("\n");

      // Step 3: Match & validate — STRICT topic matching
      const matchResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You match news headlines to prediction markets. Be EXTREMELY strict — only match if the market is DIRECTLY about the same specific event/topic as the headline.

RULES:
- The market must be about the EXACT SAME subject as the headline
- Sharing a country name or person name is NOT enough — the topic must match
- Sports markets NEVER match non-sports headlines (and vice versa)
- Generic/broad markets don't match specific events unless clearly related

CORRECT matches:
✅ "US blocks Iranian ports" → "Will US impose sanctions on Iran?" (same geopolitical event)
✅ "Bitcoin hits $100K" → "Will Bitcoin reach $100K by June?" (same asset, same milestone)
✅ "Trump fires cabinet member" → "Will Trump's cabinet member resign?" (same specific event)

WRONG matches — REJECT THESE:
❌ "Iran oil blockade" → "Will Iran win FIFA World Cup?" (oil ≠ sports)
❌ "Trump NATO speech" → "Will Trump win 2028?" (NATO policy ≠ election)
❌ "Ukraine counteroffensive" → "Will Russia host World Cup?" (war ≠ sports)
❌ "Israel strikes Lebanon" → "Will Israel win Eurovision?" (military ≠ entertainment)
❌ "China tariffs" → "Will China land on Mars?" (trade ≠ space)

When in doubt, DO NOT match. Empty arrays are fine: [{"h": 0, "m": []}]
Return: [{"h": 0, "m": [1, 5]}] — ONLY JSON, one object per headline.`,
          },
          { role: "user", content: `HEADLINES:\n${toProcess.map((h, i) => `${i}: ${h}`).join("\n")}\n\nMARKETS:\n${marketList}` },
        ],
      });

      let matches: { h: number; m: number[] }[] = [];
      try {
        matches = JSON.parse((matchResponse.choices[0]?.message?.content || "[]").replace(/```json\n?|\n?```/g, "").trim());
      } catch { matches = []; }

      const existingSlugs = new Set(existing.links.map((l) => l.slug));

      for (const match of matches) {
        if (match.h < 0 || match.h >= toProcess.length || !Array.isArray(match.m)) continue;
        const headline = toProcess[match.h];
        const hHash = hashTitle(headline);
        for (const mi of match.m.slice(0, 3)) {
          if (mi < 0 || mi >= unique.length) continue;
          const market = unique[mi];
          if (existingSlugs.has(market.slug)) continue;
          existingSlugs.add(market.slug);
          newLinks.push({
            headlineHash: hHash,
            headlineTitle: headline,
            question: market.question,
            slug: market.slug,
            eventSlug: market.eventSlug,
            yesPrice: market.yesPrice,
          });
        }
      }
    }

    // Update cache — keep all existing links + add new ones
    const updated: CachedData = {
      links: [...existing.links, ...newLinks],
      processedHashes: [...existing.processedHashes, ...toProcess.map(hashTitle)],
      cursor: 0, // Not used anymore, kept for compatibility
      updatedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(updated);
    if (cached) {
      await db.update(consensusCache).set({ result: json, createdAt: new Date() }).where(eq(consensusCache.id, CACHE_KEY));
    } else {
      await db.insert(consensusCache).values({ id: CACHE_KEY, marketQuestion: "news-market-links", result: json });
    }

    // Count remaining unprocessed
    const updatedProcessed = new Set(updated.processedHashes);
    const remaining = headlines.filter((h) => !updatedProcessed.has(hashTitle(h))).length;
    return NextResponse.json({ links: updated.links, remaining: Math.max(remaining, 0) });
  } catch (err) {
    console.error("News markets error:", err);
    return NextResponse.json({ links: [], remaining: 0 });
  }
}

export async function GET() {
  try {
    const db = getDb();
    const [cached] = await db.select().from(consensusCache).where(eq(consensusCache.id, CACHE_KEY)).limit(1);
    if (cached) {
      const data: CachedData = JSON.parse(cached.result);
      // Always return remaining=1 so frontend keeps polling for new headlines
      return NextResponse.json({ links: data.links, remaining: 1 });
    }
    return NextResponse.json({ links: [], remaining: 1 });
  } catch {
    return NextResponse.json({ links: [], remaining: 1 });
  }
}
