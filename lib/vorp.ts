/**
 * Alg 3 (docs/03) — dynamic replacement value (VORP).
 *
 * Starter demand (12 teams): QB12, RB24, WR24, TE12, RWT12 (dynamic across
 * RB/WR/TE), K12, DST12 — see config/model.yaml `starter_demand`.
 *
 * IMPLEMENT: algorithm-engineer. Types/signatures only below — do not add
 * logic here without updating docs/03 first.
 */

import type { PlayerRecord, Position, DraftStage } from "@/types";

/**
 * For a position, the value at the expected-remaining-starter-demand index
 * among AVAILABLE (undrafted) players, league-adjusted.
 */
export function computeReplacementValue(
  availablePool: PlayerRecord[],
  position: Position,
  starterDemand: number
): number {
  throw new Error("not implemented: vorp.computeReplacementValue");
}

/** VORP(p) = Value(p) - ReplacementValue(pos). */
export function computeVORP(player: PlayerRecord, replacementValue: number): number {
  throw new Error("not implemented: vorp.computeVORP");
}

/** Replacement value for every position, given the current available pool. */
export function computeAllReplacementValues(
  availablePool: PlayerRecord[]
): Record<Position, number> {
  throw new Error("not implemented: vorp.computeAllReplacementValues");
}

/** RosterGain(p) = w_vorp*VORP(p) + w_fit*CurrentRosterGain(p); weights from config/model.yaml. */
export function computeRosterGain(
  vorp: number,
  currentRosterGain: number,
  stage: DraftStage
): number {
  throw new Error("not implemented: vorp.computeRosterGain");
}
