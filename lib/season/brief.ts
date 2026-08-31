/**
 * docs/10 §5 Slice 2b — one object answering the only two questions the week has:
 * who do I start, and who do I add/drop.
 *
 * Everything here is assembly. The judgement lives in startsit.ts (win
 * probability) and moves.ts (ΔROS + guards); this module resolves a snapshot
 * into roster entries, runs both, and attaches the context that makes an answer
 * auditable — what each move beat, why nothing was dropped, and which future
 * weeks currently have a hole in the lineup.
 */

import type { Position } from "@/types";
import { loadPlayerPool } from "@/lib/players";
import { loadModelConfig } from "@/lib/config";
import {
  loadWeekSnapshot,
  resolveRows,
  type UnresolvedRow,
  type WeekSnapshot,
} from "@/lib/season/snapshot";
import {
  streamableReplacement,
  toEntries,
  weekLineup,
  type RosterEntry,
} from "@/lib/season/value";
import { decideStartSit, type StartSitResult } from "@/lib/season/startsit";
import { evaluateMoves, type MoveCandidate, type MovesResult, type Window } from "@/lib/season/moves";

export interface ByeAlert {
  week: number;
  /** Starter slots no rostered player can fill that week. */
  emptySlots: string[];
}

export interface Brief {
  season: number;
  week: number;
  /**
   * Positions with no free agent in the snapshot. CBS's Add Player screen is
   * filtered by position, so a partial capture leaves those slots priced at zero
   * — which inflates the marginal value of everyone at that position and can
   * manufacture a hold. Surfaced rather than patched: the fix is one more
   * screenshot, and guessing a replacement level would hide that.
   */
  missingReplacement: Position[];
  capturedAt: string;
  generatedAt: string;
  /** Rows that matched zero or several players. A non-empty list means the brief is partial. */
  unresolved: UnresolvedRow[];
  startSit: StartSitResult;
  moves: MovesResult;
  /**
   * What the top recommendation beat. Without this the brief asserts rather than
   * argues, and there is no way to sanity-check it against your own read.
   */
  runnerUp: MoveCandidate | null;
  byeAlerts: ByeAlert[];
}

function resolveTeam(rows: WeekSnapshot["my_team"]["players"]): {
  entries: RosterEntry[];
  unresolved: UnresolvedRow[];
} {
  const { players } = loadPlayerPool();
  const report = resolveRows(rows, players);
  return { entries: toEntries(report.resolved), unresolved: report.unresolved };
}

/** Weeks between now and the end where some starter slot has nobody to fill it. */
function byeAlerts(
  roster: RosterEntry[],
  currentWeek: number,
  replacement: ReturnType<typeof streamableReplacement>
): ByeAlert[] {
  const finalWeek = loadModelConfig().in_season.final_week;
  const out: ByeAlert[] = [];
  for (let w = currentWeek; w <= finalWeek; w++) {
    const { assignment } = weekLineup(roster, w, currentWeek, replacement);
    const emptySlots = assignment.filter((a) => a.player_id === null).map((a) => a.slot);
    if (emptySlots.length > 0) out.push({ week: w, emptySlots });
  }
  return out;
}

export function buildBrief(season: number, week: number, window: Window = "free"): Brief {
  const snapshot = loadWeekSnapshot(season, week);
  if (!snapshot) throw new Error(`No snapshot for ${season} week ${week}`);

  const mine = resolveTeam(snapshot.my_team.players);
  const opponent = resolveTeam(snapshot.opponent?.players ?? []);
  const freeAgents = resolveTeam(snapshot.free_agents);

  const replacement = streamableReplacement(freeAgents.entries);
  const startSit = decideStartSit(mine.entries, opponent.entries, week, week);
  const moves = evaluateMoves(mine.entries, freeAgents.entries, week, replacement, window);

  const rosterPositions = new Set(mine.entries.map((e) => e.player.position));
  const covered = new Set(freeAgents.entries.map((e) => e.player.position));

  return {
    season,
    week,
    missingReplacement: [...rosterPositions].filter((p) => !covered.has(p)),
    capturedAt: snapshot.captured_at,
    generatedAt: new Date().toISOString(),
    unresolved: [...mine.unresolved, ...opponent.unresolved, ...freeAgents.unresolved],
    startSit,
    moves,
    runnerUp: moves.recommended[1] ?? moves.rejected[0] ?? null,
    byeAlerts: byeAlerts(mine.entries, week, replacement),
  };
}
