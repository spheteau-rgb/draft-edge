/**
 * Alg 4 (docs/03) — survival probability. The most important live number:
 * P(player still available at the user's next pick).
 *
 * IMPLEMENT: algorithm-engineer.
 */

/**
 * DraftPick ~ Normal(mu, sigma). Returns P(still available at nextPick |
 * still available at currentPick).
 *   F_cur = normalCdf(currentPick, mu, sigma)
 *   F_next = normalCdf(nextPick, mu, sigma)
 *   return clamp((1 - F_next) / max(1e-9, 1 - F_cur), 0, 1)
 */
export function survivalProb(
  mu: number,
  sigma: number,
  currentPick: number,
  nextPick: number
): number {
  throw new Error("not implemented: survival.survivalProb");
}

/**
 * survival_logit = logit(base) - 0.70*managerPressure - 0.60*runShock - 0.80*tierUrgency
 * (weights from config/model.yaml market.survival_logit_weights)
 * AdjustedSurvival = sigmoid(survival_logit)
 */
export function adjustedSurvival(
  baseSurvival: number,
  managerPressure: number,
  runShock: number,
  tierUrgency: number
): number {
  throw new Error("not implemented: survival.adjustedSurvival");
}

/** Sigma lookup by ADP tier (config/model.yaml market.adp_sigma_by_tier), with
 * upward adjustment for rookies / injured / fast-changing news. */
export function adpSigmaForRank(expectedPick: number, riskAdjustment?: number): number {
  throw new Error("not implemented: survival.adpSigmaForRank");
}
