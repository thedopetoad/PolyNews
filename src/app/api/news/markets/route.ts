import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getDb, consensusCache } from "@/db";
import { eq } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GAMMA_API = "https://gamma-api.polymarket.com";
const CACHE_KEY = "news-mkt-v14";
const MAX_TOTAL = 20;
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

function hashTitle(title: string): string {
  return crypto.createHash("md5").update(title.slice(0, 80)).digest("hex").slice(0, 12);
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

    // Use cursor-based processing: always process headlines[cursor] to headlines[cursor + BATCH_SIZE]
    const cursor = existing.cursor;
    if (cursor >= headlines.length || existing.processedHashes.length >= MAX_TOTAL) {
      return NextResponse.json({ links: existing.links, remaining: 0 });
    }

    const batch = headlines.slice(cursor, cursor + BATCH_SIZE);
    const batchHashes = batch.map(hashTitle);

    // Skip any we've somehow already processed (by hash)
    const processedSet = new Set(existing.processedHashes);
    const toProcess = batch.filter((_, i) => !processedSet.has(batchHashes[i]));

    if (toProcess.length === 0) {
      // Advance cursor even if nothing to process
      existing.cursor = cursor + BATCH_SIZE;
      const json = JSON.stringify(existing);
      if (cached) {
        await db.update(consensusCache).set({ result: json, createdAt: new Date() }).where(eq(consensusCache.id, CACHE_KEY));
      } else {
        await db.insert(consensusCache).values({ id: CACHE_KEY, marketQuestion: "news-market-links", result: json });
      }
      return NextResponse.json({ links: existing.links, remaining: headlines.length - cursor - BATCH_SIZE });
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

      // Step 3: Match & validate
      const matchResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `Match headlines to markets. Up to 3 DIRECTLY related markets per headline.
✅ Same topic = match. ❌ Different topic = no match.
❌ "Iran war" → "Iran FIFA" = NO. ❌ "Trump NATO" → "Trump 2028" = NO.
Return: [{"h": 0, "m": [1, 5]}] ONLY JSON.`,
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

    // Update cache
    const updated: CachedData = {
      links: [...existing.links, ...newLinks],
      processedHashes: [...existing.processedHashes, ...toProcess.map(hashTitle)],
      cursor: cursor + BATCH_SIZE,
      updatedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(updated);
    if (cached) {
      await db.update(consensusCache).set({ result: json, createdAt: new Date() }).where(eq(consensusCache.id, CACHE_KEY));
    } else {
      await db.insert(consensusCache).values({ id: CACHE_KEY, marketQuestion: "news-market-links", result: json });
    }

    const remaining = headlines.length - (cursor + BATCH_SIZE);
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
      const remaining = data.cursor < 15 ? 1 : 0;
      return NextResponse.json({ links: data.links, remaining });
    }
    return NextResponse.json({ links: [], remaining: 1 });
  } catch {
    return NextResponse.json({ links: [], remaining: 1 });
  }
}
