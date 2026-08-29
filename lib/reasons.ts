/**
 * Alg 3/5 (docs/03) — reason codes (max 3, template-filled, no LLM) and
 * confidence label from score separation.
 *
 * IMPLEMENT: algorithm-engineer.
 */

import type { PlayerRecord, DecisionConfidence, ReasonCode } from "@/types";

export interface ScoredCandidate {
  player: PlayerRecord;
  finalScore: number;
  survivalToNextPick: number;
  rosterGain: number;
  urgency: number;
  market: number;
  upside: number;
  lookaheadValue: number;
}

/**
 * gap = Score1 - Score2; separation = gap / score_sd.
 * <0.10 CLOSE CALL, 0.10-0.25 LOW, 0.25-0.50 MODERATE, 0.50-0.90 HIGH, >0.90 VERY HIGH
 * (thresholds from config/model.yaml confidence_thresholds)
 */
export function confidenceLabel(scoreGap: number, scoreSd: number): DecisionConfidence {
  throw new Error("not implemented: reasons.confidenceLabel");
}

/**
 * Fill up to 3 reason codes from
 * VALUE_GAP | WONT_SURVIVE | POSITION_CLIFF | LEAGUE_DISCOUNT | SCORING_EDGE |
 * ROSTER_NEED | UPSIDE | TIER_DEPTH | MODEL_DISAGREEMENT
 * using the scored candidate's components — never free-text/LLM-generated.
 */
export function generateReasons(
  top: ScoredCandidate,
  runnerUp: ScoredCandidate | null
): ReasonCode[] {
  throw new Error("not implemented: reasons.generateReasons");
}

/**
 * docs/03 §DO_NOT_REACH: if LeagueMarketRank is ~30+ picks ahead of the
 * current pick (config: do_not_reach.pick_gap_threshold) and none of
 * SCORING_EDGE/POSITION_CLIFF/WONT_SURVIVE clears its threshold, flag
 * MODEL DISAGREEMENT — REVIEW instead of suppressing the pick.
 */
export function checkDoNotReach(
  candidate: ScoredCandidate,
  currentPick: number,
  reasons: ReasonCode[]
): boolean {
  throw new Error("not implemented: reasons.checkDoNotReach");
}
