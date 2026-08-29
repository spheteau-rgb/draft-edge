/**
 * Alg 4 (docs/03) — market model.
 *
 * Base expected pick (weighted ADP) + Family Affair position bias (capped
 * [-5,+5]) + manager affinity (Beta-shrunk) + live run/tier signals.
 * FundamentalRank and LeagueMarketRank are computed independently and never
 * blended before the optimizer runs (docs/03 §Rank separation).
 *
 * IMPLEMENT: algorithm-engineer.
 */

import type { PlayerRecord, DraftState, Position } from "@/types";

/** Weighted ADP blend: CBS 0.50, FantasyPros 0.30, Other 0.20 (renormalized). */
export function baseExpectedPick(player: PlayerRecord): number {
  throw new Error("not implemented: market.baseExpectedPick");
}

/** Family Affair position bias from history (docs/05), capped [-5,+5]. */
export function positionBias(position: Position): number {
  throw new Error("not implemented: market.positionBias");
}

/** Beta-shrunk manager affinity: (mgr_count + k*league_rate) / (mgr_total + k). */
export function managerAffinity(managerSlot: number, position: Position): number {
  throw new Error("not implemented: market.managerAffinity");
}

/** RunShock = observed - expected over the last N picks (config: market.run_shock_window), capped. */
export function runShock(position: Position, recentPicks: DraftState["picks"]): number {
  throw new Error("not implemented: market.runShock");
}

/** TierUrgency = 1 - remaining/initial for the position's current value tier. */
export function tierUrgency(position: Position, availablePool: PlayerRecord[]): number {
  throw new Error("not implemented: market.tierUrgency");
}

/**
 * LeagueMarketRank / expected_pick for every available player, given the
 * live draft state (recomputed each pick — see docs/03 §Alg 4).
 */
export function computeLeagueMarketRanks(
  availablePool: PlayerRecord[],
  state: DraftState
): Map<string, { rank: number; expectedPick: number }> {
  throw new Error("not implemented: market.computeLeagueMarketRanks");
}
