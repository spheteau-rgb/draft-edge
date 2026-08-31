/**
 * docs/10 §3.5–3.6 — add/drop by ΔROS, with the guards that cover what a
 * mean-based Δ structurally cannot see.
 *
 * Most of the strategy lives in ROSValue, not here: because empty slots are
 * valued at the free-agent streamer (docs/10 §1a), a pickup only scores if it
 * beats what you could have grabbed for nothing anyway. That alone rejects the
 * large majority of plausible-looking waiver adds, which is the correct answer
 * in a 12-team league with a deep pool.
 *
 * The guards below exist for the three things means cannot express: tails
 * (`UPSIDE_STASH`), value that is not lineup value (`TRADE_CURRENCY`), and
 * value concentrated in too few weeks to be worth a roster spot
 * (`STREAMER_NOT_ASSET`).
 */

import type { Position } from "@/types";
import { loadModelConfig } from "@/lib/config";
import { STARTER_SLOTS, type SlotFallbackValues } from "@/lib/lineup";
import {
  availabilityFactor,
  rosValue,
  weekLineup,
  type RosterEntry,
} from "@/lib/season/value";

export type DropGuard =
  | "IN_OPTIMAL_LINEUP"
  | "INJURED_STUD"
  | "BYE_CRITICAL"
  | "LAST_AT_POSITION"
  | "UPSIDE_STASH"
  | "TRADE_CURRENCY";

export type AddGuard = "NO_LINEUP_PATH" | "BYE_COLLISION" | "MARGINAL_CHURN" | "STREAMER_NOT_ASSET";

export type Window = "free" | "faab";

export interface MoveCandidate {
  addId: string;
  addName: string;
  addPosition: Position;
  addBye: number | null;
  dropId: string;
  dropName: string;
  dropPosition: Position;
  deltaRos: number;
  /** Weeks in which the added player actually occupies a starting slot. */
  weeksStarted: number[];
  addGuards: AddGuard[];
  dropGuards: DropGuard[];
  blocked: boolean;
}

export interface MovesResult {
  window: Window;
  threshold: number;
  recommended: MoveCandidate[];
  /** Best-scoring moves that a guard rejected — shown so inaction is auditable. */
  rejected: MoveCandidate[];
  /** Marginal value of each rostered player, for the holds list. */
  playerValueRanking: {
    player_id: string;
    name: string;
    position: Position;
    marginalRos: number;
    guards: DropGuard[];
  }[];
}

const HARD_DROP_GUARDS: DropGuard[] = ["INJURED_STUD", "UPSIDE_STASH"];
const HARD_ADD_GUARDS: AddGuard[] = ["NO_LINEUP_PATH", "MARGINAL_CHURN", "STREAMER_NOT_ASSET"];

/** Starter demand at a position, counting the shared flex as fractional RB/WR/TE need. */
function starterDemand(position: Position): number {
  const base = STARTER_SLOTS[position] ?? 0;
  return position === "RB" || position === "WR" || position === "TE" ? base + 1 : base;
}

function withoutPlayer(roster: RosterEntry[], playerId: string): RosterEntry[] {
  return roster.filter((e) => e.player.player_id !== playerId);
}

/**
 * Marginal ROS value = what the roster loses by not having this player at all.
 * This is the honest measure of "how droppable is he" — a bench player who never
 * cracks the lineup scores ~0 no matter how good his raw projection looks.
 */
export function marginalRosValues(
  roster: RosterEntry[],
  currentWeek: number,
  replacement: SlotFallbackValues
): Map<string, number> {
  const full = rosValue(roster, currentWeek, replacement);
  const out = new Map<string, number>();
  for (const e of roster) {
    out.set(
      e.player.player_id,
      full - rosValue(withoutPlayer(roster, e.player.player_id), currentWeek, replacement)
    );
  }
  return out;
}

/** Weeks in which a player occupies a starting slot, given the roster he's on. */
function weeksStarted(
  roster: RosterEntry[],
  playerId: string,
  currentWeek: number,
  replacement: SlotFallbackValues
): number[] {
  const finalWeek = loadModelConfig().in_season.final_week;
  const weeks: number[] = [];
  for (let w = currentWeek; w <= finalWeek; w++) {
    const { assignment } = weekLineup(roster, w, currentWeek, replacement);
    if (assignment.some((a) => a.player_id === playerId)) weeks.push(w);
  }
  return weeks;
}

