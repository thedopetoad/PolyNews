import { NextResponse } from "next/server";
import { STREAM_CHANNELS } from "@/lib/constants";
import { getDb, youtubeStreamCache } from "@/db";
import { eq } from "drizzle-orm";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Only YouTube channels — Rumble has its own route.
const YT_CHANNELS = STREAM_CHANNELS.filter((c) => (c.platform ?? "youtube") === "youtube");

interface LiveStream {
  videoId: string;
  title: string;
}

interface ChannelResult {
  channelId: string;
  name: string;
  streams: LiveStream[];
}

/**
 * GET /api/youtube/live
 *
 * Returns live streams for all configured channels.
 * Uses database cache (30 min TTL) so ALL serverless instances
 * share the same data. Only hits YouTube API when cache expires.
 */
export async function GET() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const db = getDb();

  // Step 1: Try to load all channels from DB cache
  const cached = await db.select().from(youtubeStreamCache);
  const cacheMap = new Map(cached.map((c) => [c.channelId, c]));

  const now = Date.now();
  const allFresh = YT_CHANNELS.every((ch) => {
    const entry = cacheMap.get(ch.channelId);
    return entry && now - new Date(entry.updatedAt).getTime() < CACHE_TTL;
  });

  // If all channels are fresh in DB, return cached data (no API call)
  if (allFresh) {
    const results: ChannelResult[] = YT_CHANNELS.map((ch) => {
      const entry = cacheMap.get(ch.channelId);
      return {
        channelId: ch.channelId,
        name: ch.name,
        streams: entry ? JSON.parse(entry.streams) : [],
      };
    });
    return NextResponse.json({ results, cached: true });
  }

  // Step 2: Cache is stale — refresh from YouTube API
  if (!apiKey) {
    // No API key: return whatever we have in DB (even if stale)
    const results: ChannelResult[] = YT_CHANNELS.map((ch) => {
      const entry = cacheMap.get(ch.channelId);
      return {
        channelId: ch.channelId,
        name: ch.name,
        streams: entry ? JSON.parse(entry.streams) : [],
      };
    });
    return NextResponse.json({ results, cached: true, stale: true });
  }

  try {
    const results: ChannelResult[] = await Promise.all(
      YT_CHANNELS.map(async (ch) => {
        // Skip channels that are still fresh in cache
        const entry = cacheMap.get(ch.channelId);
        if (entry && now - new Date(entry.updatedAt).getTime() < CACHE_TTL) {
          return { channelId: ch.channelId, name: ch.name, streams: JSON.parse(entry.streams) };
        }

        try {
          const params = new URLSearchParams({
            key: apiKey,
            channelId: ch.channelId,
            type: "video",
            eventType: "live",
            part: "id,snippet",
            order: "viewCount",
            maxResults: "3",
          });

          const res = await fetch(`${YOUTUBE_API}/search?${params}`);
          if (!res.ok) {
            // On API error, return stale DB data
            return {
              channelId: ch.channelId,
              name: ch.name,
              streams: entry ? JSON.parse(entry.streams) : [],
            };
          }

          const data = await res.json();
          const streams: LiveStream[] = (data.items || []).map(
            (item: { id: { videoId: string }; snippet: { title: string } }) => ({
              videoId: item.id.videoId,
              title: item.snippet.title,
            })
          );

          // Save to DB cache (upsert)
          if (entry) {
            await db.update(youtubeStreamCache)
              .set({ streams: JSON.stringify(streams), updatedAt: new Date(), channelName: ch.name })
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

    return NextResponse.json({ results, cached: false });
  } catch {
    // Return whatever's in DB on total failure
    const results: ChannelResult[] = YT_CHANNELS.map((ch) => {
      const entry = cacheMap.get(ch.channelId);
      return {
        channelId: ch.channelId,
        name: ch.name,
        streams: entry ? JSON.parse(entry.streams) : [],
      };
    });
    return NextResponse.json({ results, cached: true, stale: true });
  }
}
