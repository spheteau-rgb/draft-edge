/**
 * Robust, frozen standardization (docs/03 §Candidate generation).
 *
 * Median/MAD standardization so one outlier candidate can't distort the
 * scale. The 1.4826 constant makes MAD a consistent estimator of the
 * standard deviation for normally distributed data (standard robust-stats
 * convention) so z-scores stay on a familiar scale.
 */

export interface CenterScale {
  center: number;
  scale: number;
  /** Spread is not meaningful at this population's own magnitude — applyZ returns 0. */
  degenerate: boolean;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median Absolute Deviation, scaled by 1.4826 to approximate SD under normality. */
export function medianAbsoluteDeviation(values: number[], med?: number): number {
  const m = med ?? median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations) * 1.4826;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// A MAD-z beyond 3 is already an extreme outlier; anything past it carries no
// extra ranking information, only the power to swamp every other term in the
// weighted sum.
const Z_SCORE_CLAMP = 3;

// Spread below this fraction of the population's own magnitude is numerical
// noise, not signal. Lookahead values sit around 435 season points and differ
// between candidates by ~0.005 — a real, nonzero MAD that nonetheless means
// nothing, and which naive z-scoring turns into a full-scale term.
const RELATIVE_SPREAD_FLOOR = 1e-3;

/** Compute the frozen center/scale for a population of values. */
export function computeCenterScale(values: number[]): CenterScale {
  const center = median(values);
  let scale = medianAbsoluteDeviation(values, center);

  // MAD collapses to 0 whenever more than half the population shares one value
  // — common here, since urgency is a per-position scalar and a candidate pool
  // is mostly one or two positions. That is not an absence of spread, it just
  // means the minority carries all of it, so fall back to SD rather than
  // discarding a real signal.
  if (!Number.isFinite(scale) || scale <= 0) {
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    scale = standardDeviation(values, mean);
  }

  const magnitude = Math.max(Math.abs(center), ...values.map(Math.abs), 1e-12);
  const degenerate = !Number.isFinite(scale) || scale < RELATIVE_SPREAD_FLOOR * magnitude;

  return { center, scale: degenerate ? 1 : scale, degenerate };
}

/** Apply a frozen center/scale to a single value, clamped to +/-Z_SCORE_CLAMP. */
export function applyZ(value: number, cs: CenterScale): number {
  if (cs.degenerate) return 0;
  const z = (value - cs.center) / cs.scale;
  return Math.max(-Z_SCORE_CLAMP, Math.min(Z_SCORE_CLAMP, z));
}

/** Convenience: compute center/scale from `values` and return the z-scores for `values`. */
export function robustZScores(values: number[]): { z: number[]; cs: CenterScale } {
  const cs = computeCenterScale(values);
  return { z: values.map((v) => applyZ(v, cs)), cs };
}
