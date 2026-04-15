import { NextResponse } from "next/server";
import { STREAM_CHANNELS } from "@/lib/constants";
import { getDb, youtubeStreamCache } from "@/db";
import { eq } from "drizzle-orm";

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface LiveStream {
  videoId: string; // Rumble embed ID (e.g. "v64cgzd"), NOT the page slug.
  title: string;
}

interface ChannelResult {
  channelId: string;
  name: string;
  streams: LiveStream[];
}

// Channels with a known 24/7 live page. If scraping / oEmbed fails we still
// show these as live using the hardcoded embed ID. oEmbed is called each
// refresh to pick up the freshest embed ID should Rumble ever rotate it.
const ALWAYS_LIVE_FALLBACKS: Record<
  string,
  { pageUrl: string; fallbackEmbedId: string; title: string }
> = {
  TheAlexJonesShow: {
    pageUrl: "https://rumble.com/v66kw07-infowars-network-feed-live-247.html",
    fallbackEmbedId: "v64cgzd",
    title: "ALEX JONES NETWORK FEED: LIVE 247!",
  },
};

const RUMBLE_CHANNELS = STREAM_CHANNELS.filter((c) => c.platform === "rumble");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function resolveEmbed(pageUrl: string): Promise<LiveStream | null> {
  try {
    const res = await fetch(
      `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(pageUrl)}`,
      { headers: { "user-agent": UA }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { html?: string; title?: string };
    const m = /rumble\.com\/embed\/([a-z0-9]+)\//.exec(data.html || "");
    if (!m) return null;
    return { videoId: m[1], title: data.title || "" };
  } catch {
    return null;
  }
}

async function scrapeLiveHrefs(slug: string): Promise<string[]> {
  try {
    const res = await fetch(`https://rumble.com/c/${slug}/livestreams`, {
      headers: { "user-agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    // Pick hrefs preceded within ~3000 chars by the LIVE status badge class.
    // There's one CSS rule and one HTML usage of the class; the CSS one has
    // no nearby href so regex backtracking skips it.
    const pattern =
      /videostream__status--live[\s\S]{0,3000}?href="(\/v[a-z0-9]+-[^"]+)"/g;
    const hrefs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) && hrefs.length < 3) {
      hrefs.push(m[1].split("?")[0]);
    }
    return hrefs;
  } catch {
    return [];
  }
}

async function fetchRumbleChannel(slug: string): Promise<LiveStream[]> {
  const streams: LiveStream[] = [];
  const seen = new Set<string>();

  // Strategy 1: scrape livestreams page, resolve each entry via oEmbed.
  for (const href of await scrapeLiveHrefs(slug)) {
    const s = await resolveEmbed(`https://rumble.com${href}`);
    if (s && !seen.has(s.videoId)) {
      streams.push(s);
      seen.add(s.videoId);
    }
  }

  // Strategy 2: always-live fallback. Try oEmbed on the stable URL first,
  // but if that fails we fall back to the hardcoded embed so the tab
  // never goes dark for a channel that's truly 24/7.
  const fb = ALWAYS_LIVE_FALLBACKS[slug];
  if (fb) {
    const live = await resolveEmbed(fb.pageUrl);
    const resolved: LiveStream = live || {
      videoId: fb.fallbackEmbedId,
      title: fb.title,
    };
    if (!seen.has(resolved.videoId)) {
      streams.push(resolved);
      seen.add(resolved.videoId);
    }
  }

  return streams;
}

export async function GET() {
  if (RUMBLE_CHANNELS.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const db = getDb();
  const cached = await db.select().from(youtubeStreamCache);
  const cacheMap = new Map(cached.map((c) => [c.channelId, c]));
  const now = Date.now();

  const results: ChannelResult[] = await Promise.all(
    RUMBLE_CHANNELS.map(async (ch) => {
      const entry = cacheMap.get(ch.channelId);
      const age = entry ? now - new Date(entry.updatedAt).getTime() : Infinity;
      const cachedStreams: LiveStream[] = entry
        ? JSON.parse(entry.streams)
        : [];

      // Use cache only if it's fresh AND non-empty. Empty cache always
      // re-fetches — an empty result means either truly offline or a
      // transient scrape error; re-trying costs little and avoids
      // pinning "offline" for 10 min because of one bad fetch.
      if (age < CACHE_TTL && cachedStreams.length > 0) {
        return {
          channelId: ch.channelId,
          name: ch.name,
          streams: cachedStreams,
        };
      }

      try {
        const streams = await fetchRumbleChannel(ch.channelId);

        // Only write cache on a non-empty result.
        if (streams.length > 0) {
          const payload = {
            streams: JSON.stringify(streams),
            updatedAt: new Date(),
            channelName: ch.name,
          };
          if (entry) {
            await db
              .update(youtubeStreamCache)
              .set(payload)
              .where(eq(youtubeStreamCache.channelId, ch.channelId));
          } else {
            await db
              .insert(youtubeStreamCache)
              .values({ channelId: ch.channelId, ...payload });
          }
        }

        return { channelId: ch.channelId, name: ch.name, streams };
      } catch {
        return {
          channelId: ch.channelId,
          name: ch.name,
          streams: cachedStreams,
        };
      }
    })
  );

  return NextResponse.json({ results });
}
