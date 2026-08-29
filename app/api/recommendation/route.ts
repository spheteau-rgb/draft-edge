/**
 * GET /api/recommendation -> the pick + alternatives (docs/06). STUB:
 * algorithm-engineer wires this to /lib (vorp, lineup, market, survival,
 * lookahead, reasons) reading players.json (cached) + draft:state (KV).
 * Never calls an LLM, never blocks on a slow network call (CLAUDE.md
 * non-negotiable #1). Target <1s; fall down the ladder in docs/04 on any
 * component failure but ALWAYS return a recommendation.
 */
import { NextResponse } from "next/server";
import type { Recommendation } from "@/types";

export async function GET() {
  const placeholder: Recommendation = {
    pick_number: 1,
    recommended_player_id: "",
    recommended_player_name: "",
    position: "RB",
    decision_confidence: "LOW",
    score: 0,
    survival_to_next_pick: 0,
    reasons: [],
    fundamental_rank: 0,
    league_market_rank: 0,
    do_not_reach_flag: false,
    data_freshness: "RED",
    alternatives: [],
    expected_alternative_if_wait: null,
    edge_vs_runner_up: null,
  };
  return NextResponse.json(placeholder);
}