function dropGuardsFor(
  entry: RosterEntry,
  roster: RosterEntry[],
  currentWeek: number,
  replacement: SlotFallbackValues,
  marginal: Map<string, number>
): DropGuard[] {
  const cfg = loadModelConfig().in_season;
  const guards: DropGuard[] = [];
  const proj = entry.player.projection;
  const position = entry.player.position;

  const ranked = [...marginal.entries()].sort((a, b) => b[1] - a[1]);
  const rank = ranked.findIndex(([id]) => id === entry.player.player_id) + 1;

  const status = entry.injury ? cfg.injury_status[entry.injury] : undefined;
  if (status && status.weeks_out > 0 && rank > 0 && rank <= cfg.guards.injured_stud_rank) {
    guards.push("INJURED_STUD");
  }

  if (proj.weekly_mean > 0 && proj.weekly_p90 / proj.weekly_mean >= cfg.guards.upside_p90_ratio) {
    guards.push("UPSIDE_STASH");
  }

  const started = weeksStarted(roster, entry.player.player_id, currentWeek, replacement);
  const remaining = cfg.final_week - currentWeek + 1;
  if (started.length * 2 >= remaining) guards.push("IN_OPTIMAL_LINEUP");

  const samePos = roster.filter((e) => e.player.position === position);
  if (samePos.length - 1 < starterDemand(position)) guards.push("LAST_AT_POSITION");

  // Would removing him leave a week with nobody available at his position?
  const after = withoutPlayer(roster, entry.player.player_id);
  for (let w = currentWeek; w <= cfg.final_week; w++) {
    const anyAvailable = after.some(
      (e) => e.player.position === position && availabilityFactor(e, w, currentWeek) > 0
    );
    if (!anyAvailable) {
      guards.push("BYE_CRITICAL");
      break;
    }
  }

  const startable = samePos.filter((e) => (marginal.get(e.player.player_id) ?? 0) > 0).length;
  if (startable > starterDemand(position) + cfg.guards.surplus_over_demand) {
    guards.push("TRADE_CURRENCY");
  }

  return guards;
}

export function evaluateMoves(
  roster: RosterEntry[],
  freeAgents: RosterEntry[],
  currentWeek: number,
  replacement: SlotFallbackValues,
  window: Window
): MovesResult {
  const cfg = loadModelConfig().in_season;
  const threshold = window === "free" ? cfg.min_ros_gain.free_window : cfg.min_ros_gain.faab_window;

  const baseline = rosValue(roster, currentWeek, replacement);
  const marginal = marginalRosValues(roster, currentWeek, replacement);
  const dropGuardCache = new Map<string, DropGuard[]>();
  for (const e of roster) {
    dropGuardCache.set(
      e.player.player_id,
      dropGuardsFor(e, roster, currentWeek, replacement, marginal)
    );
  }

  const candidates: MoveCandidate[] = [];
  for (const add of freeAgents) {
    for (const drop of roster) {
      const next = [...withoutPlayer(roster, drop.player.player_id), add];
      const deltaRos = rosValue(next, currentWeek, replacement) - baseline;
      const started = weeksStarted(next, add.player.player_id, currentWeek, replacement);

      const addGuards: AddGuard[] = [];
      if (started.length === 0) addGuards.push("NO_LINEUP_PATH");
      else if (
        started.length <= cfg.guards.streamer_max_weeks &&
        deltaRos < cfg.guards.streamer_override_ros
      ) {
        addGuards.push("STREAMER_NOT_ASSET");
      }
      if (deltaRos < threshold) addGuards.push("MARGINAL_CHURN");

      // Named explicitly even though ROSValue already prices it: a QB2 whose bye
      // matches your QB1's is the single most common "obvious" add that is worth
      // nothing, and the reason has to be legible on the brief.
      const incumbentBye = roster
        .filter((e) => e.player.position === add.player.position)
        .sort((a, b) => (marginal.get(b.player.player_id) ?? 0) - (marginal.get(a.player.player_id) ?? 0))[0]
        ?.player.bye_week;
      if (
        add.player.bye_week !== null &&
        incumbentBye !== undefined &&
        add.player.bye_week === incumbentBye
      ) {
        addGuards.push("BYE_COLLISION");
      }

      const dropGuards = dropGuardCache.get(drop.player.player_id) ?? [];
      const blocked =
        addGuards.some((g) => HARD_ADD_GUARDS.includes(g)) ||
        dropGuards.some((g) => HARD_DROP_GUARDS.includes(g));

      candidates.push({
        addId: add.player.player_id,
        addName: add.player.name,
        addPosition: add.player.position,
        addBye: add.player.bye_week,
        dropId: drop.player.player_id,
        dropName: drop.player.name,
        dropPosition: drop.player.position,
        deltaRos,
        weeksStarted: started,
        addGuards,
        dropGuards,
        blocked,
      });
    }
  }

  candidates.sort((a, b) => b.deltaRos - a.deltaRos);

  // One recommendation per added player — the same pickup paired with fourteen
  // different drops is one decision, not fourteen.
  const seenAdd = new Set<string>();
  const recommended: MoveCandidate[] = [];
  for (const c of candidates) {
    if (c.blocked || seenAdd.has(c.addId)) continue;
    seenAdd.add(c.addId);
    recommended.push(c);
  }

  return {
    window,
    threshold,
    recommended,
    rejected: candidates.filter((c) => c.blocked).slice(0, 8),
    playerValueRanking: [...marginal.entries()]
      .map(([player_id, marginalRos]) => {
        const e = roster.find((r) => r.player.player_id === player_id)!;
        return {
          player_id,
          name: e.player.name,
          position: e.player.position,
          marginalRos,
          guards: dropGuardCache.get(player_id) ?? [],
        };
      })
      .sort((a, b) => b.marginalRos - a.marginalRos),
  };
}
