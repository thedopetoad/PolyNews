import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Allowed domains for radio stream proxying — prevents SSRF
const ALLOWED_HOSTS = [
  "stream.revma.iheart.com",
  "playerservices.streamtheworld.com",
  "live.amperwave.net",
  "stream.radiojar.com",
  "ice.cr1.streamzilla.xlcdn.com",
  "espn.streamguys1.com",
  "stream.espn.com",
  "tunein.com",
  "opml.radiotime.com",
  "cdn-profiles.tunein.com",
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  // Validate URL format and domain
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "Invalid protocol" }, { status: 400 });
  }

  const isAllowed = ALLOWED_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith("." + host));
  if (!isAllowed) {
    return NextResponse.json({ error: "Domain not allowed" }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PolyStream/1.0)" },
    });

    if (!res.ok || !res.body) {
      return new NextResponse("Stream unavailable", { status: 502 });
    }

    // Use upstream Content-Type if available, fallback to audio/aac
    const contentType = res.headers.get("Content-Type") || "audio/aac";

    return new NextResponse(res.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse("Stream error", { status: 502 });
  }
}
