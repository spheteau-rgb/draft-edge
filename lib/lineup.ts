/**
 * Alg 3 (docs/03) — flex-aware roster gain.
 *
 * Solve the best legal starting lineup (assignment over QB/RB x2/WR x2/TE/RWT/K/DST,
 * per docs/02 roster.starters) for a roster, with and without a candidate player,
 * and diff the total value.
 *
 * Assignment strategy: QB/K/DST slots are position-exclusive (1 eligible
 * group each) so the best available player at that position is optimal.
 * RB/WR/TE/RWT share a pool where RB/WR/TE each have dedicated minimums (2/2/1)
 * and RWT is a single shared flex slot. Filling the dedicated slots with each
 * group's top players, then giving the flex slot to the best remaining player
 * across RB/WR/TE, is the exact optimum for this "dedicated + single shared
 * flex" structure (a standard result for fantasy flex-lineup assignment).
 */

import type { PlayerRecord, RosterSlot, LineupSlotType } from "@/types";
import { playerValue } from "@/lib/vorp";

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

function byPositionDesc(roster: PlayerRecord[], position: PlayerRecord["position"]): PlayerRecord[] {
  return roster
    .filter((p) => p.position === position)
    .sort((a, b) => playerValue(b) - playerValue(a));
}

/**
 * Solve the value-maximizing legal assignment of roster players to starter
 * slots (RWT flex fillable from RB/WR/TE). Returns total lineup value and the
 * slot assignment.
 */
export function bestLineup(
  roster: PlayerRecord[]
): { totalValue: number; assignment: RosterSlot[] } {
  const assignment: RosterSlot[] = [];
  let totalValue = 0;
  const used = new Set<string>();

  const takeBest = (slot: LineupSlotType, candidates: PlayerRecord[]) => {
    const pick = candidates.find((p) => !used.has(p.player_id));
    if (pick) {
      used.add(pick.player_id);
      totalValue += playerValue(pick);
      assignment.push({ slot, player_id: pick.player_id });
    } else {
      assignment.push({ slot, player_id: null });
    }
  };

  // Position-exclusive slots.
  takeBest("QB", byPositionDesc(roster, "QB"));
  takeBest("K", byPositionDesc(roster, "K"));
  takeBest("DST", byPositionDesc(roster, "DST"));

  // Dedicated RB/WR/TE minimums first (best-of-group is optimal for dedicated slots).
  const rbs = byPositionDesc(roster, "RB");
  const wrs = byPositionDesc(roster, "WR");
  const tes = byPositionDesc(roster, "TE");

  for (let i = 0; i < STARTER_SLOTS.RB; i++) takeBest("RB", rbs);
  for (let i = 0; i < STARTER_SLOTS.WR; i++) takeBest("WR", wrs);
  for (let i = 0; i < STARTER_SLOTS.TE; i++) takeBest("TE", tes);

  // Shared flex: best remaining player across RB/WR/TE not already used.
  const flexPool = [...rbs, ...wrs, ...tes]
    .filter((p) => !used.has(p.player_id))
    .sort((a, b) => playerValue(b) - playerValue(a));
  takeBest("RWT", flexPool);

  return { totalValue, assignment };
}

/** CurrentRosterGain(p) = BestLineup(roster+p) - BestLineup(roster). */
export function currentRosterGain(candidate: PlayerRecord, roster: PlayerRecord[]): number {
  const withCandidate = bestLineup([...roster, candidate]).totalValue;
  const without = bestLineup(roster).totalValue;
  return withCandidate - without;
}
