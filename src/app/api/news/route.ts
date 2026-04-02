import { NextResponse } from "next/server";
import { KEYWORD_DICTIONARY } from "@/lib/constants";

// Fetch top headlines and extract keywords
// MVP: Uses NewsAPI when key is available, falls back to mock data
export async function GET() {
  const apiKey = process.env.NEWS_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch(
        `https://newsapi.org/v2/top-headlines?country=us&pageSize=20&apiKey=${apiKey}`,
        { next: { revalidate: 300 } }
      );
      const data = await res.json();

      if (data.articles) {
        const headlines = data.articles.map(
          (a: { title?: string; description?: string; source?: { name?: string }; url?: string; publishedAt?: string }) => {
            const text = `${a.title || ""} ${a.description || ""}`.toLowerCase();
            const keywords = KEYWORD_DICTIONARY.filter((kw) =>
              text.includes(kw)
            );
            return {
              title: a.title,
              description: a.description,
              source: a.source?.name || "Unknown",
              url: a.url,
              publishedAt: a.publishedAt,
              keywords,
            };
          }
        );
        return NextResponse.json({ headlines, source: "newsapi" });
      }
    } catch {}
  }

  // Fallback: generate mock headlines based on popular Polymarket topics
  const mockHeadlines = [
    {
      title: "Markets React to Latest Federal Reserve Interest Rate Decision",
      description: "The Fed held rates steady amid inflation concerns",
      source: "Mock News",
      url: "#",
      publishedAt: new Date().toISOString(),
      keywords: ["fed", "interest rate", "inflation"],
    },
    {
      title: "Bitcoin Surges Past Key Resistance Level as ETF Inflows Continue",
      description: "Crypto markets see renewed institutional interest",
      source: "Mock News",
      url: "#",
      publishedAt: new Date().toISOString(),
      keywords: ["bitcoin", "crypto", "etf"],
    },
    {
      title: "Election Polls Show Tight Race in Key Swing States",
      description: "Latest polling data reveals competitive landscape",
      source: "Mock News",
      url: "#",
      publishedAt: new Date().toISOString(),
      keywords: ["election", "vote"],
    },
    {
      title: "AI Companies Report Record Revenue as Enterprise Adoption Accelerates",
      description: "OpenAI, Google, and Meta lead the charge in AI deployment",
      source: "Mock News",
      url: "#",
      publishedAt: new Date().toISOString(),
      keywords: ["ai", "openai", "google", "meta"],
    },
    {
      title: "Ukraine Peace Negotiations Enter Critical Phase",
      description: "International pressure mounts for diplomatic resolution",
      source: "Mock News",
      url: "#",
      publishedAt: new Date().toISOString(),
      keywords: ["ukraine", "russia", "nato"],
    },
    {
      title: "SpaceX Starship Completes Latest Test Flight Successfully",
      description: "Milestone achieved in reusable rocket development",
      source: "Mock News",
      url: "#",
      publishedAt: new Date().toISOString(),
      keywords: ["spacex", "starship", "nasa"],
    },
  ];

  return NextResponse.json({ headlines: mockHeadlines, source: "mock" });
}
