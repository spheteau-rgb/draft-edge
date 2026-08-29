/**
 * GET /api/players -> current available pool (cached, scored) (docs/06).
 * data/players.json is read once and cached in module scope (lib/players.ts,
 * docs/09), then merged with live draft:state so `is_drafted` /
 * `drafted_by_slot` reflect the actual draft, not the static precompute.
 */
import { NextResponse } from "next/server";
import type { PlayerRecord } from "@/types";
import { loadPlayerPool } from "@/lib/players";
import { getDraftStateStore } from "@/lib/store";

// is_drafted/drafted_by_slot depend on live draft state — must not be
// statically cached (CLAUDE.md: every device sees one shared live draft).
export const dynamic = "force-dynamic";

export async function GET() {
  const { players, source } = loadPlayerPool();
  const store = getDraftStateStore();
  const state = await store.getState();
  const draftedIds = new Set(state.drafted_player_ids);
  const pickByPlayer = new Map(state.picks.map((p) => [p.player_id, p.manager_slot]));

  const merged: PlayerRecord[] = players.map((p) => ({
    ...p,
    is_drafted: draftedIds.has(p.player_id) || p.is_drafted,
    drafted_by_slot: pickByPlayer.get(p.player_id) ?? p.drafted_by_slot,
  }));

  const body: { players: PlayerRecord[]; source: string } = { players: merged, source };
  return NextResponse.json(body);
}
