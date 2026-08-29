/**
 * POST /api/draft/pick -> record a pick (manual or provider); body = canonical
 * DraftEvent (docs/06, docs/04). Wired to lib/store.ts (in-memory for now;
 * deployment-engineer swaps in KV `draft:state` / `draft:log` with the same
 * interface — nothing here needs to change). This is the anchor path — must
 * stay fast and available even if all live providers are down.
 */
import { NextResponse } from "next/server";
import type { DraftEvent } from "@/types";
import { getDraftStateStore } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<DraftEvent>;

  if (!body || typeof body.pick_number !== "number" || !body.player_name) {
    return NextResponse.json(
      { error: "invalid draft event: pick_number and player_name are required" },
      { status: 400 }
    );
  }

  const event: DraftEvent = {
    event_type: body.event_type ?? "draft_pick",
    source: body.source ?? "manual",
    source_event_id: body.source_event_id ?? `manual-${body.pick_number}-${Date.now()}`,
    pick_number: body.pick_number,
    round: body.round ?? Math.ceil(body.pick_number / 12),
    manager_slot: body.manager_slot ?? 0,
    player_source_id: body.player_source_id ?? null,
    player_id: body.player_id ?? null,
    player_name: body.player_name,
    position: body.position ?? "RB",
    nfl_team: body.nfl_team ?? "",
    observed_at: body.observed_at ?? new Date().toISOString(),
  };

  try {
    const store = getDraftStateStore();
    const state = await store.applyEvent(event);
    return NextResponse.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to apply pick";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
