/**
 * POST /api/draft/undo -> revert last pick (docs/06). STUB:
 * deployment-engineer wires this to pop the KV `draft:log` and rebuild
 * `draft:state` from the remaining log (docs/09).
 */
import { NextResponse } from "next/server";
import type { DraftState } from "@/types";

export async function POST() {
  const placeholder: DraftState = {
    draft_id: "scaffold-stub",
    season: 2026,
    current_pick: 1,
    current_round: 1,
    on_the_clock_slot: 1,
    user_slot: 4,
    user_next_pick: 4,
    picks: [],
    rosters: [],
    drafted_player_ids: [],
    status: "not_started",
    last_updated: new Date(0).toISOString(),
  };
  return NextResponse.json(placeholder);
}
