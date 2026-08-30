/**
 * GET /api/recommendation -> the pick + alternatives (docs/06). Wired to
 * /lib/optimizer.ts (vorp, lineup, market, survival, lookahead, reasons)
 * reading data/players.json (cached in module scope) + the draft state
 * store (in-memory for now; deployment-engineer swaps in KV — see
 * lib/store.ts). Never calls an LLM, never blocks on a slow network call
 * (CLAUDE.md non-negotiable #1). getRecommendation() never throws — it
 * falls down the ladder in docs/04 on any component failure but ALWAYS
 * returns a recommendation; this handler's try/catch is a second safety
 * net around the state/player-pool reads themselves.
 */
import { NextResponse } from "next/server";
import type { Recommendation } from "@/types";
import { getDraftStateStore } from "@/lib/store";
import { loadPlayerPool } from "@/lib/players";
import { getRecommendation } from "@/lib/optimizer";
import { getCommunityNote } from "@/lib/communityNotes";

// Must be recomputed every request against live draft state — never served
// from Next.js's static/CDN cache (CLAUDE.md non-negotiable #1: the rec must
// always reflect who's actually been drafted, not a stale build-time snapshot).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = getDraftStateStore();
    const state = await store.getState();
    const { players } = loadPlayerPool();
    const recommendation = await getRecommendation(state, players);
    // Advisory-only enrichment, attached after the optimizer runs so web-research
    // notes can never influence score/rank/reason-code math (CLAUDE.md non-negotiable #1).
    if (recommendation.recommended_player_id) {
      recommendation.community_note = getCommunityNote(recommendation.recommended_player_id);
    }
    recommendation.alternatives = recommendation.alternatives.map((alt) => ({
      ...alt,
      community_note: getCommunityNote(alt.player_id),
    }));
    return NextResponse.json(recommendation);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("GET /api/recommendation: unrecoverable failure, returning safe placeholder", err);
    const placeholder: Recommendation = {
      pick_number: 1,
      is_user_on_the_clock: false,
      picks_until_your_turn: 0,
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
}
