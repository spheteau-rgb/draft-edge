/**
 * Equivalence guard for the incremental lookahead engine.
 *
 * lib/lookahead.ts replaced the old "re-bucket + re-scan the whole pool on
 * every simulated opponent pick" approach with a prebuilt SimEngine that reads
 * the front of pre-sorted per-position views, skipping only the players removed
 * so far. This test proves the optimization is EXACT: it reimplements the naive
 * per-call policy from scratch here (an independent reference) and asserts that,
 * for identical seeds/budgets/gap slots/pool, the engine-based simulateAll
 * produces byte-for-byte identical RolloutResults — same lookaheadValue, same
 * expectedBestResponsePlayerId, same rolloutsUsed. If they ever diverge, a
 * draft-day recommendation could silently change; this test must stay green.
 *
 * Run from the repo root: npx tsx scripts/test_lookahead_equiv.ts
 */

import { loadPlayerPool } from "@/lib/players";
import { loadModelConfig } from "@/lib/config";
import { playerValue } from "@/lib/vorp";
import { managerAffinity, runShock } from "@/lib/market";
import {
  simulateAll,
  buildSimEngine,
  opponentSlotsBetween,
  deriveSeedBase,
  type RolloutResult,
} from "@/lib/lookahead";
import type { PlayerRecord, DraftState, Position, DraftPick, TeamRoster } from "@/types";

const LEAGUE_TEAMS = 12;
const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

// ---- Independent naive reference (mirrors the pre-optimization algorithm) ----

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
  const required = requiredByPos[position];
  if (!required) return 0.3;
  const filled = roster.starters.filter((s) => s.slot === position && s.player_id !== null).length;
  return Math.max(0, (required - filled) / required);
}

function naivePositionScore(
  position: Position,
  managerSlot: number,
  pool: PlayerRecord[],
  state: DraftState,
  weights: { market_best_at_pos: number; roster_need: number; manager_affinity: number; run_pressure: number }
): number {
  const atPos = pool.filter((p) => p.position === position);
  const bestAtPos = atPos.length > 0 ? Math.max(...atPos.map(playerValue)) : 0;
  const bestOverall = pool.length > 0 ? Math.max(...pool.map(playerValue)) : 1;
  const marketBest = bestOverall > 0 ? Math.max(0, bestAtPos) / bestOverall : 0;
  const rosterNeed = estimateRosterNeed(managerSlot, position, state);
  const affinity = managerAffinity(managerSlot, position);
  const shock = runShock(position, state.picks);
  const runPressure = (shock + 3) / 6;
  return (
    weights.market_best_at_pos * marketBest +
    weights.roster_need * rosterNeed +
    weights.manager_affinity * affinity +
    weights.run_pressure * runPressure
  );
}

function naiveOpponentPick(
  managerSlot: number,
  pool: PlayerRecord[],
  state: DraftState,
  rngSeed: number
): PlayerRecord {
  const config = loadModelConfig();
  const rng = mulberry32(rngSeed);
  const weights = config.lookahead.opponent_policy.position_score_weights;
  const temperature = config.lookahead.opponent_policy.softmax_temperature;
  const scores = POSITIONS.map((pos) => naivePositionScore(pos, managerSlot, pool, state, weights));
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxScore) / Math.max(1e-6, temperature)));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sumExp);

  const u1 = rng();
  let cumulative = 0;
  let chosenPos: Position = POSITIONS[POSITIONS.length - 1];
  for (let i = 0; i < POSITIONS.length; i++) {
    cumulative += probs[i];
    if (u1 <= cumulative) {
      chosenPos = POSITIONS[i];
      break;
    }
  }

  const atPos = pool
    .filter((p) => p.position === chosenPos)
    .slice()
    .sort((a, b) => a.market.expected_pick - b.market.expected_pick);
  if (atPos.length === 0) {
    return [...pool].sort((a, b) => playerValue(b) - playerValue(a))[0];
  }
  const top3 = atPos.slice(0, 3);
  const rawProbs = config.lookahead.opponent_policy.top3_player_probs.slice(0, top3.length);
  const sumRaw = rawProbs.reduce((a, b) => a + b, 0) || 1;
  const normProbs = rawProbs.map((p) => p / sumRaw);

  const u2 = rng();
  let cumulative2 = 0;
  let chosenIdx = top3.length - 1;
  for (let i = 0; i < top3.length; i++) {
    cumulative2 += normProbs[i];
    if (u2 <= cumulative2) {
      chosenIdx = i;
      break;
    }
  }
  return top3[chosenIdx];
}

