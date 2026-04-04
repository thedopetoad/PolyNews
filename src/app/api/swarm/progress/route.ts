import { NextResponse } from "next/server";
import { getProgress } from "@/lib/swarm-progress";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getProgress());
}
