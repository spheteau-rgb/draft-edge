/**
 * Alg 4 (docs/03) — survival probability. The most important live number:
 * P(player still available at the user's next pick).
 */

import { loadModelConfig } from "@/lib/config";

function normalCdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  const z = (x - mu) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

/** Abramowitz & Stegun 7.1.26 approximation (max error ~1.5e-7) — no external deps. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function logit(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * DraftPick ~ Normal(mu, sigma). Returns P(still available at nextPick |
 * still available at currentPick).
 */
export function survivalProb(
  mu: number,
  sigma: number,
  currentPick: number,
  nextPick: number
): number {
  const fCur = normalCdf(currentPick, mu, sigma);
  const fNext = normalCdf(nextPick, mu, sigma);
  return clamp01((1 - fNext) / Math.max(1e-9, 1 - fCur));
}

/**
 * survival_logit = logit(base) - 0.70*managerPressure - 0.60*runShock - 0.80*tierUrgency
 * (weights from config/model.yaml market.survival_logit_weights)
 * AdjustedSurvival = sigmoid(survival_logit)
 *
 * Each correction is capped before entering the logit so a single extreme
 * signal (e.g. a run_shock at its cap) can't single-handedly swamp the base
 * survival estimate.
 */
export function adjustedSurvival(
  baseSurvival: number,
  managerPressure: number,
  runShock: number,
  tierUrgency: number
): number {
  const config = loadModelConfig();
  const weights = config.market.survival_logit_weights;
  const [runShockLo, runShockHi] = config.market.run_shock_cap;

  const cappedManagerPressure = clamp01(managerPressure);
  const cappedRunShock = Math.max(runShockLo, Math.min(runShockHi, runShock));
  const cappedTierUrgency = clamp01(tierUrgency);

  const base = clamp01(baseSurvival);
  const survivalLogit =
    logit(base) -
    weights.manager_pressure * cappedManagerPressure -
    weights.run_shock * cappedRunShock -
    weights.tier_urgency * cappedTierUrgency;

  return clamp01(sigmoid(survivalLogit));
}

/** Sigma lookup by ADP tier (config/model.yaml market.adp_sigma_by_tier), with
 * upward adjustment for rookies / injured / fast-changing news. */
export function adpSigmaForRank(expectedPick: number, riskAdjustment = 0): number {
  const config = loadModelConfig();
  const tiers = config.market.adp_sigma_by_tier;
  let base: number;
  if (expectedPick <= 24) base = tiers.top_24;
  else if (expectedPick <= 60) base = tiers.picks_25_60;
  else if (expectedPick <= 100) base = tiers.picks_61_100;
  else base = tiers.picks_101_plus;
  return Math.max(1, base + riskAdjustment);
}
