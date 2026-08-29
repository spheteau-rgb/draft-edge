/**
 * Draft state store interface (docs/09 KV keys: `draft:state`, `draft:log`).
 * State lives server-side — never in device memory (CLAUDE.md non-negotiable).
 *
 * This file defines the interface + a minimal in-memory implementation so
 * the algorithm/API layer is unblocked while deployment-engineer wires the
 * real KV-backed store. Swap `getDraftStateStore()` to return a KV
 * implementation later; nothing else in /lib or /app should need to change.
 */

import type { DraftEvent, DraftPick, DraftState, TeamRoster } from "@/types";
import { loadPlayerPool } from "@/lib/players";
import { bestLineup } from "@/lib/lineup";

export interface DraftStateStore {
  getState(): Promise<DraftState>;
  applyEvent(event: DraftEvent): Promise<DraftState>;
  undo(): Promise<DraftState>;
}

const LEAGUE_TEAMS = 12;
const DRAFT_ROUNDS = 14;
const USER_SLOT = 4;
const STARTER_SLOT_TEMPLATE: Array<TeamRoster["starters"][number]["slot"]> = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "RWT",
  "K",
  "DST",
];

function slotForPick(pickNumber: number, teams = LEAGUE_TEAMS): number {
  const round = Math.ceil(pickNumber / teams);
  const posInRound = pickNumber - (round - 1) * teams;
  return round % 2 === 1 ? posInRound : teams - posInRound + 1;
}

function roundForPick(pickNumber: number, teams = LEAGUE_TEAMS): number {
  return Math.ceil(pickNumber / teams);
}

/** User's next pick_number strictly after `afterPick` (12-team snake, slot 4). */
function nextUserPick(afterPick: number, userSlot = USER_SLOT, teams = LEAGUE_TEAMS, rounds = DRAFT_ROUNDS): number {
  for (let pick = afterPick + 1; pick <= teams * rounds; pick++) {
    if (slotForPick(pick, teams) === userSlot) return pick;
  }
  return teams * rounds + 1; // draft over
}

function buildInitialRosters(): TeamRoster[] {
  const rosters: TeamRoster[] = [];
  for (let slot = 1; slot <= LEAGUE_TEAMS; slot++) {
    rosters.push({
      manager_slot: slot,
      team_name: slot === USER_SLOT ? "Mama There Goes That Man" : `Team ${slot}`,
      starters: STARTER_SLOT_TEMPLATE.map((s) => ({ slot: s, player_id: null })),
      bench_player_ids: [],
    });
  }
  return rosters;
}

