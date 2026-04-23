import OpenAI from "openai";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb, consensusCache, marketsCatalog } from "@/db";

/**
 * Shared pipeline for "Click to See Markets" on the news page.
 *
 * `/api/news/markets` (POST) and `/api/cron/news-markets-warm` (GET)
 * both call `processNewsMarkets()` so the user-triggered code path and
 * the pre-warm cron hit the exact same matching logic and cache row.
 *
 * Pipeline per headline (runs in parallel across headlines):
 *   1. Extract 4-8 keywords via gpt-4o-mini
 *   2. Substring-filter the full markets_catalog, sort by volume desc
 *   3. Ask gpt-4o-mini to pick up to 20 truly-relevant indices
 *   4. Append resulting links to consensus_cache row CACHE_KEY
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Bump when prompts or pipeline shape change so old caches invalidate.
export const NEWS_MARKETS_CACHE_KEY = "news-mkt-v16";
export const NEWS_MARKETS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2h

// Per-process catalog cache. Hot serverless instances reuse this to skip the
// Neon round-trip. 5-min TTL is fine since the underlying cron only updates
// markets_catalog every 6h.
const CATALOG_TTL = 5 * 60 * 1000;
let CATALOG_CACHE: { rows: CatalogRow[]; at: number } | null = null;

// How many keyword-filtered markets we send to the GPT matcher per headline.
const MAX_CANDIDATES_PER_HEADLINE = 250;

// Hard cap on markets per headline surfaced to the UI.
const MAX_MARKETS_PER_HEADLINE = 20;

// Fallback if the catalog table is empty (pre-bootstrap or cron never ran).
const GAMMA_API = "https://gamma-api.polymarket.com";

export interface CatalogRow {
  slug: string;
  eventSlug: string;
  question: string;
  volume: string | null;
  endDate: string | null;
  clobTokenIds: string | null;
  lastTradePrice: number | null;
}

export interface MarketLink {
  headlineHash: string;
  headlineTitle: string;
  question: string;
  slug: string;
  eventSlug: string;
  yesPrice: number;
}

export interface CachedNewsMarkets {
  links: MarketLink[];
  processedHashes: string[];
  updatedAt: string;
}

export function normalizeTitle(title: string): string {
  return title.replace(/[^\w\s]/g, "").toLowerCase().slice(0, 40);
}

export function hashTitle(title: string): string {
  return crypto.createHash("md5").update(normalizeTitle(title)).digest("hex").slice(0, 12);
}

export async function loadCatalog(): Promise<CatalogRow[]> {
  if (CATALOG_CACHE && Date.now() - CATALOG_CACHE.at < CATALOG_TTL) {
    return CATALOG_CACHE.rows;
  }
  const db = getDb();
  const rows = await db
    .select({
      slug: marketsCatalog.slug,
      eventSlug: marketsCatalog.eventSlug,
      question: marketsCatalog.question,
      volume: marketsCatalog.volume,
      endDate: marketsCatalog.endDate,
      clobTokenIds: marketsCatalog.clobTokenIds,
      lastTradePrice: marketsCatalog.lastTradePrice,
    })
    .from(marketsCatalog);

  if (rows.length < 100) {
    const fallback = await fetchGammaFallback();
    CATALOG_CACHE = { rows: fallback, at: Date.now() };
    return fallback;
  }

  CATALOG_CACHE = { rows, at: Date.now() };
  return rows;
}

async function fetchGammaFallback(): Promise<CatalogRow[]> {
  const offsets = [0, 50, 100, 150];
  const results = await Promise.allSettled(
    offsets.map(async (offset) => {
      const res = await fetch(
        `${GAMMA_API}/events?active=true&closed=false&limit=50&order=volume&ascending=false&offset=${offset}`,
        { next: { revalidate: 300 } },
      );
      if (!res.ok) return [];
      return (await res.json()) as {
        slug: string;
        markets?: {
          slug?: string;
          question?: string;
          volume?: string;
          endDate?: string;
          clobTokenIds?: string;
          lastTradePrice?: number;
          closed?: boolean;
          active?: boolean;
        }[];
      }[];
    }),
  );

  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const event of r.value) {
      for (const m of event.markets || []) {
        if (!m.slug || m.closed === true || m.active === false) continue;
        if (seen.has(m.slug)) continue;
        seen.add(m.slug);
        rows.push({
          slug: m.slug,
          eventSlug: event.slug,
          question: m.question || "",
          volume: m.volume || "0",
          endDate: m.endDate || "",
          clobTokenIds: m.clobTokenIds || "[]",
          lastTradePrice: typeof m.lastTradePrice === "number" ? m.lastTradePrice : 0.5,
        });
      }
    }
  }
  return rows;
}

async function extractKeywords(headline: string): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Extract 4-8 single lowercase keywords from the headline for searching prediction markets. Include synonyms, related entities, and associated broader topics so keyword-substring search finds candidate markets even if the market wording differs.

"Iran War Cease-Fire Tested" → {"kw":["iran","ceasefire","war","middle east","tehran","hormuz","israel"]}
"Trump slams NATO" → {"kw":["trump","nato","alliance","europe","military"]}
"Israel bombed Beirut" → {"kw":["israel","lebanon","beirut","strike","hezbollah","war"]}
"Bitcoin hits $100K" → {"kw":["bitcoin","btc","crypto","price","ath"]}
"Fed hints at rate cut" → {"kw":["fed","rate","inflation","powell","interest","cpi"]}
"SpaceX launches Starship" → {"kw":["spacex","starship","rocket","launch","musk"]}

Return ONLY JSON in this shape: {"kw":["word1","word2"]}`,
      },
      { role: "user", content: headline },
    ],
  });

  const raw = (res.choices[0]?.message?.content || "{}").replace(/```json\n?|\n?```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    const kw: unknown = parsed.kw;
    if (!Array.isArray(kw)) return [];
    return kw
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.toLowerCase().trim())
      .filter((k) => k.length > 2);
  } catch {
    return [];
  }
}

function filterCatalogByKeywords(catalog: CatalogRow[], keywords: string[]): CatalogRow[] {
  if (keywords.length === 0) return [];
  const kws = keywords.map((k) => k.toLowerCase());
  const matches: CatalogRow[] = [];
  for (const m of catalog) {
    const q = (m.question || "").toLowerCase();
    if (kws.some((k) => q.includes(k))) matches.push(m);
  }
  matches.sort((a, b) => {
    const av = parseFloat(a.volume || "0");
    const bv = parseFloat(b.volume || "0");
    return bv - av;
  });
  return matches;
}

async function matchHeadlineToMarkets(
  headline: string,
  candidates: CatalogRow[],
): Promise<number[]> {
  if (candidates.length === 0) return [];

  const marketList = candidates.map((m, i) => `${i}: ${m.question}`).join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You match a news headline to prediction markets from a filtered list. Return the indices of EVERY market that is clearly about the same event, subject, or trend as the headline.

MATCH IF:
- The market would resolve based on the same underlying event/trend the headline is about
- Shared subject matter AND aligned topic (war, crypto, specific entity, etc.)
- A reasonable reader would agree "this market is relevant to this news"
- Related markets about the same broader storyline also count (e.g. headline about Iran-Israel war → markets about Middle East ceasefire, Iran sanctions, oil prices all qualify)

DO NOT MATCH IF:
- Only a shared name/country but completely different topic (Iran oil ≠ Iran soccer)
- Sports markets for non-sports headlines and vice versa
- Entertainment/Eurovision markets for political/military headlines

CORRECT:
✅ "US blocks Iranian ports" → "Will US impose sanctions on Iran?"
✅ "Iran oil blockade" → "Will Strait of Hormuz close before year end?"
✅ "Bitcoin hits $100K" → "Will Bitcoin close above $150K on Dec 31?"
✅ "Bitcoin hits $100K" → "Will BTC reach $200K in 2026?"
✅ "Israel strikes Lebanon" → "Will Israel-Hezbollah ceasefire hold?"
✅ "Trump NATO speech" → "Will Trump withdraw from NATO?"
✅ "Fed hints at rate cut" → "Will Fed cut rates in June?"

REJECT:
❌ "Iran oil blockade" → "Will Iran win FIFA World Cup?"
❌ "Ukraine counteroffensive" → "Will Russia host World Cup 2030?"
❌ "Israel strikes Lebanon" → "Will Israel win Eurovision?"

Return up to ${MAX_MARKETS_PER_HEADLINE} indices, ordered from MOST to LEAST relevant. Only include markets you are confident are actually related.

Return ONLY JSON in this shape: {"m":[0,3,7]}`,
      },
      { role: "user", content: `HEADLINE: ${headline}\n\nMARKETS:\n${marketList}` },
    ],
  });

  const raw = (res.choices[0]?.message?.content || "{}").replace(/```json\n?|\n?```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    const arr: unknown = parsed.m;
    if (!Array.isArray(arr)) return [];
    const out: number[] = [];
    for (const v of arr) {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      if (Number.isInteger(n) && n >= 0 && n < candidates.length) out.push(n);
    }
    return out.slice(0, MAX_MARKETS_PER_HEADLINE);
  } catch {
    return [];
  }
}

async function processHeadline(headline: string, catalog: CatalogRow[]): Promise<MarketLink[]> {
  let keywords: string[];
  try {
    keywords = await extractKeywords(headline);
  } catch {
    return [];
  }
  if (keywords.length === 0) return [];

  const filtered = filterCatalogByKeywords(catalog, keywords);
  if (filtered.length === 0) return [];

  const candidates = filtered.slice(0, MAX_CANDIDATES_PER_HEADLINE);

  let indices: number[];
  try {
    indices = await matchHeadlineToMarkets(headline, candidates);
  } catch {
    return [];
  }

  const hHash = hashTitle(headline);
  const seen = new Set<string>();
  const links: MarketLink[] = [];
  for (const i of indices) {
    const m = candidates[i];
    if (!m || seen.has(m.slug)) continue;
    seen.add(m.slug);
    links.push({
      headlineHash: hHash,
      headlineTitle: headline,
      question: m.question,
      slug: m.slug,
      eventSlug: m.eventSlug,
      yesPrice: typeof m.lastTradePrice === "number" ? m.lastTradePrice : 0.5,
    });
  }
  return links;
}

export interface ProcessNewsMarketsResult {
  links: MarketLink[];
  remaining: number;
  /** How many headlines actually had to hit GPT this call. 0 = pure cache hit. */
  processedNew: number;
}

