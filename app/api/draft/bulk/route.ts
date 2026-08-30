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
import { getDraftStateStore, roundForPick, slotForPick, LEAGUE_TEAMS } from "@/lib/store";
import { loadPlayerPool } from "@/lib/players";
import { parseBulkPaste, type BulkParseMatch } from "@/lib/bulkParse";

interface BulkBody {
  text?: string;
  order?: "recent_first" | "oldest_first";
}

const PICK_LABEL_RE = /^(\d{1,2})\.(\d{1,2})$/;

/**
 * "round.pick" labels (e.g. "3.04") number picks by position within their
 * round in true chronological order, independent of snake direction — so the
 * overall pick number is always (round-1)*teams + posInRound. This is what
 * lets a grid-style draft board (columns=teams, rows=rounds, pastes in DOM
 * order rather than chronological order) still resolve to the right pick.
 */
function overallPickFromLabel(label: string, teams: number): number | null {
  const m = PICK_LABEL_RE.exec(label);
  if (!m) return null;
  const round = Number(m[1]);
  const posInRound = Number(m[2]);
  if (!round || !posInRound || posInRound > teams) return null;
  return (round - 1) * teams + posInRound;
}

export async function POST(request: Request) {
  const body = (await request.json()) as BulkBody;
  if (!body?.text || !body.text.trim()) {
    return NextResponse.json({ error: "paste some text first" }, { status: 400 });
  }

  const store = getDraftStateStore();
  const { players } = loadPlayerPool();
  const state = await store.getState();

  const { matched, already_drafted, unresolved } = parseBulkPaste(
    body.text,
    players,
    new Set(state.drafted_player_ids),
    body.order ?? "recent_first"
  );

  const observedAt = new Date().toISOString();
  const byPickNumber = new Map<number, BulkParseMatch>();
  // Sequential fallback only advances for entries with no "round.pick" label
  // (a plain CBS "last N picks" feed) — labeled entries (a pasted grid) get
  // their real overall pick number straight from the label instead of guess
  // order, since a grid's paste order isn't chronological pick order.
  let sequentialPick = state.current_pick;
  const events: DraftEvent[] = matched.map((m) => {
    const labeledPick = m.pick_label ? overallPickFromLabel(m.pick_label, LEAGUE_TEAMS) : null;
    const pickNumber = labeledPick ?? sequentialPick;
    sequentialPick = pickNumber + 1;
    byPickNumber.set(pickNumber, m);
    return {
      event_type: "draft_pick",
      source: "manual",
      source_event_id: `bulk-${m.player_id}-${pickNumber}`,
      pick_number: pickNumber,
      round: roundForPick(pickNumber),
      manager_slot: slotForPick(pickNumber),
      player_source_id: null,
      player_id: m.player_id,
      player_name: m.player_name,
      position: m.position,
      nfl_team: "",
      observed_at: observedAt,
    };
  });

  const result = await store.applyEvents(events);

  return NextResponse.json({
    state: result.state,
    applied: result.applied.map((e) => byPickNumber.get(e.pick_number)!),
    already_drafted,
    unresolved,
    failed: result.failed.map((f) => ({
      raw_line: byPickNumber.get(f.event.pick_number)?.raw_line ?? f.event.player_name,
      error: f.error,
    })),
  });
}
