import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * GET /api/admin/me
 *   Lightweight endpoint for the /admin page to ask "am I already logged in?"
 *   on mount. Returns { ok: true, pubkey } for a valid session, 401 otherwise.
 *   Avoids showing the sign-in button when the admin has a fresh cookie.
 */
export async function GET(req: NextRequest) {
  const session = requireAdmin(req);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, pubkey: session.pubkey });
}
