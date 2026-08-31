/**
 * docs/10 §3.1 — start/sit by win probability, not expected points.
 *
 * Fantasy is a series of head-to-head games, not a season-long points race, so
 * the objective is P(my total > this opponent's total). Favourites should take
 * floor and underdogs should take ceiling, and neither rule has to be written
 * down — both fall out of maximising the same probability.
 *
 * The legal-lineup space here is small (14 players, 9 slots, one shared flex),
 * so this enumerates it exactly rather than hill-climbing.
 */

import type { LineupSlotType } from "@/types";
import { STARTER_SLOTS } from "@/lib/lineup";
import { availabilityFactor, type RosterEntry } from "@/lib/season/value";

export interface PlayerWeek {
  entry: RosterEntry;
  mean: number;
  variance: number;
}

/**
 * A designation is a coin flip on top of a distribution, so it moves the mean
 * AND fattens the variance: X = B·Y with B~Bernoulli(p) gives
 * E[X] = p·μ and Var[X] = p·σ² + p(1−p)·μ². Ignoring the second term would
 * understate the risk of starting a Questionable player, which is precisely the
 * decision this function exists to inform.
 */
export function playerWeek(entry: RosterEntry, week: number, currentWeek: number): PlayerWeek {
  const p = availabilityFactor(entry, week, currentWeek);
  const mu = entry.player.projection.weekly_mean;
  const sd = entry.player.projection.weekly_sd;
  return { entry, mean: p * mu, variance: p * sd * sd + p * (1 - p) * mu * mu };
}

export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 on erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function winProbability(
  myMean: number,
  myVar: number,
  oppMean: number,
  oppVar: number
): number {
  const sd = Math.sqrt(myVar + oppVar);
  if (sd === 0) return myMean > oppMean ? 1 : 0;
  return normalCdf((myMean - oppMean) / sd);
}

export type Lineup = Map<LineupSlotType, PlayerWeek[]>;

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/** Every legal QB1/RB2/WR2/TE1/RWT1/K1/DST1 assignment from the available pool. */
export function legalLineups(pool: PlayerWeek[]): Lineup[] {
  const at = (pos: string) => pool.filter((p) => p.entry.player.position === pos);
  const qbs = at("QB");
  const ks = at("K");
  const dsts = at("DST");
  const rbs = at("RB");
  const wrs = at("WR");
  const tes = at("TE");

  const out: Lineup[] = [];
  for (const qb of combinations(qbs, Math.min(STARTER_SLOTS.QB, qbs.length))) {
    for (const k of combinations(ks, Math.min(STARTER_SLOTS.K, ks.length))) {
      for (const dst of combinations(dsts, Math.min(STARTER_SLOTS.DST, dsts.length))) {
        for (const rb of combinations(rbs, Math.min(STARTER_SLOTS.RB, rbs.length))) {
          for (const wr of combinations(wrs, Math.min(STARTER_SLOTS.WR, wrs.length))) {
            for (const te of combinations(tes, Math.min(STARTER_SLOTS.TE, tes.length))) {
              const used = new Set(
                [...rb, ...wr, ...te].map((p) => p.entry.player.player_id)
              );
              const flexPool = [...rbs, ...wrs, ...tes].filter(
                (p) => !used.has(p.entry.player.player_id)
              );
              const flexes = flexPool.length > 0 ? flexPool.map((f) => [f]) : [[]];
              for (const flex of flexes) {
                out.push(
                  new Map<LineupSlotType, PlayerWeek[]>([
                    ["QB", qb], ["RB", rb], ["WR", wr], ["TE", te],
                    ["RWT", flex], ["K", k], ["DST", dst],
                  ])
                );
              }
            }
          }
        }
      }
    }
  }
  return out;
}

export function lineupTotals(lineup: Lineup): { mean: number; variance: number } {
  let mean = 0;
  let variance = 0;
  for (const group of lineup.values()) {
    for (const p of group) {
      mean += p.mean;
      variance += p.variance;
    }
  }
  return { mean, variance };
}

export interface SlotAssignment {
  slot: LineupSlotType;
  player_id: string;
  name: string;
  mean: number;
  sd: number;
  injury?: string;
}

export interface StartSitResult {
  optimal: SlotAssignment[];
  observed: SlotAssignment[];
  changes: { out: SlotAssignment | null; in: SlotAssignment; slot: LineupSlotType }[];
  myMean: number;
  mySd: number;
  opponentMean: number;
  opponentSd: number;
  winProbability: number;
  winProbabilityIfUnchanged: number;
  /** True when we are behind — the reason the optimizer may prefer variance. */
  isUnderdog: boolean;
}

function flatten(lineup: Lineup): SlotAssignment[] {
  const out: SlotAssignment[] = [];
  for (const [slot, group] of lineup) {
    for (const p of group) {
      out.push({
        slot,
        player_id: p.entry.player.player_id,
        name: p.entry.player.name,
        mean: p.mean,
        sd: Math.sqrt(p.variance),
        injury: p.entry.injury,
      });
    }
  }
  return out;
}

/** Rebuild the lineup CBS currently has set, so we can diff against it. */
function observedLineup(roster: PlayerWeek[]): Lineup {
  const lineup: Lineup = new Map();
  for (const p of roster) {
    const slot = p.entry.observedSlot;
    if (!slot || slot === "BENCH") continue;
    lineup.set(slot, [...(lineup.get(slot) ?? []), p]);
  }
  return lineup;
}

export function decideStartSit(
  roster: RosterEntry[],
  opponent: RosterEntry[],
  week: number,
  currentWeek: number
): StartSitResult {
  const all = roster.map((e) => playerWeek(e, week, currentWeek));
  const pool = all.filter((p) => availabilityFactor(p.entry, week, currentWeek) > 0);

  // The opponent will start whatever CBS has set for them; we do not get to
  // assume they misplay, and we do not get to assume they optimize either.
  const oppSet = observedLineup(opponent.map((e) => playerWeek(e, week, currentWeek)));
  const opp = lineupTotals(oppSet);

  let best: Lineup | null = null;
  let bestWp = -1;
  for (const lineup of legalLineups(pool)) {
    const t = lineupTotals(lineup);
    const wp = winProbability(t.mean, t.variance, opp.mean, opp.variance);
    if (wp > bestWp) {
      bestWp = wp;
      best = lineup;
    }
  }
  const bestTotals = best ? lineupTotals(best) : { mean: 0, variance: 0 };

  const observedSet = observedLineup(all);
  const observedTotals = lineupTotals(observedSet);
  const optimal = flatten(best ?? new Map());
  const observed = flatten(observedSet);

  const observedIds = new Set(observed.map((a) => a.player_id));
  const changes = optimal
    .filter((a) => !observedIds.has(a.player_id))
    .map((a) => ({
      slot: a.slot,
      in: a,
      out: observed.find((o) => o.slot === a.slot && !optimal.some((x) => x.player_id === o.player_id)) ?? null,
    }));

  return {
    optimal,
    observed,
    changes,
    myMean: bestTotals.mean,
    mySd: Math.sqrt(bestTotals.variance),
    opponentMean: opp.mean,
    opponentSd: Math.sqrt(opp.variance),
    winProbability: bestWp,
    winProbabilityIfUnchanged: winProbability(
      observedTotals.mean,
      observedTotals.variance,
      opp.mean,
      opp.variance
    ),
    isUnderdog: observedTotals.mean < opp.mean,
  };
}
