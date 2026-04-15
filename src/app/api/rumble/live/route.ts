import { NextResponse } from "next/server";
import { STREAM_CHANNELS } from "@/lib/constants";
import { getDb, youtubeStreamCache } from "@/db";
import { eq } from "drizzle-orm";

// Short TTL — Rumble streams come and go more abruptly than YT.
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

interface LiveStream {
  videoId: string; // Rumble embed ID (e.g. "v64cgzd"), NOT the page slug.
  title: string;
}

interface ChannelResult {
  channelId: string;
  name: string;
  streams: LiveStream[];
}

const RUMBLE_CHANNELS = STREAM_CHANNELS.filter((c) => c.platform === "rumble");

/**
 * Scrape a channel's livestreams page and resolve each live video's embed ID
 * via oEmbed. Returns up to 3 current live streams.
 */
async function fetchRumbleChannel(slug: string): Promise<LiveStream[]> {
  const pageUrl = `https://rumble.com/c/${slug}/livestreams`;
  const res = await fetch(pageUrl, {
    headers: { "user-agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const html = await res.text();

  // Only pick hrefs that are preceded by the "videostream__status--live"
  // badge — that's how Rumble marks currently-live items on the page.
  const liveHrefs: string[] = [];
  const pattern = /videostream__status--live[\s\S]{0,3000}?href="(\/v[a-z0-9]+-[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) && liveHrefs.length < 3) {
    liveHrefs.push(m[1]);
  }
  if (liveHrefs.length === 0) return [];

  // Resolve page URL → embed ID via oEmbed.
  const streams: LiveStream[] = [];
  for (const href of liveHrefs) {
    const clean = href.split("?")[0];
    const pageUrlAbs = `https://rumble.com${clean}`;
    try {
      const oRes = await fetch(
        `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(pageUrlAbs)}`,
        { headers: { "user-agent": "Mozilla/5.0" }, cache: "no-store" }
      );
      if (!oRes.ok) continue;
      const data = await oRes.json();
      const embedMatch = /rumble\.com\/embed\/([a-z0-9]+)\//.exec(data.html || "");
      if (!embedMatch) continue;
      streams.push({ videoId: embedMatch[1], title: data.title || "" });
    } catch {
      // skip on error
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
      const fresh =
        entry && now - new Date(entry.updatedAt).getTime() < CACHE_TTL;
      if (fresh && entry) {
        return {
          channelId: ch.channelId,
          name: ch.name,
          streams: JSON.parse(entry.streams),
        };
      }

      try {
        const streams = await fetchRumbleChannel(ch.channelId);
        if (entry) {
          await db
            .update(youtubeStreamCache)
            .set({
              streams: JSON.stringify(streams),
              updatedAt: new Date(),
              channelName: ch.name,
            })
            .where(eq(youtubeStreamCache.channelId, ch.channelId));
        } else {
          await db.insert(youtubeStreamCache).values({
            channelId: ch.channelId,
            channelName: ch.name,
            streams: JSON.stringify(streams),
          });
        }
        return { channelId: ch.channelId, name: ch.name, streams };
      } catch {
        return {
          channelId: ch.channelId,
          name: ch.name,
          streams: entry ? JSON.parse(entry.streams) : [],
        };
      }
    })
  );

  return NextResponse.json({ results });
}
