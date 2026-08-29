/**
 * Alg 5 (docs/03) — sequential pick optimizer (survival-aware lookahead).
 * HIGH VALUE — do not weaken this. For each of the top-8 shortlist
 * candidates, simulate opponents to the user's next pick using common random
 * numbers (CRN) across all candidates, take the best available response
 * there, and average its value.
 *
 * Adaptive rollout budget (config/model.yaml lookahead): 500 -> 250 -> 100 ->
 * deterministic expected lookahead. Never drop below the deterministic floor.
 * Latency target < 1.0s, hard ceiling 1.5s.
 *
 * IMPLEMENT: algorithm-engineer.
 */

import type { PlayerRecord, DraftState } from "@/types";

export interface RolloutResult {
  candidatePlayerId: string;
  lookaheadValue: number;
  rolloutsUsed: number;
  seedBundle: string;
}

/**
 * FinalScore(p) = ImmediateScore(p) + 0.55 * z(LookaheadValue(p))
 * (weight from config/model.yaml lookahead.final_score_weight)
 */
export function computeFinalScore(immediateScore: number, lookaheadValueZ: number): number {
  throw new Error("not implemented: lookahead.computeFinalScore");
}

/**
 * Run CRN rollouts for every shortlist candidate, stepping the budget down
 * only if the latency budget is exceeded for this draft state.
 */
export async function runLookahead(
  shortlist: PlayerRecord[],
  availablePool: PlayerRecord[],
  state: DraftState
): Promise<RolloutResult[]> {
  throw new Error("not implemented: lookahead.runLookahead");
}

/**
 * Opponent pick policy for a single rollout step (docs/03 §Alg 5):
 * PositionScore = 0.45*market_best_at_pos + 0.25*roster_need
 *               + 0.20*manager_affinity + 0.10*run_pressure
 * choose position via softmax(T=0.8); then top-3 market players at pos: 70/20/10.
 */
export function opponentPickPolicy(
  managerSlot: number,
  availablePool: PlayerRecord[],
  state: DraftState,
  rngSeed: number
): PlayerRecord {
  throw new Error("not implemented: lookahead.opponentPickPolicy");
}

/**
 * Precompute hook: when the user is `lookahead.precompute_ahead_picks` picks
 * away, kick off the rollout in the background so it's ready before their
 * turn (docs/03 §Precompute while you wait). Caller decides transport
 * (in-memory cache, KV, etc.) — this just runs the computation.
 */
export async function precomputeIfUpcoming(
  state: DraftState,
  availablePool: PlayerRecord[]
): Promise<RolloutResult[] | null> {
  throw new Error("not implemented: lookahead.precomputeIfUpcoming");
}
