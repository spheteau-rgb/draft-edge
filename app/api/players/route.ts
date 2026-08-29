/**
 * GET /api/players -> current available pool (cached, scored) (docs/06).
 * STUB: data-engineer's precompute/build_players.py writes data/players.json;
 * this handler should read it once and cache in module scope (docs/09 —
 * "runtime reads it once and caches in module scope; never refetches per
 * request"), then subtract drafted players using draft:state.
 */
import { NextResponse } from "next/server";
import type { PlayerRecord } from "@/types";

export async function GET() {
  const placeholder: { players: PlayerRecord[]; source: string } = {
    players: [],
    source: "scaffold-stub",
  };
  return NextResponse.json(placeholder);
}
