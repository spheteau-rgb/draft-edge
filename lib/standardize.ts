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

/** Compute the frozen center/scale for a population of values. */
export function computeCenterScale(values: number[]): CenterScale {
  const center = median(values);
  let scale = medianAbsoluteDeviation(values, center);
  // Fallback when MAD collapses to 0 (e.g. all values identical, or n=1):
  // use a tiny epsilon so division doesn't blow up, rather than inventing spread.
  if (!Number.isFinite(scale) || scale < 1e-9) scale = 1e-9;
  return { center, scale };
}

// When a population is degenerate (near-identical values, MAD -> the 1e-9
// epsilon floor above), dividing by that epsilon turns ordinary
// floating-point rounding noise into a z-score in the hundreds of millions,
// which then dominates every downstream weighted sum it feeds into. Clamping
// to a generous but bounded range preserves ranking among genuinely spread
// populations while making degenerate ones inert instead of catastrophic.
const Z_SCORE_CLAMP = 8;

/** Apply a frozen center/scale to a single value, clamped to +/-Z_SCORE_CLAMP. */
export function applyZ(value: number, cs: CenterScale): number {
  const z = (value - cs.center) / cs.scale;
  return Math.max(-Z_SCORE_CLAMP, Math.min(Z_SCORE_CLAMP, z));
}

/** Convenience: compute center/scale from `values` and return the z-scores for `values`. */
export function robustZScores(values: number[]): { z: number[]; cs: CenterScale } {
  const cs = computeCenterScale(values);
  return { z: values.map((v) => applyZ(v, cs)), cs };
}
