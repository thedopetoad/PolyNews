import { NextRequest, NextResponse } from "next/server";
import { getStationForTeam } from "@/lib/sports-radio";

export async function GET(req: NextRequest) {
  const team = req.nextUrl.searchParams.get("team");
  if (!team) {
    return NextResponse.json({ error: "team required" }, { status: 400 });
  }

  const station = getStationForTeam(team);
  return NextResponse.json({ station });
}
