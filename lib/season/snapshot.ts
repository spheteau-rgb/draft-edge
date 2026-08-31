/**
 * In-season league state (docs/10 §2).
 *
 * A snapshot is a declarative record of what a CBS screen showed at one moment.
 * Writing a snapshot REPLACES that week's state rather than appending to it —
 * this is the fix for the append-only pick-ledger drift the draft store hit
 * (docs/10 §12.2). Re-transcribing the same screen is a no-op.
 *
 * Snapshots are produced by transcribing screenshots offline and are read
 * read-only at request time, so no model call ever sits on the recommendation
 * path (CLAUDE.md non-negotiable #1).
 */

import fs from "node:fs";
import path from "node:path";
import type { PlayerRecord, Position, LineupSlotType } from "@/types";
import { normalizeName } from "@/lib/store";
import { indexPlayers, type IndexedPlayer } from "@/lib/bulkParse";

export type RosterSection = "ACTIVE" | "RESERVE" | "IR" | "PRACTICE_SQUAD";

/** CBS's single-letter designation next to the team abbreviation. */
export type InjuryTag = "Q" | "D" | "O" | "IR" | "PUP" | "SUSP";

export interface SnapshotRow {
  /** Exactly as CBS printed it, usually abbreviated ("M. Stafford"). */
  name: string;
  position: Position;
  nfl_team: string;
  /** The slot CBS currently has them in. Diffing this against the optimizer's answer IS the start/sit brief. */
  slot?: LineupSlotType;
  section?: RosterSection;
  injury?: InjuryTag;
  /** "@LAC" / "vs BAL", verbatim. */
  opponent?: string;
  kickoff?: string;
  /**
   * CBS's own projections. Advisory only — never enters the math. Kept so the
   * brief can show where our model disagrees with the room's default view.
   */
  cbs_proj_week?: number;
  cbs_proj_season?: number;
}

export interface TeamSnapshot {
  team_name: string;
  owner?: string;
  record?: string;
  faab_remaining?: number | null;
  cbs_proj_week_total?: number;
  players: SnapshotRow[];
}

export interface TransactionRow {
  team: string;
  action: "ADD" | "DROP" | "TRADE";
  player: string;
  /** Winning FAAB bid. The only clearing-price training data that exists (docs/10 §3.2). */
  bid?: number | null;
  result?: "WON" | "LOST";
}

export interface WeekSnapshot {
  season: number;
  week: number;
  captured_at: string;
  source: string;
  my_team: TeamSnapshot;
  opponent?: TeamSnapshot;
  free_agents: SnapshotRow[];
  transactions: TransactionRow[];
}

export interface ResolvedRow extends SnapshotRow {
  player_id: string;
  player: PlayerRecord;
}

export interface UnresolvedRow {
  row: SnapshotRow;
  candidates: { player_id: string; name: string; position: Position; nfl_team: string }[];
}

export interface ResolveReport {
  resolved: ResolvedRow[];
  unresolved: UnresolvedRow[];
}

const ABBREV_RE = /^([A-Za-z])\.?\s+(.+)$/;
const SUFFIX_RE = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i;

function stripSuffix(name: string): string {
  return name.replace(SUFFIX_RE, "").trim();
}

function matches(indexed: IndexedPlayer, row: SnapshotRow): boolean {
  if (indexed.player.position !== row.position) return false;

  const norm = normalizeName(stripSuffix(row.name));
  if (indexed.player.position === "DST") return indexed.dst.includes(norm);
  if (indexed.normName === norm || indexed.variants.includes(norm)) return true;

  const abbrev = ABBREV_RE.exec(stripSuffix(row.name));
  if (!abbrev || indexed.normLast === "") return false;
  return (
    indexed.firstInitial === abbrev[1].toLowerCase() &&
    indexed.normLast === normalizeName(abbrev[2])
  );
}

/**
 * Resolve transcribed rows to player_ids. A row that matches zero or multiple
 * players lands in `unresolved` — never guessed, never silently dropped
 * (docs/10 §2.4). Abbreviated CBS names collide often enough ("B. Robinson")
 * that guessing would corrupt a lineup with nothing downstream to catch it.
 */
export function resolveRows(rows: SnapshotRow[], players: PlayerRecord[]): ResolveReport {
  const index = indexPlayers(players);
  const resolved: ResolvedRow[] = [];
  const unresolved: UnresolvedRow[] = [];

  for (const row of rows) {
    let candidates = index.filter((p) => matches(p, row));
    if (candidates.length > 1) {
      const byTeam = candidates.filter((p) => p.player.nfl_team === row.nfl_team);
      if (byTeam.length > 0) candidates = byTeam;
    }

    if (candidates.length === 1) {
      resolved.push({ ...row, player_id: candidates[0].player.player_id, player: candidates[0].player });
    } else {
      unresolved.push({
        row,
        candidates: candidates.map((c) => ({
          player_id: c.player.player_id,
          name: c.player.name,
          position: c.player.position,
          nfl_team: c.player.nfl_team,
        })),
      });
    }
  }

  return { resolved, unresolved };
}

function snapshotPath(season: number, week: number): string {
  return path.join(process.cwd(), "data", "season", String(season), `week${String(week).padStart(2, "0")}.json`);
}

export function loadWeekSnapshot(season: number, week: number): WeekSnapshot | null {
  const file = snapshotPath(season, week);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as WeekSnapshot;
}

/** Snapshot-replace: writing week N discards whatever week N held before. */
export function writeWeekSnapshot(snapshot: WeekSnapshot): void {
  const file = snapshotPath(snapshot.season, snapshot.week);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
}
