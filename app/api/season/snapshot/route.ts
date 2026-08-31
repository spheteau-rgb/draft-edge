/**
 * GET  /api/season/snapshot?season=&week= -> what is currently stored for that week
 * POST /api/season/snapshot                -> replace that week's snapshot
 *
 * Snapshot-replace, not append (docs/10 §2): re-uploading a week overwrites it,
 * so a re-transcription after fixing a bad screenshot is safe and idempotent.
 */
import { NextResponse } from "next/server";
import type { WeekSnapshot } from "@/lib/season/snapshot";
import { loadWeekSnapshot, saveWeekSnapshot } from "@/lib/season/store";

export const dynamic = "force-dynamic";

function badWeek(season: number, week: number): boolean {
  return !Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const season = Number(params.get("season") ?? 2026);
  const week = Number(params.get("week") ?? 1);
  if (badWeek(season, week)) {
    return NextResponse.json({ error: "season must be an integer and week 1-18" }, { status: 400 });
  }

  try {
    return NextResponse.json({ snapshot: await loadWeekSnapshot(season, week) });
  } catch (err) {
    console.error("GET /api/season/snapshot failed", err);
    return NextResponse.json({ error: "failed to read snapshot" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let snapshot: WeekSnapshot;
  try {
    snapshot = (await request.json()) as WeekSnapshot;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (badWeek(Number(snapshot?.season), Number(snapshot?.week))) {
    return NextResponse.json({ error: "season must be an integer and week 1-18" }, { status: 400 });
  }
  if (!snapshot.my_team || !Array.isArray(snapshot.my_team.players) || snapshot.my_team.players.length === 0) {
    return NextResponse.json({ error: "my_team.players is required and must be non-empty" }, { status: 400 });
  }

  const record: WeekSnapshot = {
    ...snapshot,
    captured_at: snapshot.captured_at ?? new Date().toISOString(),
    source: snapshot.source ?? "screenshot-upload",
    free_agents: snapshot.free_agents ?? [],
    transactions: snapshot.transactions ?? [],
  };

  try {
    await saveWeekSnapshot(record);
    return NextResponse.json({ ok: true, season: record.season, week: record.week });
  } catch (err) {
    console.error("POST /api/season/snapshot failed", err);
    return NextResponse.json({ error: "failed to save snapshot" }, { status: 500 });
  }
}
