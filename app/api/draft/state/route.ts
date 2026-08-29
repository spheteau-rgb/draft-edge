/**
 * GET /api/draft/state -> canonical state (picks, on-the-clock, your next
 * pick) (docs/06). STUB: deployment-engineer wires this to Vercel KV
 * (`draft:state`, docs/09). State is server-side only — never trust
 * device-local state.
 */
import { NextResponse } from "next/server";
import type { DraftState } from "@/types";

export async function GET() {
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
