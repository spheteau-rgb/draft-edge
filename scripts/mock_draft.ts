/**
 * Full 14-round mock draft from slot 4, driving the REAL runtime optimizer
 * (getRecommendation) for the user and a softmax opponent policy for the other
 * 11 teams. Verifies the roster-construction hardening: the resulting roster
 * must have exactly 1 QB, 1 TE, <=1 K, <=1 DST, no K before its earliest round,
 * no DST before its earliest round, and every starter slot filled.
 *
 * Run from repo root: npx tsx scripts/mock_draft.ts [seed]
 *
 * This is the regression guard for the F-grade mock (2 DSTs, 4 QBs, a round-8
 * kicker) that motivated the hardening. Exit code 1 on any violation.
 */

import { loadPlayerPool } from "@/lib/players";
import { loadModelConfig } from "@/lib/config";
import { getRecommendation } from "@/lib/optimizer";
import { playerValue } from "@/lib/vorp";
import { managerAffinity, runShock } from "@/lib/market";
import { slotForPick, roundForPick, nextUserPick, LEAGUE_TEAMS, DRAFT_ROUNDS, USER_SLOT } from "@/lib/store";
import type { PlayerRecord, DraftState, DraftPick, TeamRoster, Position } from "@/types";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function estimateRosterNeed(managerSlot: number, position: Position, state: DraftState): number {
  const roster = state.rosters.find((r) => r.manager_slot === managerSlot);
  if (!roster) return 0.5;
  const requiredByPos: Partial<Record<Position, number>> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
  const required = requiredByPos[position] ?? 1;
  const filled = roster.bench_player_ids.length; // proxy; opponents don't set starters here
  void filled;
  // Count opponent's players at this position.
  return required; // opponents just weigh needs loosely; detail handled by softmax
}

/**
 * Opponent policy mirrors lib/lookahead's naive reference AND respects the same
 * roster-construction realities a human uses (one QB/TE/K/DST, K/DST late). This
 * keeps opponents realistic so the user's optimizer faces a plausible board.
 */
function opponentPick(
  managerSlot: number,
  pool: PlayerRecord[],
  state: DraftState,
  round: number,
  rng: () => number
): PlayerRecord {
  const config = loadModelConfig();
  const rc = config.roster_construction;
  const counts = positionCounts(managerSlot, state, pool);
  const weights = config.lookahead.opponent_policy.position_score_weights;
  const temperature = config.lookahead.opponent_policy.softmax_temperature;

  const legal = (pos: Position): boolean => {
    const cap = rc.position_caps[pos];
    if (cap !== undefined && counts[pos] >= cap) return false;
    const earliest = rc.earliest_round[pos];
    if (earliest !== undefined && round < earliest) return false;
    return true;
  };

  const legalPositions = POSITIONS.filter((pos) => legal(pos) && pool.some((p) => p.position === pos));
  const usePositions = legalPositions.length > 0 ? legalPositions : POSITIONS;

  const scores = usePositions.map((pos) => {
    const atPos = pool.filter((p) => p.position === pos);
    const bestAtPos = atPos.length > 0 ? Math.max(...atPos.map(playerValue)) : 0;
    const bestOverall = pool.length > 0 ? Math.max(...pool.map(playerValue)) : 1;
    const marketBest = bestOverall > 0 ? Math.max(0, bestAtPos) / bestOverall : 0;
    const need = estimateRosterNeed(managerSlot, pos, state);
    const affinity = managerAffinity(managerSlot, pos);
    const shock = runShock(pos, state.picks);
    const runPressure = (shock + 3) / 6;
    return (
      weights.market_best_at_pos * marketBest +
      weights.roster_need * (need > 0 ? 0.5 : 0.1) +
      weights.manager_affinity * affinity +
      weights.run_pressure * runPressure
    );
  });
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxScore) / Math.max(1e-6, temperature)));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sumExp);

  let u = rng();
  let cum = 0;
  let chosen: Position = usePositions[usePositions.length - 1];
  for (let i = 0; i < usePositions.length; i++) {
    cum += probs[i];
    if (u <= cum) {
      chosen = usePositions[i];
      break;
    }
  }
  const atPos = pool
    .filter((p) => p.position === chosen)
    .sort((a, b) => a.market.expected_pick - b.market.expected_pick);
  if (atPos.length === 0) return [...pool].sort((a, b) => playerValue(b) - playerValue(a))[0];
  const top3 = atPos.slice(0, 3);
  const raw = config.lookahead.opponent_policy.top3_player_probs.slice(0, top3.length);
  const sumRaw = raw.reduce((a, b) => a + b, 0) || 1;
  const norm = raw.map((p) => p / sumRaw);
  u = rng();
  cum = 0;
  for (let i = 0; i < top3.length; i++) {
    cum += norm[i];
    if (u <= cum) return top3[i];
  }
  return top3[top3.length - 1];
}

