/**
 * docs/10 §3.5 — the one computation every in-season decision reduces to.
 *
 *   ROSValue(roster) = Σ over remaining weeks of bestLineup(available that week)
 *
 * Everything strategic falls out of this rather than being special-cased: bench
 * players only count when they would actually start, byes price themselves
 * (a player on bye is simply absent from that week's lineup), and no two
 * positions are ever compared on raw points — only through their effect on a
 * legal lineup.
 */

import type { PlayerRecord, Position } from "@/types";
import { bestLineup, type SlotFallbackValues } from "@/lib/lineup";
import { loadModelConfig } from "@/lib/config";
import type { ResolvedRow, SnapshotRow, InjuryTag } from "@/lib/season/snapshot";

export interface RosterEntry {
  player: PlayerRecord;
  injury?: InjuryTag;
  /** CBS's current slot, for diffing against what we'd actually start. */
  observedSlot?: ResolvedRow["slot"];
}

/**
 * Availability and this-week discount for a designation. Designations are
 * week-specific, so they expire after `weeks_out` rather than persisting to
 * week 18 — an unknown return date must never manufacture a drop case.
 */
export function availabilityFactor(entry: RosterEntry, week: number, currentWeek: number): number {
  if (entry.player.bye_week === week) return 0;
  if (!entry.injury) return 1;

  const status = loadModelConfig().in_season.injury_status[entry.injury];
  if (!status) return 1;
  if (week < currentWeek + status.weeks_out) return 0;
  return week === currentWeek ? status.play_prob : 1;
}

/** Expected points this week: the Monte Carlo weekly mean, discounted by availability. */
export function weeklyValue(entry: RosterEntry, week: number, currentWeek: number): number {
  return entry.player.projection.weekly_mean * availabilityFactor(entry, week, currentWeek);
}

/**
 * What an empty slot is worth: the best player you could stream for free.
 *
 * This league's Wednesday unrestricted window (docs/10 §1a) means an empty slot
 * is never worth zero, and that single fact does most of the work in keeping the
 * engine honest. Valuing empty slots at zero would make any body at a scarce
 * position look enormously valuable and would have the engine hoarding backups
 * whose true marginal value is nil.
 */
export function streamableReplacement(freeAgents: { player: PlayerRecord }[]): SlotFallbackValues {
  const best: SlotFallbackValues = {};
  for (const { player } of freeAgents) {
    const v = player.projection.weekly_mean;
    if (v > (best[player.position] ?? 0)) best[player.position] = v;
  }
  return best;
}

export interface LineupWeek {
  week: number;
  value: number;
  /** player_id per slot; null where the slot would have to be streamed. */
  assignment: { slot: string; player_id: string | null }[];
}

export function weekLineup(
  roster: RosterEntry[],
  week: number,
  currentWeek: number,
  replacement: SlotFallbackValues
): LineupWeek {
  const byId = new Map(roster.map((e) => [e.player.player_id, e]));
  const available = roster.filter((e) => availabilityFactor(e, week, currentWeek) > 0);
  const { totalValue, assignment } = bestLineup(
    available.map((e) => e.player),
    replacement,
    {
      streamableEmptySlots: true,
      scoreOf: (p) => weeklyValue(byId.get(p.player_id)!, week, currentWeek),
    }
  );
  return { week, value: totalValue, assignment };
}

/** ROSValue — sum of the best legal lineup over every remaining week. */
export function rosValue(
  roster: RosterEntry[],
  currentWeek: number,
  replacement: SlotFallbackValues
): number {
  const finalWeek = loadModelConfig().in_season.final_week;
  let total = 0;
  for (let w = currentWeek; w <= finalWeek; w++) {
    total += weekLineup(roster, w, currentWeek, replacement).value;
  }
  return total;
}

/** Per-week ROS contribution, used to tell a season asset from a one-week streamer. */
export function rosValueByWeek(
  roster: RosterEntry[],
  currentWeek: number,
  replacement: SlotFallbackValues
): Map<number, number> {
  const finalWeek = loadModelConfig().in_season.final_week;
  const out = new Map<number, number>();
  for (let w = currentWeek; w <= finalWeek; w++) {
    out.set(w, weekLineup(roster, w, currentWeek, replacement).value);
  }
  return out;
}

export function toEntries(rows: ResolvedRow[]): RosterEntry[] {
  return rows.map((r) => ({ player: r.player, injury: r.injury, observedSlot: r.slot }));
}

export function positionOf(entry: RosterEntry): Position {
  return entry.player.position;
}

export function displayName(row: SnapshotRow | RosterEntry): string {
  return "player" in row ? row.player.name : row.name;
}
