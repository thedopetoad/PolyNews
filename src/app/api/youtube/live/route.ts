import { NextRequest, NextResponse } from "next/server";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

interface LiveStream {
  videoId: string;
  title: string;
}

// In-memory cache: channelId -> { streams, timestamp }
const cache = new Map<string, { streams: LiveStream[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/youtube/live?channelId=UCXXX
 *
 * Finds currently live streams for a YouTube channel using the Data API v3.
 * Returns up to 5 live streams with videoId and title.
 * Results are cached for 5 minutes to conserve API quota.
 */
export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "Missing channelId" }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 });
  }

  // Check cache
  const cached = cache.get(channelId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ streams: cached.streams, cached: true });
  }

  try {
    const params = new URLSearchParams({
      key: apiKey,
      channelId,
      type: "video",
      eventType: "live",
      part: "snippet,id",
      order: "viewCount",
      maxResults: "5",
    });

    const res = await fetch(`${YOUTUBE_API}/search?${params}`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("YouTube API error:", err);
      // Return cached data if available, even if stale
      if (cached) {
        return NextResponse.json({ streams: cached.streams, cached: true, stale: true });
      }
      return NextResponse.json({ error: "YouTube API error", streams: [] }, { status: 502 });
    }

    const data = await res.json();
    const streams: LiveStream[] = (data.items || []).map((item: { id: { videoId: string }; snippet: { title: string } }) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
    }));

    // Update cache
    cache.set(channelId, { streams, timestamp: Date.now() });

    return NextResponse.json({ streams, cached: false });
  } catch {
    // Return cached data on error
    if (cached) {
      return NextResponse.json({ streams: cached.streams, cached: true, stale: true });
    }
    return NextResponse.json({ error: "Failed to fetch", streams: [] }, { status: 502 });
  }
}
