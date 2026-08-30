/**
 * docs/05 — Family Affair historical priors.
 *
 * Two sources:
 *  - data/family_affair_history.json      Round-1 picks 2019-2025 + 2026 order.
 *    Round-1 shares still drive LeaguePositionBias, which is a Round-1-scaled
 *    comparison against an outside-market Round-1 baseline.
 *  - data/family_affair_history_full.json 839 picks from 5 complete 14-round
 *    drafts (2021-2025). Everything that needs to know what this room does
 *    AFTER round 1 — ManagerAffinity, the RunShock baseline, the K/DST hazard,
 *    autopick behavior — reads this.
 *
 * Never overrides player fundamentals — a weak, recency-weighted prior only.
 */

import fs from "node:fs";
import path from "node:path";
import type { Position } from "@/types";

interface DraftOrderEntry {
  slot: number;
  team: string | null;
  manager: string | null;
  _user?: boolean;
}

interface HistoricalPick {
  pick: number;
  player: string;
  pos: string;
  team: string;
}

interface HistoryFile {
  recency_weights: Record<string, number>;
  position_share_round1: Record<string, Record<string, number>>;
  drafts: Record<string, HistoricalPick[]>;
  draft_order_2026: DraftOrderEntry[];
}

/** One pick from a complete draft (data/family_affair_history_full.json). */
interface FullPick {
  year: number;
  round: number;
  team: string;
  /** CBS autopicked this selection (the `*` in the draft board). */
  auto: boolean;
  player: string;
  pos: string;
  overall: number;
}

interface FullHistoryFile {
  picks: FullPick[];
}

let cached: HistoryFile | null = null;
let cachedFull: FullHistoryFile | null = null;

function loadHistory(): HistoryFile {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "data", "family_affair_history.json");
  const raw = fs.readFileSync(filePath, "utf8");
  cached = JSON.parse(raw) as HistoryFile;
  return cached;
}

function loadFullHistory(): FullHistoryFile {
  if (cachedFull) return cachedFull;
  const filePath = path.join(process.cwd(), "data", "family_affair_history_full.json");
  const raw = fs.readFileSync(filePath, "utf8");
  cachedFull = JSON.parse(raw) as FullHistoryFile;
  return cachedFull;
}

function recencyWeight(year: number): number {
  return loadHistory().recency_weights[String(year)] ?? 0;
}

/** Normalize a team-name variant to a stable comparison key (docs/05 §Identity resolution). */
function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

/**
 * Recency-weighted Round-1 position share for this room, from
 * `position_share_round1` (weights in `recency_weights`). K/DST never
 * appear in Round-1 history so their share is 0.
 */
export function recencyWeightedRoomShare(): Record<Position, number> {
  const history = loadHistory();
  const totals: Record<string, number> = {};
  let weightSum = 0;
  for (const [year, shareByPos] of Object.entries(history.position_share_round1)) {
    const cleanYear = year.replace("_visible", "");
    const weight = history.recency_weights[cleanYear] ?? history.recency_weights[year] ?? 0;
    if (weight <= 0) continue;
    weightSum += weight;
    for (const [pos, share] of Object.entries(shareByPos)) {
      totals[pos] = (totals[pos] ?? 0) + weight * share;
    }
  }
  const result = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    result[pos] = weightSum > 0 ? (totals[pos] ?? 0) / weightSum : 0;
  }
  return result;
}

/**
 * Generic outside-market Round-1 position share baseline (modern 1-QB
 * redraft consensus). Not present anywhere in the repo's data — this is a
 * documented, static assumption (not invented per-player fabrication) used
 * only as the comparison point for LeaguePositionBias. K/DST essentially
 * never go Round 1 anywhere.
 */
const OUTSIDE_MARKET_ROUND1_SHARE: Record<Position, number> = {
  RB: 0.45,
  WR: 0.42,
  QB: 0.08,
  TE: 0.05,
  K: 0,
  DST: 0,
};

export function outsideMarketRoundShare(): Record<Position, number> {
  return OUTSIDE_MARKET_ROUND1_SHARE;
}

