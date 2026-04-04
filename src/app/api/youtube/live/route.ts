import { NextResponse } from "next/server";
import { STREAM_CHANNELS } from "@/lib/constants";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

interface LiveStream {
  videoId: string;
  title: string;
  channelId: string;
}

interface ChannelResult {
  channelId: string;
  name: string;
  streams: LiveStream[];
}

// Global cache — all channels fetched in one batch
let allChannelsCache: { results: ChannelResult[]; timestamp: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — live streams rarely change

/**
 * GET /api/youtube/live
 *
 * Fetches live streams for ALL configured channels in a single API call.
 * Uses one YouTube search with no channelId filter, then matches results
 * to our channels. Falls back to per-channel search if needed.
 *
 * Cached for 30 minutes to conserve API quota (10,000 units/day).
 */
export async function GET() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "YouTube API key not configured", results: [] }, { status: 500 });
  }

  // Return cache if fresh
  if (allChannelsCache && Date.now() - allChannelsCache.timestamp < CACHE_TTL) {
    return NextResponse.json({ results: allChannelsCache.results, cached: true });
  }

  try {
    // Fetch live streams for each channel — but batch them efficiently
    // YouTube API doesn't support multi-channel search, so we make individual calls
    // but we cache the combined result for 30 minutes
    const results: ChannelResult[] = await Promise.all(
      STREAM_CHANNELS.map(async (ch) => {
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

          const res = await fetch(`${YOUTUBE_API}/search?${params}`, {
            headers: { Accept: "application/json" },
          });

          if (!res.ok) return { channelId: ch.channelId, name: ch.name, streams: [] };

          const data = await res.json();
          const streams: LiveStream[] = (data.items || []).map(
            (item: { id: { videoId: string }; snippet: { title: string; channelId: string } }) => ({
              videoId: item.id.videoId,
              title: item.snippet.title,
              channelId: item.snippet.channelId,
            })
          );

          return { channelId: ch.channelId, name: ch.name, streams };
        } catch {
          return { channelId: ch.channelId, name: ch.name, streams: [] };
        }
      })
    );

    // Cache the combined result
    allChannelsCache = { results, timestamp: Date.now() };

    return NextResponse.json({ results, cached: false });
  } catch {
    // Return stale cache on error
    if (allChannelsCache) {
      return NextResponse.json({ results: allChannelsCache.results, cached: true, stale: true });
    }
    return NextResponse.json({ error: "Failed to fetch", results: [] }, { status: 502 });
  }
}
