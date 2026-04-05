import { NextResponse } from "next/server";
import { KEYWORD_DICTIONARY } from "@/lib/constants";

// Category mapping — which keywords belong to which category
const CATEGORY_MAP: Record<string, string[]> = {
  "Iran": ["iran", "tehran", "khamenei", "strait of hormuz"],
  "Ukraine": ["ukraine", "russia", "putin", "zelensky", "kyiv"],
  "Crypto": ["bitcoin", "ethereum", "crypto", "sec", "regulation", "etf", "defi", "solana", "coinbase"],
  "Finance": ["fed", "interest rate", "inflation", "gdp", "recession", "economy", "jobs", "unemployment", "tariff", "trade war", "debt ceiling", "stock", "s&p", "nasdaq"],
  "Politics": ["trump", "biden", "election", "president", "congress", "senate", "democrat", "republican", "campaign"],
  "Tech": ["ai", "openai", "google", "apple", "meta", "tesla", "nvidia", "tiktok"],
};

function categorizeHeadline(text: string): string[] {
  const lower = text.toLowerCase();
  const categories: string[] = [];
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      categories.push(cat);
    }
  }
  return categories;
}

// Parse RSS XML into articles (simple regex parser, no dependencies needed)
function parseRSS(xml: string, source: string) {
  const items: { title: string; description: string; link: string; pubDate: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1] || itemXml.match(/<title>(.*?)<\/title>/)?.[1] || "";
    const desc = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/)?.[1] || itemXml.match(/<description>(.*?)<\/description>/)?.[1] || "";
    const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || "";
    const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";

    if (title) {
      items.push({
        title: title.replace(/<[^>]*>/g, "").trim(),
        description: desc.replace(/<[^>]*>/g, "").trim().slice(0, 200),
        link,
        pubDate,
      });
    }
  }

  return items.slice(0, 10).map((item) => {
    const text = `${item.title} ${item.description}`.toLowerCase();
    const keywords = KEYWORD_DICTIONARY.filter((kw) => text.includes(kw));
    const categories = categorizeHeadline(text);
    return {
      title: item.title,
      description: item.description,
      source,
      url: item.link,
      publishedAt: item.pubDate || new Date().toISOString(),
      keywords,
      categories,
    };
  });
}

// Telegram channel scraper (public channels only, no API key needed)
const TELEGRAM_CHANNELS = [
  { username: "rnintel", name: "RNIntel" },
];

async function parseTelegram(username: string, source: string) {
  try {
    const res = await fetch(`https://t.me/s/${username}`, {
      next: { revalidate: 300 },
      headers: { "User-Agent": "PolyStream/1.0" },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract messages and timestamps
    const messages: { text: string; date: string; url: string }[] = [];
    const msgRegex = /js-message_text" dir="auto">([\s\S]*?)<\/div>/g;
    const dateRegex = /datetime="([^"]+)"/g;

    const texts: string[] = [];
    let m;
    while ((m = msgRegex.exec(html)) !== null) {
      const raw = m[1].replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      if (raw.length > 20) texts.push(raw);
    }

    const dates: string[] = [];
    while ((m = dateRegex.exec(html)) !== null) {
      dates.push(m[1]);
    }

    // Pair texts with dates (dates appear for each message block)
    for (let i = 0; i < texts.length && i < 15; i++) {
      messages.push({
        text: texts[i],
        date: dates[i] || new Date().toISOString(),
        url: `https://t.me/${username}`,
      });
    }

    return messages.reverse().slice(0, 10).map((msg) => {
      // Use first 150 chars as title, rest as description
      const title = msg.text.length > 150
        ? msg.text.slice(0, 150).replace(/\s+\S*$/, "") + "..."
        : msg.text;
      const text = msg.text.toLowerCase();
      const keywords = KEYWORD_DICTIONARY.filter((kw) => text.includes(kw));
      const categories = ["OSINT", ...categorizeHeadline(text)];
      return {
        title,
        description: msg.text.slice(0, 200),
        source,
        url: msg.url,
        publishedAt: msg.date,
        keywords,
        categories,
      };
    });
  } catch {
    return [];
  }
}

// Free RSS feeds from major news outlets (no API key needed)
const RSS_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", name: "NYT" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera" },
  { url: "https://www.theguardian.com/world/rss", name: "Guardian" },
  { url: "https://feeds.skynews.com/feeds/rss/world.xml", name: "Sky News" },
];

export async function GET() {
  try {
    // Fetch all RSS feeds + Telegram channels in parallel
    const rssResults = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          next: { revalidate: 300 },
          headers: { "User-Agent": "PolyStream/1.0" },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSS(xml, feed.name);
      })
    );

    const telegramResults = await Promise.allSettled(
      TELEGRAM_CHANNELS.map((ch) => parseTelegram(ch.username, ch.name))
    );

    const allHeadlines = [
      ...rssResults
        .filter((r): r is PromiseFulfilledResult<ReturnType<typeof parseRSS>> => r.status === "fulfilled")
        .flatMap((r) => r.value),
      ...telegramResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof parseTelegram>>> => r.status === "fulfilled")
        .flatMap((r) => r.value),
    ];

    // Sort by publish date (most recent first), deduplicate by title similarity
    allHeadlines.sort((a, b) => {
      const dateA = new Date(a.publishedAt).getTime() || 0;
      const dateB = new Date(b.publishedAt).getTime() || 0;
      return dateB - dateA;
    });

    const seen = new Set<string>();
    const unique = allHeadlines.filter((h) => {
      const key = h.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length > 0) {
      return NextResponse.json({ headlines: unique.slice(0, 30), source: "live" });
    }
  } catch {}

  // Fallback to mock data if all feeds fail
  return NextResponse.json({
    headlines: [
      { title: "Markets React to Latest Federal Reserve Interest Rate Decision", description: "The Fed held rates steady amid inflation concerns", source: "Mock", url: "#", publishedAt: new Date().toISOString(), keywords: ["fed", "interest rate", "inflation"], categories: ["Finance"] },
      { title: "Bitcoin Surges Past Key Resistance Level", description: "Crypto markets see renewed institutional interest", source: "Mock", url: "#", publishedAt: new Date().toISOString(), keywords: ["bitcoin", "crypto"], categories: ["Crypto"] },
      { title: "Election Polls Show Tight Race in Key Swing States", description: "Latest polling data reveals competitive landscape", source: "Mock", url: "#", publishedAt: new Date().toISOString(), keywords: ["election", "vote"], categories: ["Politics"] },
    ],
    source: "mock",
  });
}
