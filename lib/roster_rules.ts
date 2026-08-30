/**
 * Hard roster-construction layer (docs/03 §Roster construction; config/model.yaml
 * `roster_construction`).
 *
 * The scoring pipeline (lib/optimizer.ts) ranks players on continuous z-scored
 * value signals. Those signals alone produced structurally-broken rosters in
 * testing (a 2nd DST, four QBs, a round-8 kicker) because a high enough VORP /
 * upside / urgency z can outweigh the soft roster-gain "fit" term. This module
 * encodes the *discrete* rules a human drafter never violates, evaluated against
 * the USER's current roster and the round:
 *
 *   - position caps (no backup QB or TE; one K, one DST) -> hard block
 *   - earliest-round gates for K/DST                     -> hard block
 *   - early-QB/TE reaches                                -> soft z-penalty
 *   - unfilled starter slots                             -> additive z-boost
 *
 * Hard blocks REMOVE a candidate from the pool. The optimizer keeps a safety net:
 * if every candidate is blocked (a degenerate late-draft state) it ignores the
 * blocks so the live path still returns a pick (CLAUDE.md non-negotiable #1).
 *
 * Pure functions, no I/O beyond the cached model config. No LLM.
 */

import type { PlayerRecord, Position } from "@/types";
import { loadModelConfig } from "@/lib/config";
import { STARTER_SLOTS } from "@/lib/lineup";

export interface RosterConstruction {
  /** Remove from the candidate pool entirely (subject to the optimizer safety net). */
  hardBlock: boolean;
  /** Human-readable why, for audit/debug (never shown raw in the UI). */
  hardBlockReason: string | null;
  /** Added to the candidate's roster-penalty z (positive = discouraged). Overridable by exceptional VORP. */
  earlyPenalty: number;
  /** Added to the candidate's roster-gain z (positive = fills an unmet starter need). */
  needBoost: number;
}

/** Count of the user's already-rostered players by position. */
export function rosterCounts(userPlayers: PlayerRecord[]): Record<Position, number> {
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const p of userPlayers) counts[p.position] += 1;
  return counts;
}

/** Mandatory starter minimums (docs/02 roster.starters; RWT flex fills from surplus). */
const MANDATORY_MINIMUMS: Record<Position, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };

/**
 * End-of-draft "must-fill" forcing. When the user has only as many picks left
 * as they have unfilled MANDATORY starter slots, they must spend every one of
 * those picks on a still-needed position or field an illegal lineup (this is
 * why the F-grade mock ended with 0 K / 0 DST — those slots never out-scored a
 * bench RB/WR until it was too late). Returns the set of positions the pool
 * should be restricted to, or null when there's still slack.
 */
export function mustFillPositions(
  counts: Record<Position, number>,
  remainingUserPicks: number
): Set<Position> | null {
  let unfilledSlots = 0;
  const needed = new Set<Position>();
  for (const pos of Object.keys(MANDATORY_MINIMUMS) as Position[]) {
    const deficit = Math.max(0, MANDATORY_MINIMUMS[pos] - counts[pos]);
    if (deficit > 0) {
      unfilledSlots += deficit;
      needed.add(pos);
    }
  }
  if (needed.size === 0) return null;
  return remainingUserPicks <= unfilledSlots ? needed : null;
}

/**
 * Does the user still have an unfilled *starter* slot this position can fill?
 * RB/WR/TE also count toward the shared RWT flex, so their effective starter
 * demand is the dedicated slots plus the flex until it's covered by the group.
 */
function fillsStarterNeed(position: Position, counts: Record<Position, number>): boolean {
  if (position === "QB") return counts.QB < STARTER_SLOTS.QB;
  if (position === "K") return counts.K < STARTER_SLOTS.K;
  if (position === "DST") return counts.DST < STARTER_SLOTS.DST;

  // RB/WR/TE: dedicated minimums first, then the single shared RWT flex.
  const dedicated =
    position === "RB" ? STARTER_SLOTS.RB : position === "WR" ? STARTER_SLOTS.WR : STARTER_SLOTS.TE;
  if (counts[position] < dedicated) return true;

  // Flex still open if the combined RB/WR/TE surplus beyond dedicated minimums
  // hasn't yet claimed the one RWT slot.
  const surplus =
    Math.max(0, counts.RB - STARTER_SLOTS.RB) +
    Math.max(0, counts.WR - STARTER_SLOTS.WR) +
    Math.max(0, counts.TE - STARTER_SLOTS.TE);
  return surplus < STARTER_SLOTS.RWT;
}

/**
 * Evaluate the hard/soft roster-construction rules for one candidate given the
 * user's current position counts and the current round.
 */
export function evaluateConstruction(
  position: Position,
  counts: Record<Position, number>,
  round: number
): RosterConstruction {
  const rc = loadModelConfig().roster_construction;

  let hardBlock = false;
  let hardBlockReason: string | null = null;

  // 1. Position cap (no backup QB/TE; one K, one DST; generous RB/WR).
  const cap = rc.position_caps[position];
  if (cap !== undefined && counts[position] >= cap) {
    hardBlock = true;
    hardBlockReason = `position cap reached (${position} ${counts[position]}/${cap})`;
  }

  // 2. Earliest-round gate for K/DST (don't draft them before the league does).
  const earliest = rc.earliest_round[position];
  if (!hardBlock && earliest !== undefined && round < earliest) {
    hardBlock = true;
    hardBlockReason = `too early for ${position} (round ${round} < ${earliest})`;
  }

  // 3. Soft early-reach penalty (QB/TE before the room usually takes them).
  let earlyPenalty = 0;
  const early = rc.early_position_penalty[position];
  if (early && round < early.before_round) earlyPenalty = early.penalty;

  // 4. Starter-need boost, falling back to a depth-balance boost that is
  //    PROPORTIONAL to the gap from the position's depth target. Symmetric
  //    depth boosts don't rebalance (RB VORP still beats WR at equal depth), so
  //    the thinner position gets the larger boost — an RB:5/WR:2 roster gives
  //    WR a 3x nudge, steering the next picks to WR until the split evens out.
  let needBoost = 0;
  if (fillsStarterNeed(position, counts)) {
    needBoost = rc.starter_need_boost;
  } else {
    const depthTarget = rc.depth_targets[position];
    if (depthTarget !== undefined && counts[position] < depthTarget) {
      needBoost = rc.depth_boost * (depthTarget - counts[position]);
    }
  }

  return { hardBlock, hardBlockReason, earlyPenalty, needBoost };
}