function naiveBestResponse(pool: PlayerRecord[]): PlayerRecord | null {
  return pool.reduce<PlayerRecord | null>(
    (acc, p) => (!acc || playerValue(p) > playerValue(acc) ? p : acc),
    null
  );
}

function naiveSimulateAll(
  shortlist: PlayerRecord[],
  availablePool: PlayerRecord[],
  state: DraftState,
  gapSlots: number[],
  rolloutsPerCandidate: number,
  seedBase: number
): RolloutResult[] {
  const results: RolloutResult[] = [];
  for (const candidate of shortlist) {
    let sum = 0;
    let used = 0;
    const responseCounts = new Map<string, number>();
    for (let r = 0; r < rolloutsPerCandidate; r++) {
      let pool = availablePool.filter((p) => p.player_id !== candidate.player_id);
      for (let i = 0; i < gapSlots.length; i++) {
        if (pool.length === 0) break;
        const seed = seedBase + r * 7919 + i * 104729;
        const picked = naiveOpponentPick(gapSlots[i], pool, state, seed);
        pool = pool.filter((p) => p.player_id !== picked.player_id);
      }
      const best = naiveBestResponse(pool);
      sum += best ? playerValue(best) : 0;
      used += 1;
      if (best) responseCounts.set(best.player_id, (responseCounts.get(best.player_id) ?? 0) + 1);
    }
    let modeResponse: string | null = null;
    let modeCount = -1;
    for (const [id, count] of responseCounts.entries()) {
      if (count > modeCount) {
        modeCount = count;
        modeResponse = id;
      }
    }
    results.push({
      candidatePlayerId: candidate.player_id,
      lookaheadValue: used > 0 ? sum / used : 0,
      rolloutsUsed: used,
      seedBundle: `seed-${seedBase}`,
      expectedBestResponsePlayerId: modeResponse,
    });
  }
  return results;
}

// ---- Fixture ----

function buildState(players: PlayerRecord[], userNextPick: number): { state: DraftState; available: PlayerRecord[] } {
  const find = (name: string) => {
    const p = players.find((pp) => pp.name === name);
    if (!p) throw new Error("missing fixture player: " + name);
    return p;
  };
  const drafted = ["Bijan Robinson", "Jahmyr Gibbs", "Ja'Marr Chase"].map(find);
  const picks: DraftPick[] = drafted.map((p, i) => ({
    pick_number: i + 1,
    round: 1,
    manager_slot: i + 1,
    player_id: p.player_id,
    player_name: p.name,
    position: p.position,
    nfl_team: p.nfl_team,
    source: "manual",
    observed_at: new Date().toISOString(),
  }));
  const rosters: TeamRoster[] = [];
  for (let slot = 1; slot <= LEAGUE_TEAMS; slot++) {
    rosters.push({
      manager_slot: slot,
      team_name: slot === 4 ? "Mama There Goes That Man" : `Team ${slot}`,
      starters: [],
      bench_player_ids: picks.filter((p) => p.manager_slot === slot).map((p) => p.player_id),
    });
  }
  const draftedIds = new Set(drafted.map((p) => p.player_id));
  const available = players.filter((p) => !draftedIds.has(p.player_id) && !p.is_drafted);
  const state: DraftState = {
    draft_id: "equiv-test",
    season: 2026,
    current_pick: 4,
    current_round: 1,
    on_the_clock_slot: 4,
    user_slot: 4,
    user_next_pick: userNextPick,
    picks,
    rosters,
    drafted_player_ids: [...draftedIds],
    status: "in_progress",
    last_updated: new Date().toISOString(),
  };
  return { state, available };
}

