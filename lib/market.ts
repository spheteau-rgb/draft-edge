/**
 * Alg 4 (docs/03) — market model.
 *
 * Base expected pick (weighted ADP) + Family Affair position bias (capped
 * [-5,+5]) + manager affinity (Beta-shrunk) + live run/tier signals.
 * FundamentalRank and LeagueMarketRank are computed independently and never
 * blended before the optimizer runs (docs/03 §Rank separation).
 */

import type { PlayerRecord, DraftState, Position } from "@/types";
import { loadModelConfig } from "@/lib/config";
import { playerValue } from "@/lib/vorp";
import {
  recencyWeightedRoomShare,
  outsideMarketRoundShare,
  managerPositionCounts,
  leagueWideRoundRate,
} from "@/lib/priors";

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Weighted ADP blend: CBS 0.50, FantasyPros 0.30, Other 0.20 (renormalized). */
export function baseExpectedPick(player: PlayerRecord): number {
  const config = loadModelConfig();
  const w = config.market.adp_weights;
  const entries: Array<[keyof typeof w, number | null]> = [
    ["cbs", player.market.adp_cbs],
    ["fantasypros", player.market.adp_fantasypros],
    ["other", player.market.adp_other],
  ];
  const present = entries.filter(([, v]) => v !== null && v !== undefined) as Array<[keyof typeof w, number]>;
  if (present.length === 0) {
    // No ADP source at all: fall back to whatever expected_pick was precomputed with,
    // or the fundamental rank as a last resort (never fabricate a number from nothing).
    return player.market.expected_pick ?? player.fundamental_rank;
  }
  const totalWeight = present.reduce((sum, [k]) => sum + (w[k] ?? 0), 0) || 1;
  const weightedSum = present.reduce((sum, [k, v]) => sum + (w[k] ?? 0) * v, 0);
  return weightedSum / totalWeight;
}

/**
 * Family Affair position bias from history (docs/05), capped [-5,+5].
 * Positive = this room takes the position EARLIER than the outside market
 * (room share > outside share); negative = later. Scaled by a 12-pick
 * Round-1 window since the underlying shares are Round-1 shares.
 */
export function positionBias(position: Position): number {
  const config = loadModelConfig();
  const [lo, hi] = config.market.position_bias_cap;
  if (position === "K" || position === "DST") return 0; // never Round-1 history to compare
  const room = recencyWeightedRoomShare()[position] ?? 0;
  const outside = outsideMarketRoundShare()[position] ?? 0;
  const delta = room - outside;
  const teamsInRound1 = 12;
  const raw = delta * teamsInRound1;
  return clamp(raw, lo, hi);
}

/** Beta-shrunk manager affinity: (mgr_count + k*league_rate) / (mgr_total + k). */
export function managerAffinity(managerSlot: number, position: Position): number {
  const config = loadModelConfig();
  const k = config.market.manager_affinity_shrinkage_k;
  const { counts, total } = managerPositionCounts(managerSlot);
  const leagueRate = leagueWideRoundRate(position);
  return (counts[position] + k * leagueRate) / (total + k);
}

/** RunShock = observed - expected over the last N picks (config: market.run_shock_window), capped. */
export function runShock(position: Position, recentPicks: DraftState["picks"]): number {
  const config = loadModelConfig();
  const [lo, hi] = config.market.run_shock_cap;
  const window = config.market.run_shock_window;
  const lastN = recentPicks.slice(-window);
  if (lastN.length === 0) return 0;
  const observed = lastN.filter((p) => p.position === position).length;
  // Expected share by starter demand (RWT excluded from the denominator; it draws
  // from RB/WR/TE, not a distinct position, so counting it would double-count).
  const demand = config.starter_demand;
  const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
  const totalDemand = positions.reduce((sum, pos) => sum + (demand[pos] ?? 0), 0) || 1;
  const expectedShare = (demand[position] ?? 0) / totalDemand;
  const expected = expectedShare * lastN.length;
  return clamp(observed - expected, lo, hi);
}

/**
 * TierUrgency = 1 - remaining/initial for the position's current value tier.
 * "Tier" is approximated as the top starter_demand[pos] players at that
 * position (by fundamental value) across the whole player pool; "remaining"
 * is how many of those specific players are still available.
 */
export function tierUrgency(position: Position, availablePool: PlayerRecord[], allPlayers?: PlayerRecord[]): number {
  const config = loadModelConfig();
  const demand = config.starter_demand[position] ?? 12;
  const universe = allPlayers ?? availablePool;
  const tierPlayers = universe
    .filter((p) => p.position === position)
    .sort((a, b) => playerValue(b) - playerValue(a))
    .slice(0, demand);
  if (tierPlayers.length === 0) return 0;
  const availableIds = new Set(availablePool.filter((p) => !p.is_drafted).map((p) => p.player_id));
  const remaining = tierPlayers.filter((p) => availableIds.has(p.player_id)).length;
  return clamp(1 - remaining / tierPlayers.length, 0, 1);
}

/**
 * LeagueMarketRank / expected_pick for every available player, given the
 * live draft state (recomputed each pick — see docs/03 §Alg 4). Expected
 * pick = baseExpectedPick + positionBias, live run/tier corrections are
 * applied downstream in survival (docs/03), not baked into the rank itself.
 */
export function computeLeagueMarketRanks(
  availablePool: PlayerRecord[],
  state: DraftState
): Map<string, { rank: number; expectedPick: number }> {
  const withExpected = availablePool.map((p) => ({
    player: p,
    expectedPick: baseExpectedPick(p) + positionBias(p.position),
  }));
  withExpected.sort((a, b) => a.expectedPick - b.expectedPick);
  const result = new Map<string, { rank: number; expectedPick: number }>();
  withExpected.forEach((entry, idx) => {
    result.set(entry.player.player_id, { rank: idx + 1, expectedPick: entry.expectedPick });
  });
  return result;
}