function positionCounts(
  managerSlot: number,
  state: DraftState,
  allPlayers: PlayerRecord[]
): Record<Position, number> {
  const roster = state.rosters.find((r) => r.manager_slot === managerSlot);
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  if (!roster) return counts;
  const byId = new Map(allPlayers.map((p) => [p.player_id, p]));
  for (const id of roster.bench_player_ids) {
    const p = byId.get(id);
    if (p) counts[p.position] += 1;
  }
  return counts;
}

async function main() {
  const seed = Number(process.argv[2] ?? 20260830);
  const rng = mulberry32(seed);
  const { players } = loadPlayerPool();
  const config = loadModelConfig();
  const rc = config.roster_construction;

  const rosters: TeamRoster[] = [];
  for (let slot = 1; slot <= LEAGUE_TEAMS; slot++) {
    rosters.push({
      manager_slot: slot,
      team_name: slot === USER_SLOT ? "Mama There Goes That Man" : `Team ${slot}`,
      starters: [],
      bench_player_ids: [],
    });
  }

  const picks: DraftPick[] = [];
  const draftedIds = new Set<string>();
  const totalPicks = LEAGUE_TEAMS * DRAFT_ROUNDS;
  const userPicks: { round: number; name: string; pos: Position }[] = [];

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber++) {
    const slot = slotForPick(pickNumber);
    const round = roundForPick(pickNumber);
    const available = players.filter((p) => !draftedIds.has(p.player_id));

    const state: DraftState = {
      draft_id: `mock-${seed}`,
      season: 2026,
      current_pick: pickNumber,
      current_round: round,
      on_the_clock_slot: slot,
      user_slot: USER_SLOT,
      user_next_pick: slot === USER_SLOT ? pickNumber : nextUserPick(pickNumber - 1),
      picks,
      rosters,
      drafted_player_ids: [...draftedIds],
      status: "in_progress",
      last_updated: new Date().toISOString(),
    };

    let chosen: PlayerRecord;
    if (slot === USER_SLOT) {
      const rec = await getRecommendation(state, players);
      chosen = available.find((p) => p.player_id === rec.recommended_player_id) ?? available[0];
      userPicks.push({ round, name: chosen.name, pos: chosen.position });
    } else {
      chosen = opponentPick(slot, available, state, round, rng);
    }

    draftedIds.add(chosen.player_id);
    const roster = rosters.find((r) => r.manager_slot === slot)!;
    roster.bench_player_ids.push(chosen.player_id);
    picks.push({
      pick_number: pickNumber,
      round,
      manager_slot: slot,
      player_id: chosen.player_id,
      player_name: chosen.name,
      position: chosen.position,
      nfl_team: chosen.nfl_team,
      source: "manual",
      observed_at: new Date().toISOString(),
    });
  }

  // ---- Report + assertions on the USER roster ----
  const userRoster = rosters.find((r) => r.manager_slot === USER_SLOT)!;
  const byId = new Map(players.map((p) => [p.player_id, p]));
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  const kRounds: number[] = [];
  const dstRounds: number[] = [];
  for (const up of userPicks) counts[up.pos] += 1;
  for (const up of userPicks) {
    if (up.pos === "K") kRounds.push(up.round);
    if (up.pos === "DST") dstRounds.push(up.round);
  }

  console.log(`\n=== USER ROSTER (slot ${USER_SLOT}, seed ${seed}) ===`);
  for (const up of userPicks) console.log(`  R${String(up.round).padStart(2)}  ${up.pos.padEnd(3)}  ${up.name}`);
  console.log(`\n  Counts: ${POSITIONS.map((p) => `${p}:${counts[p]}`).join("  ")}`);
  void byId;

  const violations: string[] = [];
  if (counts.QB !== 1) violations.push(`QB count ${counts.QB} (want exactly 1 — no backup QB)`);
  if (counts.TE !== 1) violations.push(`TE count ${counts.TE} (want exactly 1 — no backup TE)`);
  if (counts.K !== 1) violations.push(`K count ${counts.K} (want exactly 1 — legal, not early/duplicate)`);
  if (counts.DST !== 1) violations.push(`DST count ${counts.DST} (want exactly 1 — legal, not early/duplicate)`);
  for (const r of kRounds) if (r < (rc.earliest_round.K ?? 13)) violations.push(`K taken R${r} (earliest ${rc.earliest_round.K})`);
  for (const r of dstRounds) if (r < (rc.earliest_round.DST ?? 12)) violations.push(`DST taken R${r} (earliest ${rc.earliest_round.DST})`);
  // Startable core: at least 1 QB, 2 RB, 2 WR, 1 TE, and enough for K/DST by end.
  if (counts.RB < 2) violations.push(`RB count ${counts.RB} (want >=2 starters)`);
  if (counts.WR < 2) violations.push(`WR count ${counts.WR} (want >=2 starters)`);

  console.log("");
  if (violations.length === 0) {
    console.log("PASS — roster is well-constructed (no backup QB/TE, no early/duplicate K-DST, startable core filled).");
  } else {
    console.error("FAIL — roster-construction violations:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
