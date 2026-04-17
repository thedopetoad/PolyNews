import { NextRequest, NextResponse } from "next/server";
import { snapshotWeeklyPayouts } from "@/lib/airdrop-snapshot";

// GET /api/cron/weekly-snapshot
//
// Runs every Monday 17:00 UTC via Vercel Cron (`0 17 * * 1` in
// vercel.json). Snapshots the top 3 of each weekly leaderboard for
// the week that JUST ENDED.
//
// Locked down — this endpoint is the ONLY path outside the admin
// dashboard that can trigger a snapshot, and it REQUIRES a valid
// CRON_SECRET. If the env var isn't set, the endpoint refuses to
// run (not silently open like it used to be). Admin triggers the
// same logic via /api/admin/snapshot-now which uses Phantom session
// auth instead.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Cron not configured. Set CRON_SECRET in Vercel env to enable." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await snapshotWeeklyPayouts();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Weekly snapshot cron error:", err);
    return NextResponse.json(
      { error: "Cron error", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