/**
 * Core pipeline: given a list of headline titles, returns the cached
 * matches (filtered to the current headline set) plus any new ones
 * produced by running GPT on unprocessed headlines. Updates the
 * consensus_cache row in-place.
 *
 * `forceReprocess` (used by the user-triggered "Find Related Markets"
 * button): wipes the passed headlines' existing hashes + links before
 * running, so the match pipeline runs fresh even if they're already
 * cached-as-empty.
 */
export async function processNewsMarkets(
  headlinesInput: string[],
  forceReprocess = false,
): Promise<ProcessNewsMarketsResult> {
  const headlines = headlinesInput.slice(0, 15);
  if (headlines.length === 0) return { links: [], remaining: 0, processedNew: 0 };

  const db = getDb();

  const [cached] = await db
    .select()
    .from(consensusCache)
    .where(eq(consensusCache.id, NEWS_MARKETS_CACHE_KEY))
    .limit(1);

  let existing: CachedNewsMarkets = cached
    ? JSON.parse(cached.result)
    : { links: [], processedHashes: [], updatedAt: "" };

  if (existing.updatedAt) {
    const age = Date.now() - new Date(existing.updatedAt).getTime();
    if (age > NEWS_MARKETS_CACHE_TTL) {
      existing = { links: [], processedHashes: [], updatedAt: "" };
    }
  }

  // When forcing, drop the passed headlines from processedHashes and
  // strip their old links so the pipeline treats them as fresh.
  if (forceReprocess) {
    const forceHashes = new Set(headlines.map(hashTitle));
    existing = {
      ...existing,
      processedHashes: existing.processedHashes.filter((h) => !forceHashes.has(h)),
      links: existing.links.filter((l) => !forceHashes.has(l.headlineHash)),
    };
  }

  const processedSet = new Set(existing.processedHashes);
  const unprocessed = headlines.filter((h) => !processedSet.has(hashTitle(h)));

  if (unprocessed.length === 0) {
    const current = new Set(headlines.map(normalizeTitle));
    const relevant = existing.links.filter((l) => current.has(normalizeTitle(l.headlineTitle)));
    return { links: relevant, remaining: 0, processedNew: 0 };
  }

  const catalog = await loadCatalog();

  const results = await Promise.all(
    unprocessed.map((h) =>
      processHeadline(h, catalog).catch((err) => {
        console.error("[news-mkt] processHeadline failed", { headline: h, err: (err as Error).message });
        return [] as MarketLink[];
      }),
    ),
  );
  const newLinks = results.flat();

  const existingKey = new Set(existing.links.map((l) => `${l.headlineHash}|${l.slug}`));
  const dedupedNew = newLinks.filter((l) => !existingKey.has(`${l.headlineHash}|${l.slug}`));

  const updated: CachedNewsMarkets = {
    links: [...existing.links, ...dedupedNew],
    processedHashes: [...existing.processedHashes, ...unprocessed.map(hashTitle)],
    updatedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(updated);
  if (cached) {
    await db
      .update(consensusCache)
      .set({ result: json, createdAt: new Date() })
      .where(eq(consensusCache.id, NEWS_MARKETS_CACHE_KEY));
  } else {
    await db.insert(consensusCache).values({
      id: NEWS_MARKETS_CACHE_KEY,
      marketQuestion: "news-market-links",
      result: json,
    });
  }

  const current = new Set(headlines.map(normalizeTitle));
  const relevant = updated.links.filter((l) => current.has(normalizeTitle(l.headlineTitle)));

  return { links: relevant, remaining: 0, processedNew: unprocessed.length };
}