function assertEqualResults(label: string, ref: RolloutResult[], opt: RolloutResult[]): number {
  if (ref.length !== opt.length) throw new Error(`${label}: length ${ref.length} vs ${opt.length}`);
  let mismatches = 0;
  for (let i = 0; i < ref.length; i++) {
    const a = ref[i];
    const b = opt.find((r) => r.candidatePlayerId === a.candidatePlayerId);
    if (!b) {
      console.error(`${label}: missing candidate ${a.candidatePlayerId} in optimized output`);
      mismatches++;
      continue;
    }
    const valDiff = Math.abs(a.lookaheadValue - b.lookaheadValue);
    if (valDiff > 1e-9) {
      console.error(`${label}: ${a.candidatePlayerId} lookaheadValue ${a.lookaheadValue} vs ${b.lookaheadValue} (Δ${valDiff})`);
      mismatches++;
    }
    if (a.rolloutsUsed !== b.rolloutsUsed) {
      console.error(`${label}: ${a.candidatePlayerId} rolloutsUsed ${a.rolloutsUsed} vs ${b.rolloutsUsed}`);
      mismatches++;
    }
    if (a.expectedBestResponsePlayerId !== b.expectedBestResponsePlayerId) {
      console.error(
        `${label}: ${a.candidatePlayerId} expectedResponse ${a.expectedBestResponsePlayerId} vs ${b.expectedBestResponsePlayerId}`
      );
      mismatches++;
    }
  }
  return mismatches;
}

function main() {
  const { players } = loadPlayerPool();
  const config = loadModelConfig();
  const shortlistNames = [
    "Christian McCaffrey",
    "Jonathan Taylor",
    "Derrick Henry",
    "De'Von Achane",
    "Josh Allen",
    "Puka Nacua",
    "Amon-Ra St. Brown",
    "Saquon Barkley",
  ];

  // Per-rollout reproduction is the invariant, so modest budgets across several
  // gaps exercise many distinct seeds without paying the naive O(pool) cost at
  // the full 500 budget. If any single (gap, budget) pair diverges, the
  // incremental engine is not exact.
  void config;
  const sweep: Array<{ gap: number; budget: number }> = [
    { gap: 21, budget: 250 },
    { gap: 21, budget: 80 },
    { gap: 22, budget: 120 },
    { gap: 45, budget: 80 },
    { gap: 60, budget: 60 },
    { gap: 60, budget: 30 },
  ];
  let totalMismatches = 0;
  let cases = 0;

  for (const { gap, budget } of sweep) {
    const { state, available } = buildState(players, gap);
    const shortlist = shortlistNames
      .map((n) => available.find((p) => p.name === n))
      .filter((p): p is PlayerRecord => Boolean(p));
    const gapSlots = opponentSlotsBetween(state);
    const seedBase = deriveSeedBase(state);
    const engine = buildSimEngine(available);

    cases++;
    process.stdout.write(`... running gap=${gap} (${gapSlots.length} opp picks) budget=${budget}\n`);
    const ref = naiveSimulateAll(shortlist, available, state, gapSlots, budget, seedBase);
    const opt = simulateAll(engine, shortlist, state, gapSlots, budget, seedBase, Date.now(), 1e12);
    const m = assertEqualResults(`gap=${gap} budget=${budget}`, ref, opt);
    if (m === 0) {
      console.log(`OK  gap=${gap} (${gapSlots.length} opp picks) budget=${budget} — ${ref.length} candidates identical`);
    }
    totalMismatches += m;
  }

  console.log("");
  if (totalMismatches === 0) {
    console.log(`PASS — ${cases} (gap,budget) cases, all RolloutResults numerically identical (Δ<=1e-9).`);
  } else {
    console.error(`FAIL — ${totalMismatches} mismatches across ${cases} cases.`);
    process.exit(1);
  }
}

main();
