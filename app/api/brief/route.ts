/**
 * GET /api/brief?season=2026&week=1&window=free -> the weekly brief (docs/10 §5).
 *
 * Reads a transcribed snapshot from disk and runs the deterministic engine. No
 * model call sits on this path, same rule as the draft recommendation route.
 */
import { NextResponse } from "next/server";
import { buildBrief } from "@/lib/season/brief";
import type { Window } from "@/lib/season/moves";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const season = Number(params.get("season") ?? 2026);
  const week = Number(params.get("week") ?? 1);
  const window = (params.get("window") === "faab" ? "faab" : "free") as Window;

  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    return NextResponse.json({ error: "season must be an integer and week 1-18" }, { status: 400 });
  }

  try {
    return NextResponse.json(buildBrief(season, week, window));
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to build brief";
    console.error("GET /api/brief failed", err);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
