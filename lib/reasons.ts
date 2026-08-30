/**
 * Alg 3/5 (docs/03) — reason codes (max 3, template-filled, no LLM) and
 * confidence label from score separation.
 *
 * Reason-code thresholds below are local, documented constants (not in
 * config/model.yaml, which has no entries for them) — kept simple and
 * literal per CLAUDE.md ("don't turn this into a research project").
 */

import type { PlayerRecord, DecisionConfidence, ReasonCode } from "@/types";
import { loadModelConfig } from "@/lib/config";

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
  const config = loadModelConfig();
  const t = config.confidence_thresholds;
  const sd = scoreSd <= 1e-9 ? 1e-9 : scoreSd;
  const separation = scoreGap / sd;
  if (separation < t.close_call_max) return "CLOSE CALL";
  if (separation < t.low_max) return "LOW";
  if (separation < t.moderate_max) return "MODERATE";
  if (separation < t.high_max) return "HIGH";
  return "VERY HIGH";
}

const SURVIVAL_LOW_THRESHOLD = 0.35;
const MARKET_GAP_RANK_THRESHOLD = 8; // rank spots between fundamental & market rank
const CLIFF_ROSTER_GAIN_DELTA = 0.75; // raw points delta vs next-best at same position
const VALUE_GAP_SCORE_DELTA = 0.3; // final-score (z-scaled) edge over runner-up
const TIER_URGENCY_THRESHOLD = 0.5;

/**
 * Fill up to 3 reason codes from
 * VALUE_GAP | WONT_SURVIVE | POSITION_CLIFF | LEAGUE_DISCOUNT | SCORING_EDGE |
 * ROSTER_NEED | UPSIDE | TIER_DEPTH | MODEL_DISAGREEMENT
 * using the scored candidate's components — never free-text/LLM-generated.
 * MODEL_DISAGREEMENT is added by the caller via checkDoNotReach, not here.
 */
export function generateReasons(
  top: ScoredCandidate,
  runnerUp: ScoredCandidate | null,
  currentPick: number
): ReasonCode[] {
  const reasons: ReasonCode[] = [];
  const config = loadModelConfig();
  const gapThreshold = config.do_not_reach.pick_gap_threshold;

  if (top.survivalToNextPick < SURVIVAL_LOW_THRESHOLD) {
    reasons.push("WONT_SURVIVE");
  }

  // POSITION_CLIFF must reflect a genuine drop-off against the TRUE field, not
  // just the next-ranked same-position candidate. `runnerUp` here is already
  // the actual overall #2 by FinalScore (lib/optimizer.ts finalScored[1]), so
  // requiring same-position is fine as far as it goes -- but if BOTH the
  // candidate and that same-position runner-up are themselves reaching well
  // past their own market ADP (e.g. two veteran QBs the room wouldn't touch
  // for another 80+ picks, both inflated by the same starter_need_boost),
  // the "cliff" is trivially real within that mispriced cluster and proves
  // nothing about the real field. Require the comparator itself to NOT be a
  // big reach past its own expected_pick before it counts as clearing the
  // do-not-reach bar.
  const runnerUpPickGap = runnerUp ? runnerUp.player.market.expected_pick - currentPick : 0;
  if (
    runnerUp &&
    runnerUp.player.position === top.player.position &&
    top.rosterGain - runnerUp.rosterGain > CLIFF_ROSTER_GAIN_DELTA &&
    runnerUpPickGap < gapThreshold
  ) {
    reasons.push("POSITION_CLIFF");
  }

  // `top.market` is the LIVE mispricing the optimizer actually scored on (both
  // ranks taken over the currently-available pool). The static player.* rank
  // fields are preseason snapshots and drift apart from it as the draft runs.
  const marketGap = top.market;
  if (marketGap >= MARKET_GAP_RANK_THRESHOLD) {
    // The room lets him fall further than his fundamental value would suggest.
    reasons.push("LEAGUE_DISCOUNT");
  } else if (reasons.length < 3 && top.player.fundamental_rank <= 5 && Math.abs(marketGap) < MARKET_GAP_RANK_THRESHOLD) {
    // Market roughly agrees he's elite — the edge is our exact scoring math, not a market gap.
    reasons.push("SCORING_EDGE");
  }

  if (reasons.length < 3 && runnerUp && top.finalScore - runnerUp.finalScore >= VALUE_GAP_SCORE_DELTA) {
    reasons.push("VALUE_GAP");
  }

  if (reasons.length < 3 && runnerUp && top.upside - runnerUp.upside > 0 && top.upside > 0) {
    reasons.push("UPSIDE");
  }

  if (reasons.length < 3 && top.urgency >= TIER_URGENCY_THRESHOLD) {
    reasons.push("TIER_DEPTH");
  }

  if (reasons.length < 3 && top.rosterGain > 0) {
    reasons.push("ROSTER_NEED");
  }

  return Array.from(new Set(reasons)).slice(0, 3);
}

/**
 * docs/03 §DO_NOT_REACH: if LeagueMarketRank/ExpectedPick is ~30+ picks ahead
 * of the current pick (config: do_not_reach.pick_gap_threshold) and none of
 * SCORING_EDGE/POSITION_CLIFF/WONT_SURVIVE cleared the bar (i.e. is present
 * in `reasons`), flag MODEL DISAGREEMENT — REVIEW instead of suppressing
 * the pick.
 */
export function checkDoNotReach(candidate: ScoredCandidate, currentPick: number, reasons: ReasonCode[]): boolean {
  const config = loadModelConfig();
  const gapThreshold = config.do_not_reach.pick_gap_threshold;
  const requiredCodes = config.do_not_reach.required_reason_codes as ReasonCode[];

  const pickGap = candidate.player.market.expected_pick - currentPick;
  if (pickGap < gapThreshold) return false;

  const hasQualifyingReason = reasons.some((r) => requiredCodes.includes(r));
  return !hasQualifyingReason;
}