/** Resolve a draft slot's manager identity to the set of historical team-name keys it matches. */
function historicalTeamKeysForSlot(managerSlot: number): Set<string> {
  const history = loadHistory();
  const entry = history.draft_order_2026.find((e) => e.slot === managerSlot);
  const keys = new Set<string>();
  if (entry?.team) keys.add(normalizeTeamName(entry.team));
  return keys;
}

/**
 * Recency-weighted count of a manager's position picks across the 5 complete
 * drafts, matched by normalized team-name identity (docs/05 §Identity
 * resolution). Previously this read Round 1 only, which capped a manager at
 * <=7 observations — entirely swamped by the k=8 Beta shrinkage in
 * lib/market.ts, so ManagerAffinity was effectively inert. Full drafts give
 * ~70 picks per manager, enough for the shrinkage to leave real signal.
 * A slot with no resolvable history (2026 slot 12 is not visible) returns
 * total=0 and falls back entirely to the league rate.
 */
export function managerPositionCounts(managerSlot: number): { counts: Record<Position, number>; total: number } {
  const keys = historicalTeamKeysForSlot(managerSlot);
  const counts = {} as Record<Position, number>;
  for (const pos of POSITIONS) counts[pos] = 0;
  let total = 0;
  if (keys.size === 0) return { counts, total };
  for (const pick of loadFullHistory().picks) {
    if (!keys.has(normalizeTeamName(pick.team))) continue;
    const w = recencyWeight(pick.year);
    if (w <= 0) continue;
    const pos = pick.pos as Position;
    if (counts[pos] === undefined) continue;
    counts[pos] += w;
    total += w;
  }
  return { counts, total };
}

/** League-wide (all managers, all rounds) position rate — the shrinkage target for ManagerAffinity. */
export function leagueWideRoundRate(position: Position): number {
  return leagueWidePositionShare()[position] ?? 0;
}

// ---------------------------------------------------------------------------
// Full-draft round structure
// ---------------------------------------------------------------------------

/**
 * Non-overlapping round buckets. Deliberately NOT a smoothed rolling window:
 * this room's round structure has real discontinuities that smoothing destroys
 * — nobody takes a kicker before R7 or a defense before R4 (structural zeros,
 * not sampling noise), and R14 is a 50% kicker spike. Every bucket still has
 * >=59 raw observations.
 */
const ROUND_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [1, 3],
  [4, 6],
  [7, 9],
  [10, 11],
  [12, 13],
  [14, 14],
];

/** Coarser buckets for autopicks only — there are just 91 autopicks in total. */
const AUTOPICK_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [3, 5],
  [6, 9],
  [10, 14],
];

function bucketIndex(buckets: ReadonlyArray<readonly [number, number]>, round: number): number {
  for (let i = 0; i < buckets.length; i++) {
    if (round >= buckets[i][0] && round <= buckets[i][1]) return i;
  }
  return round < buckets[0][0] ? 0 : buckets.length - 1;
}

function emptyShare(): Record<Position, number> {
  const r = {} as Record<Position, number>;
  for (const pos of POSITIONS) r[pos] = 0;
  return r;
}

function normalizeShare(weights: Record<Position, number>): Record<Position, number> {
  const total = POSITIONS.reduce((sum, pos) => sum + weights[pos], 0);
  const out = emptyShare();
  if (total <= 0) return out;
  for (const pos of POSITIONS) out[pos] = weights[pos] / total;
  return out;
}

/**
 * Dirichlet-shrink an observed share toward a prior. `total` is the effective
 * sample size behind `observed`; k is the prior's pseudo-count weight.
 */
function shrinkShare(
  observed: Record<Position, number>,
  total: number,
  prior: Record<Position, number>,
  k: number
): Record<Position, number> {
  const out = emptyShare();
  for (const pos of POSITIONS) out[pos] = (observed[pos] * total + k * prior[pos]) / (total + k);
  return normalizeShare(out);
}

