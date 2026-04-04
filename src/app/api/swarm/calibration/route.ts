import { NextResponse } from "next/server";
import { getLiveCalibration } from "@/lib/calibration";

/**
 * GET /api/swarm/calibration
 * Returns live calibration data built from resolved swarm predictions.
 */
export async function GET() {
  try {
    const calibration = await getLiveCalibration();
    return NextResponse.json(calibration);
  } catch {
    return NextResponse.json({ error: "Failed to fetch calibration" }, { status: 500 });
  }
}
