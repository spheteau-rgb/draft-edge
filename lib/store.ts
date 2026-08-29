/**
 * Draft state store interface (docs/09 KV key: `draft:log`).
 * State lives server-side — never in device memory (CLAUDE.md non-negotiable):
 * every device must see the same live draft, and a pick entered on one
 * device must show up on all others within a few seconds.
 *
 * The event LOG is the single source of truth; DraftState is always a pure
 * rebuild from the log (see rebuildStateFromLog below). That makes the
 * Redis-backed store trivial: persist the log as one JSON blob at
 * `draft:log`, and undo/correction just mean "drop an event and rebuild."
 *
 * getDraftStateStore() picks RedisDraftStateStore when REDIS_URL is set
 * (real deploys — Vercel serverless functions do NOT share process memory
 * across invocations, so in-memory state is unsafe there) and falls back to
 * InMemoryDraftStateStore only for local dev without Redis configured/tests.
 */

import Redis from "ioredis";
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

/** Pure rebuild of DraftState from an ordered event log — the single source of truth for both store implementations. */
function rebuildStateFromLog(log: DraftEvent[]): DraftState {
  const { players } = loadPlayerPool();
  const fresh = buildInitialState();
  const picks: DraftPick[] = [];
  const draftedIds: string[] = [];

  for (const event of log) {
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
  fresh.user_next_pick = slotForPick(currentPick) === USER_SLOT ? currentPick : nextUserPick(currentPick - 1);
  fresh.status = picks.length === 0 ? "not_started" : currentPick > LEAGUE_TEAMS * DRAFT_ROUNDS ? "complete" : "in_progress";
  fresh.last_updated = new Date().toISOString();

  return fresh;
}

/** Validate + append an event to a log, or handle undo. Throws on genuine errors (unresolvable player, true duplicate). */
function appendEvent(log: DraftEvent[], event: DraftEvent, currentState: DraftState): DraftEvent[] {
  const playerId = resolvePlayerId(event);
  if (!playerId) {
    throw new Error(`applyEvent: could not resolve player_id for "${event.player_name}" (${event.position})`);
  }
  if (currentState.drafted_player_ids.includes(playerId)) {
    if (event.event_type === "correction") {
      // Correction: drop the prior pick at this pick_number, then fall through to re-add via the new event.
      return [...log.filter((e) => e.pick_number !== event.pick_number || e.event_type === "undo"), event];
    }
    throw new Error(`applyEvent: duplicate pick — player ${playerId} already drafted`);
  }
  return [...log, event];
}

/** Drop the most recent non-undo event (undo events themselves are never replayed, so they don't need to be recorded). */
function popLastPick(log: DraftEvent[]): DraftEvent[] {
  const next = [...log];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].event_type !== "undo") {
      next.splice(i, 1);
      break;
    }
  }
  return next;
}

class InMemoryDraftStateStore implements DraftStateStore {
  private log: DraftEvent[] = [];
  private state: DraftState = buildInitialState();

  async getState(): Promise<DraftState> {
    return this.state;
  }

  async applyEvent(event: DraftEvent): Promise<DraftState> {
    if (event.event_type === "undo") return this.undo();
    this.log = appendEvent(this.log, event, this.state);
    this.state = rebuildStateFromLog(this.log);
    return this.state;
  }

  async undo(): Promise<DraftState> {
    this.log = popLastPick(this.log);
    this.state = rebuildStateFromLog(this.log);
    return this.state;
  }
}

/**
 * Redis-backed store (docs/09 KV key: `draft:log`). The event log is stored
 * as one JSON array at a single key — a 14-round, 12-team draft is at most
 * 168 picks, trivially small for one GET/SET per request. State is always a
 * pure rebuild from the log, so there's nothing else to keep in sync.
 */
const REDIS_LOG_KEY = "draft:log";

let redisSingleton: Redis | null = null;
function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 3,
      // Serverless-friendly: fail fast instead of hanging the request if Redis is unreachable.
      connectTimeout: 5000,
    });
    redisSingleton.on("error", (err) => {
      console.error("Redis connection error:", err.message);
    });
  }
  return redisSingleton;
}

class RedisDraftStateStore implements DraftStateStore {
  private async readLog(): Promise<DraftEvent[]> {
    const raw = await getRedis().get(REDIS_LOG_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as DraftEvent[];
    } catch {
      console.error("RedisDraftStateStore: corrupt draft:log JSON, treating as empty");
      return [];
    }
  }

  private async writeLog(log: DraftEvent[]): Promise<void> {
    await getRedis().set(REDIS_LOG_KEY, JSON.stringify(log));
  }

  async getState(): Promise<DraftState> {
    const log = await this.readLog();
    return rebuildStateFromLog(log);
  }

  async applyEvent(event: DraftEvent): Promise<DraftState> {
    if (event.event_type === "undo") return this.undo();
    const log = await this.readLog();
    const currentState = rebuildStateFromLog(log);
    const nextLog = appendEvent(log, event, currentState);
    await this.writeLog(nextLog);
    return rebuildStateFromLog(nextLog);
  }

  async undo(): Promise<DraftState> {
    const log = await this.readLog();
    const nextLog = popLastPick(log);
    await this.writeLog(nextLog);
    return rebuildStateFromLog(nextLog);
  }
}

let storeSingleton: DraftStateStore | null = null;

export function getDraftStateStore(): DraftStateStore {
  if (!storeSingleton) {
    if (process.env.REDIS_URL) {
      storeSingleton = new RedisDraftStateStore();
    } else {
      console.warn(
        "getDraftStateStore: REDIS_URL not set — falling back to in-memory store. " +
          "This does NOT persist across serverless invocations; fine for local dev/tests, unsafe for a real draft."
      );
      storeSingleton = new InMemoryDraftStateStore();
    }
  }
  return storeSingleton;
}

export { slotForPick, roundForPick, nextUserPick, LEAGUE_TEAMS, DRAFT_ROUNDS, USER_SLOT };
