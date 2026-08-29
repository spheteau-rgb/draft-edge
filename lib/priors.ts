/**
 * docs/05 — Family Affair historical priors, loaded from
 * data/family_affair_history.json (Round-1 picks 2019-2025 + 2026 order).
 * Used by lib/market.ts for LeaguePositionBias and ManagerAffinity. Never
 * overrides player fundamentals — a weak, recency-weighted prior only.
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

let cached: HistoryFile | null = null;

function loadHistory(): HistoryFile {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "data", "family_affair_history.json");
  const raw = fs.readFileSync(filePath, "utf8");
  cached = JSON.parse(raw) as HistoryFile;
  return cached;
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
 * Raw (unshrunk) count of a manager's Round-1 position picks across history,
 * matched by normalized team-name identity (docs/05 §Identity resolution).
 * Sample is tiny by design (<=7 Round-1 picks/manager) — shrinkage happens
 * in lib/market.ts (Beta-shrink, k=8).
 */
export function managerPositionCounts(managerSlot: number): { counts: Record<Position, number>; total: number } {
  const history = loadHistory();
  const keys = historicalTeamKeysForSlot(managerSlot);
  const counts = {} as Record<Position, number>;
  for (const pos of POSITIONS) counts[pos] = 0;
  let total = 0;
  if (keys.size === 0) return { counts, total };
  for (const picks of Object.values(history.drafts)) {
    for (const pick of picks) {
      if (!pick.team || !keys.has(normalizeTeamName(pick.team))) continue;
      const pos = pick.pos as Position;
      if (counts[pos] !== undefined) {
        counts[pos] += 1;
        total += 1;
      }
    }
  }
  return { counts, total };
}

/** League-wide (all managers) Round-1 position rate — the shrinkage target for ManagerAffinity. */
export function leagueWideRoundRate(position: Position): number {
  const shares = recencyWeightedRoomShare();
  return shares[position] ?? 0;
}
