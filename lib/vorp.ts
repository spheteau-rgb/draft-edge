/**
 * Alg 3 (docs/03) — dynamic replacement value (VORP).
 *
 * Starter demand (12 teams): QB12, RB24, WR24, TE12, RWT12 (dynamic across
 * RB/WR/TE), K12, DST12 — see config/model.yaml `starter_demand`.
 *
 * "Dynamic" replacement: we index into the sorted AVAILABLE pool at the
 * starter-demand rank. As the draft removes top players from the available
 * pool, the value at that rank naturally drifts (down for good players'
 * position, since studs are gone) which is exactly the intended dynamic
 * behavior — no separate "remaining demand" bookkeeping is needed since the
 * pool itself already only contains undrafted players.
 */

import type { PlayerRecord, Position, DraftStage } from "@/types";
import { loadModelConfig } from "@/lib/config";

/** Fundamental "value" of a player for ranking/VORP purposes (docs/03 §Season value). */
export function playerValue(player: PlayerRecord): number {
  return player.projection.risk_adjusted_points;
}

/**
 * For a position, the value at the expected-remaining-starter-demand index
 * among AVAILABLE (undrafted) players, league-adjusted.
 */
export function computeReplacementValue(
  availablePool: PlayerRecord[],
  position: Position,
  starterDemand: number
): number {
  const atPos = availablePool
    .filter((p) => p.position === position && !p.is_drafted)
    .sort((a, b) => playerValue(b) - playerValue(a));
  if (atPos.length === 0) return 0;
  const index = Math.min(Math.max(starterDemand, 1), atPos.length) - 1;
  return playerValue(atPos[index]);
}

/** VORP(p) = Value(p) - ReplacementValue(pos). */
export function computeVORP(player: PlayerRecord, replacementValue: number): number {
  return playerValue(player) - replacementValue;
}

/** Replacement value for every position, given the current available pool. */
export function computeAllReplacementValues(
  availablePool: PlayerRecord[]
): Record<Position, number> {
  const config = loadModelConfig();
  const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
  const result = {} as Record<Position, number>;
  for (const pos of positions) {
    const demand = config.starter_demand[pos] ?? 12;
    result[pos] = computeReplacementValue(availablePool, pos, demand);
  }
  return result;
}

/** RosterGain(p) = w_vorp*VORP(p) + w_fit*CurrentRosterGain(p); weights from config/model.yaml. */
export function computeRosterGain(
  vorp: number,
  currentRosterGain: number,
  stage: DraftStage
): number {
  const config = loadModelConfig();
  const weights = config.roster_gain_weights[stage];
  return weights.vorp * vorp + weights.fit * currentRosterGain;
}
