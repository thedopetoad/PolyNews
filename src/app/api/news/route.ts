import { NextResponse } from "next/server";
import { KEYWORD_DICTIONARY } from "@/lib/constants";

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
    return {
      title: item.title,
      description: item.description,
      source,
      url: item.link,
      publishedAt: item.pubDate || new Date().toISOString(),
      keywords,
    };
  });
}

// Free RSS feeds from major news outlets (no API key needed)
const RSS_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", name: "NYT" },
  { url: "https://feeds.npr.org/1001/rss.xml", name: "NPR" },
];

export async function GET() {
  try {
    // Fetch all RSS feeds in parallel
    const results = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          next: { revalidate: 300 }, // Cache for 5 minutes
          headers: { "User-Agent": "PolyStream/1.0" },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSS(xml, feed.name);
      })
    );

    const allHeadlines = results
      .filter((r): r is PromiseFulfilledResult<ReturnType<typeof parseRSS>> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    // Sort by most recent, deduplicate by title similarity
    const seen = new Set<string>();
    const unique = allHeadlines.filter((h) => {
      const key = h.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length > 0) {
      return NextResponse.json({ headlines: unique.slice(0, 15), source: "live" });
    }
  } catch {}

  // Fallback to mock data if all feeds fail
  return NextResponse.json({
    headlines: [
      { title: "Markets React to Latest Federal Reserve Interest Rate Decision", description: "The Fed held rates steady amid inflation concerns", source: "Mock", url: "#", publishedAt: new Date().toISOString(), keywords: ["fed", "interest rate", "inflation"] },
      { title: "Bitcoin Surges Past Key Resistance Level", description: "Crypto markets see renewed institutional interest", source: "Mock", url: "#", publishedAt: new Date().toISOString(), keywords: ["bitcoin", "crypto"] },
      { title: "Election Polls Show Tight Race in Key Swing States", description: "Latest polling data reveals competitive landscape", source: "Mock", url: "#", publishedAt: new Date().toISOString(), keywords: ["election", "vote"] },
    ],
    source: "mock",
  });
}