interface FullDerived {
  /** Recency-weighted position share per ROUND_BUCKETS entry. */
  bucketShares: Record<Position, number>[];
  /** Recency-weighted position share per AUTOPICK_BUCKETS entry, autopicks only. */
  autopickShares: Record<Position, number>[];
  /** Effective (recency-weighted) sample size behind each autopick bucket. */
  autopickTotals: number[];
  /** Room-wide position share across all rounds. */
  overallShare: Record<Position, number>;
  /** Recency-weighted autopick rate across the whole room. */
  leagueAutopickRate: number;
  /** Per normalized team key: { auto, total } recency-weighted pick counts. */
  teamAutopick: Map<string, { auto: number; total: number }>;
}

let cachedDerived: FullDerived | null = null;

function derived(): FullDerived {
  if (cachedDerived) return cachedDerived;
  const bucketW = ROUND_BUCKETS.map(() => emptyShare());
  const autoW = AUTOPICK_BUCKETS.map(() => emptyShare());
  const autoTotals = AUTOPICK_BUCKETS.map(() => 0);
  const overallW = emptyShare();
  const teamAutopick = new Map<string, { auto: number; total: number }>();
  let autoWeighted = 0;
  let allWeighted = 0;

  for (const pick of loadFullHistory().picks) {
    const w = recencyWeight(pick.year);
    if (w <= 0) continue;
    const pos = pick.pos as Position;
    if (overallW[pos] === undefined) continue;

    bucketW[bucketIndex(ROUND_BUCKETS, pick.round)][pos] += w;
    overallW[pos] += w;
    allWeighted += w;

    const key = normalizeTeamName(pick.team);
    const entry = teamAutopick.get(key) ?? { auto: 0, total: 0 };
    entry.total += w;
    if (pick.auto) {
      entry.auto += w;
      autoWeighted += w;
      const ai = bucketIndex(AUTOPICK_BUCKETS, pick.round);
      autoW[ai][pos] += w;
      autoTotals[ai] += w;
    }
    teamAutopick.set(key, entry);
  }

  const overallShare = normalizeShare(overallW);
  cachedDerived = {
    bucketShares: bucketW.map(normalizeShare),
    autopickShares: autoW.map(normalizeShare),
    autopickTotals: autoTotals,
    overallShare,
    leagueAutopickRate: allWeighted > 0 ? autoWeighted / allWeighted : 0,
    teamAutopick,
  };
  return cachedDerived;
}

/** Room-wide, recency-weighted position share across all 14 rounds. */
export function leagueWidePositionShare(): Record<Position, number> {
  return derived().overallShare;
}

/**
 * Recency-weighted share of this room's picks spent on each position in the
 * round bucket containing `round`. This is the empirical baseline the RunShock
 * window is compared against, and the source of the opponent-policy K/DST
 * hazard.
 */
export function roundBucketShare(round: number): Record<Position, number> {
  return derived().bucketShares[bucketIndex(ROUND_BUCKETS, round)];
}

/**
 * Position share of CBS AUTOPICKS in the bucket containing `round`, shrunk
 * toward the all-pick share for the same round (only ~91 autopicks exist, so
 * the raw bucket shares are thin). Autopickers draft a different board: R1-2
 * autopicks are 50% QB / 50% RB, R10-14 autopicks are 25% TE and almost no WR.
 */
export function autopickRoundBucketShare(round: number, shrinkageK: number): Record<Position, number> {
  const d = derived();
  const i = bucketIndex(AUTOPICK_BUCKETS, round);
  return shrinkShare(d.autopickShares[i], d.autopickTotals[i], roundBucketShare(round), shrinkageK);
}

/**
 * Beta-shrunk probability that this manager's next pick is a CBS autopick.
 * Slot 3 (Mac Diesel) sits at ~0.40 and picks immediately before the user;
 * an unresolvable slot falls back to the league rate (~0.11).
 */
export function managerAutopickRate(managerSlot: number, shrinkageK: number): number {
  const d = derived();
  const keys = historicalTeamKeysForSlot(managerSlot);
  let auto = 0;
  let total = 0;
  for (const key of keys) {
    const entry = d.teamAutopick.get(key);
    if (entry) {
      auto += entry.auto;
      total += entry.total;
    }
  }
  return (auto + shrinkageK * d.leagueAutopickRate) / (total + shrinkageK);
}
