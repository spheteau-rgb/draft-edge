/**
 * POST /api/draft/bulk -> parse a pasted block of CBS draft-board rows (or
 * plain player names) and apply every confidently-resolved, not-yet-drafted
 * pick in one shot. Built for "I'm not going to sit and watch the draft the
 * whole time" — paste the last N rows whenever you check back in, and the
 * app catches the state up. No LLM in this path (CLAUDE.md non-negotiable
 * #1); lib/bulkParse.ts does plain substring matching against the
 * precomputed player pool.
 */
import { NextResponse } from "next/server";
import type { DraftEvent } from "@/types";
import { getDraftStateStore } from "@/lib/store";
import { loadPlayerPool } from "@/lib/players";
import { parseBulkPaste, type BulkParseMatch } from "@/lib/bulkParse";

interface BulkBody {
  text?: string;
  order?: "recent_first" | "oldest_first";
}

export async function POST(request: Request) {
  const body = (await request.json()) as BulkBody;
  if (!body?.text || !body.text.trim()) {
    return NextResponse.json({ error: "paste some text first" }, { status: 400 });
  }

  const store = getDraftStateStore();
  const { players } = loadPlayerPool();
  let state = await store.getState();

  const { matched, already_drafted, unresolved } = parseBulkPaste(
    body.text,
    players,
    new Set(state.drafted_player_ids),
    body.order ?? "recent_first"
  );

  const applied: BulkParseMatch[] = [];
  const failed: { raw_line: string; error: string }[] = [];

  for (const m of matched) {
    const event: DraftEvent = {
      event_type: "draft_pick",
      source: "manual",
      source_event_id: `bulk-${m.player_id}-${Date.now()}`,
      pick_number: state.current_pick,
      round: state.current_round,
      manager_slot: state.on_the_clock_slot,
      player_source_id: null,
      player_id: m.player_id,
      player_name: m.player_name,
      position: m.position,
      nfl_team: "",
      observed_at: new Date().toISOString(),
    };
    try {
      state = await store.applyEvent(event);
      applied.push(m);
    } catch (err) {
      failed.push({ raw_line: m.raw_line, error: err instanceof Error ? err.message : "failed to apply" });
    }
  }

  return NextResponse.json({
    state,
    applied,
    already_drafted,
    unresolved,
    failed,
  });
}
