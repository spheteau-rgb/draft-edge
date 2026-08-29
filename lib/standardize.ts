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

/** Apply a frozen center/scale to a single value. */
export function applyZ(value: number, cs: CenterScale): number {
  return (value - cs.center) / cs.scale;
}

/** Convenience: compute center/scale from `values` and return the z-scores for `values`. */
export function robustZScores(values: number[]): { z: number[]; cs: CenterScale } {
  const cs = computeCenterScale(values);
  return { z: values.map((v) => applyZ(v, cs)), cs };
}
