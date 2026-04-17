import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// POST /api/admin/snapshot-now
//
// Admin-triggered manual snapshot — re-uses the cron endpoint's logic
// by calling it with the right CRON_SECRET header (or without auth if
// the env var isn't set). Useful for testing or if the Monday cron
// missed/needs re-running.
//
// Admin-gated via requireAdmin() on the way in.
export async function POST(request: NextRequest) {
  const admin = requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const cronSecret = process.env.CRON_SECRET;
    const host = request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const url = `${proto}://${host}/api/cron/weekly-snapshot`;
    const headers: HeadersInit = cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
    const res = await fetch(url, { headers, cache: "no-store" });
    const data = await res.json();
    return NextResponse.json({ forwarded: data, status: res.status });
  } catch (err) {
    console.error("Admin snapshot-now error:", err);
    return NextResponse.json({ error: "Relay error" }, { status: 500 });
  }
}
