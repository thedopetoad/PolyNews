import { NextRequest, NextResponse } from "next/server";
import { getDb, newsWatchHeartbeats } from "@/db";
import { getAuthenticatedUser, generateSecureId } from "@/lib/auth";
import { heartbeatBucket, isoWeekKey } from "@/lib/week";

// POST /api/airdrop/news-heartbeat
// Client calls this every 15 seconds while the news tab is visible.
// We dedupe via unique(userId, bucket) — so even if the client sends
// multiple heartbeats for the same 15-second bucket, only one row lands.
// After the user accumulates 20 distinct buckets in the current ISO
// week (= 5 minutes of watch time) they can claim via /claim-news.
export async function POST(request: NextRequest) {
  const authedUser = getAuthenticatedUser(request);
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const bucket = heartbeatBucket();
    const weekKey = isoWeekKey();

    // Insert; swallow unique-violation (bucket already recorded).
    await db
      .insert(newsWatchHeartbeats)
      .values({
        id: generateSecureId(),
        userId: authedUser,
        bucket,
        weekKey,
      })
      .onConflictDoNothing({
        target: [newsWatchHeartbeats.userId, newsWatchHeartbeats.bucket],
      });

    return NextResponse.json({ ok: true, bucket, weekKey });
  } catch (err) {
    console.error("News heartbeat error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
