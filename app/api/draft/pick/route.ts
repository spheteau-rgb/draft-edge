/**
 * POST /api/draft/pick -> record a pick (manual or provider); body = canonical
 * DraftEvent (docs/06, docs/04). STUB: deployment-engineer wires this to KV
 * (`draft:state`, append to `draft:log`) with reconciliation by pick_number
 * (docs/04 §Reconciliation). This is the anchor path — must stay fast (<2s
 * observed->updated) and available even if all live providers are down.
 */
import { NextResponse } from "next/server";
import type { DraftEvent, DraftState } from "@/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<DraftEvent>;

  if (!body || typeof body.pick_number !== "number" || !body.player_name) {
    return NextResponse.json(
      { error: "invalid draft event: pick_number and player_name are required" },
      { status: 400 }
    );
  }

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
