/**
 * Alg 3 (docs/03) — flex-aware roster gain.
 *
 * Solve the best legal starting lineup (assignment over QB/RB x2/WR x2/TE/RWT/K/DST,
 * per docs/02 roster.starters) for a roster, with and without a candidate player,
 * and diff the total value.
 *
 * IMPLEMENT: algorithm-engineer.
 */

import type { PlayerRecord, RosterSlot, LineupSlotType } from "@/types";

/** Legal starter slot counts (docs/02): QB1 RB2 WR2 TE1 RWT1 K1 DST1. */
export const STARTER_SLOTS: Record<LineupSlotType, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  RWT: 1,
  K: 1,
  DST: 1,
  BENCH: 0,
};

/**
 * Solve the value-maximizing legal assignment of roster players to starter
 * slots (RWT flex fillable from RB/WR/TE). Returns total lineup value and the
 * slot assignment.
 */
export function bestLineup(
  roster: PlayerRecord[]
): { totalValue: number; assignment: RosterSlot[] } {
  throw new Error("not implemented: lineup.bestLineup");
}

/** CurrentRosterGain(p) = BestLineup(roster+p) - BestLineup(roster). */
export function currentRosterGain(candidate: PlayerRecord, roster: PlayerRecord[]): number {
  throw new Error("not implemented: lineup.currentRosterGain");
}
