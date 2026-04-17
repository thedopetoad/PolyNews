import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { snapshotWeeklyPayouts } from "@/lib/airdrop-snapshot";

// POST /api/admin/snapshot-now
//
// Admin-triggered manual snapshot. Calls the shared snapshot lib
// directly — no HTTP round-trip through the cron URL, which keeps
// this path completely independent of CRON_SECRET.
export async function POST(request: NextRequest) {
  const admin = requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await snapshotWeeklyPayouts();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Admin snapshot-now error:", err);
    return NextResponse.json(
      { error: "Snapshot error", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