function buildInitialState(): DraftState {
  return {
    draft_id: "family-affair-2026",
    season: 2026,
    current_pick: 1,
    current_round: 1,
    on_the_clock_slot: slotForPick(1),
    user_slot: USER_SLOT,
    user_next_pick: slotForPick(1) === USER_SLOT ? 1 : nextUserPick(0),
    picks: [],
    rosters: buildInitialRosters(),
    drafted_player_ids: [],
    status: "not_started",
    last_updated: new Date().toISOString(),
  };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve a canonical draft event to a Draft Edge player_id, never joining on name alone if an id is already present. */
function resolvePlayerId(event: DraftEvent): string | null {
  if (event.player_id) return event.player_id;
  const { players } = loadPlayerPool();
  const match = players.find(
    (p) => normalizeName(p.name) === normalizeName(event.player_name) && p.position === event.position
  );
  return match ? match.player_id : null;
}

/** Recompute a team's starters/bench from its full drafted set via the flex-aware lineup optimizer. */
function recomputeRoster(teamPlayers: ReturnType<typeof loadPlayerPool>["players"]): {
  starters: TeamRoster["starters"];
  bench_player_ids: string[];
} {
  // bestLineup's assignment already has exactly one entry per starter slot
  // (including two separate "RB" entries etc.), so it can be used directly.
  const { assignment } = bestLineup(teamPlayers);
  const starterIds = new Set(assignment.map((a) => a.player_id).filter((id): id is string => id !== null));
  const bench = teamPlayers.filter((p) => !starterIds.has(p.player_id)).map((p) => p.player_id);
  return { starters: assignment, bench_player_ids: bench };
}

class InMemoryDraftStateStore implements DraftStateStore {
  private state: DraftState = buildInitialState();
  private log: DraftEvent[] = [];

  async getState(): Promise<DraftState> {
    return this.state;
  }

  async applyEvent(event: DraftEvent): Promise<DraftState> {
    if (event.event_type === "undo") {
      return this.undo();
    }

    const playerId = resolvePlayerId(event);
    if (!playerId) {
      throw new Error(`applyEvent: could not resolve player_id for "${event.player_name}" (${event.position})`);
    }
    if (this.state.drafted_player_ids.includes(playerId)) {
      if (event.event_type === "correction") {
        // Correction: remove the prior pick for this pick_number, then fall through to re-add.
        this.state.picks = this.state.picks.filter((p) => p.pick_number !== event.pick_number);
      } else {
        throw new Error(`applyEvent: duplicate pick — player ${playerId} already drafted`);
      }
    }

    this.log.push(event);
    this.rebuildFromLog();
    return this.state;
  }

  async undo(): Promise<DraftState> {
    // Pop the last draft_pick/correction event (undo events themselves aren't replayed).
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i].event_type !== "undo") {
        this.log.splice(i, 1);
        break;
      }
    }
    this.rebuildFromLog();
    return this.state;
  }

  private rebuildFromLog(): void {
    const { players } = loadPlayerPool();
    const fresh = buildInitialState();
    const picks: DraftPick[] = [];
    const draftedIds: string[] = [];

    for (const event of this.log) {
      if (event.event_type === "undo") continue;
      const playerId = resolvePlayerId(event);
      if (!playerId || draftedIds.includes(playerId)) continue;
      const player = players.find((p) => p.player_id === playerId);
      if (!player) continue;

      const pick: DraftPick = {
        pick_number: event.pick_number,
        round: event.round || roundForPick(event.pick_number),
        manager_slot: event.manager_slot || slotForPick(event.pick_number),
        player_id: playerId,
        player_name: player.name,
        position: player.position,
        nfl_team: player.nfl_team,
        source: event.source,
        observed_at: event.observed_at,
      };
      picks.push(pick);
      draftedIds.push(playerId);
    }

    picks.sort((a, b) => a.pick_number - b.pick_number);

    const rosters = buildInitialRosters();
    for (const roster of rosters) {
      const teamPlayerIds = picks.filter((p) => p.manager_slot === roster.manager_slot).map((p) => p.player_id);
      const teamPlayers = teamPlayerIds
        .map((id) => players.find((p) => p.player_id === id))
        .filter((p): p is (typeof players)[number] => !!p);
      const { starters, bench_player_ids } = recomputeRoster(teamPlayers);
      roster.starters = starters;
      roster.bench_player_ids = bench_player_ids;
    }

    const lastPick = picks.length > 0 ? picks[picks.length - 1].pick_number : 0;
    const currentPick = lastPick + 1;

    fresh.picks = picks;
    fresh.drafted_player_ids = draftedIds;
    fresh.rosters = rosters;
    fresh.current_pick = currentPick;
    fresh.current_round = roundForPick(currentPick);
    fresh.on_the_clock_slot = slotForPick(currentPick);
    fresh.user_next_pick =
      slotForPick(currentPick) === USER_SLOT ? currentPick : nextUserPick(currentPick - 1);
    fresh.status = picks.length === 0 ? "not_started" : currentPick > LEAGUE_TEAMS * DRAFT_ROUNDS ? "complete" : "in_progress";
    fresh.last_updated = new Date().toISOString();

    this.state = fresh;
  }
}

let storeSingleton: DraftStateStore | null = null;

export function getDraftStateStore(): DraftStateStore {
  if (!storeSingleton) storeSingleton = new InMemoryDraftStateStore();
  return storeSingleton;
}

export { slotForPick, roundForPick, nextUserPick, LEAGUE_TEAMS, DRAFT_ROUNDS, USER_SLOT };
