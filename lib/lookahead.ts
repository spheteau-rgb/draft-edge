/**
 * Alg 5 (docs/03) — sequential pick optimizer (survival-aware lookahead).
 * HIGH VALUE — do not weaken this. For each of the top-8 shortlist
 * candidates, simulate opponents to the user's next pick using common random
 * numbers (CRN) across all candidates, take the best available response
 * there, and average its value.
 *
 * Adaptive rollout budget (config/model.yaml lookahead): 500 -> 250 -> 100 ->
 * deterministic expected lookahead. Never drop below the deterministic floor.
 * Latency target < 1.0s, hard ceiling 1.5s.
 */

import type { PlayerRecord, DraftState, Position } from "@/types";
import { loadModelConfig } from "@/lib/config";
import { playerValue } from "@/lib/vorp";
import { managerAffinity, runShock } from "@/lib/market";

export interface RolloutResult {
  candidatePlayerId: string;
  lookaheadValue: number;
  rolloutsUsed: number;
  seedBundle: string;
  /** The player the opponent-response step most often left on the board for the
   * user at their next pick — feeds the "expected alternative if wait" UI field. */
  expectedBestResponsePlayerId: string | null;
}

// Not in config/model.yaml because it's league structural data (docs/02),
// not a tunable heuristic coefficient.
const LEAGUE_TEAMS = 12;

/**
 * FinalScore(p) = ImmediateScore(p) + 0.55 * z(LookaheadValue(p))
 * (weight from config/model.yaml lookahead.final_score_weight)
 */
export function computeFinalScore(immediateScore: number, lookaheadValueZ: number): number {
  const config = loadModelConfig();
  return immediateScore + config.lookahead.final_score_weight * lookaheadValueZ;
}

function slotForPick(pickNumber: number, teams = LEAGUE_TEAMS): number {
  const round = Math.ceil(pickNumber / teams);
  const posInRound = pickNumber - (round - 1) * teams;
  return round % 2 === 1 ? posInRound : teams - posInRound + 1;
}

/** Manager slots that pick between the user's current turn and their next turn. */
function opponentSlotsBetween(state: DraftState): number[] {
  const slots: number[] = [];
  for (let pick = state.current_pick + 1; pick < state.user_next_pick; pick++) {
    slots.push(slotForPick(pick));
  }
  return slots;
}

/** Deterministic per-draft-state seed base so a snapshot's rollouts can be replayed exactly. */
function deriveSeedBase(state: DraftState): number {
  return state.current_pick * 1000003 + state.drafted_player_ids.length * 97 + 1;
}

// Simple, fast, seedable PRNG (mulberry32) — no external deps needed for CRN.
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
  if (!roster) return 0.5; // unknown roster: neutral prior
  const requiredByPos: Partial<Record<Position, number>> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
  const required = requiredByPos[position];
  if (!required) return 0.3; // RWT-eligible positions still have some flex-driven need; not modeled per-slot here
  const filled = roster.starters.filter((s) => s.slot === position && s.player_id !== null).length;
  return Math.max(0, (required - filled) / required);
}

/**
 * PositionScore(pos) = 0.45*market_best_at_pos + 0.25*roster_need
 *                    + 0.20*manager_affinity + 0.10*run_pressure
 */
function positionScore(
  position: Position,
  managerSlot: number,
  availablePool: PlayerRecord[],
  state: DraftState,
  weights: { market_best_at_pos: number; roster_need: number; manager_affinity: number; run_pressure: number }
): number {
  const atPos = availablePool.filter((p) => p.position === position && !p.is_drafted);
  const bestAtPos = atPos.length > 0 ? Math.max(...atPos.map(playerValue)) : 0;
  const bestOverall = availablePool.length > 0 ? Math.max(...availablePool.map(playerValue)) : 1;
  const marketBest = bestOverall > 0 ? Math.max(0, bestAtPos) / bestOverall : 0;

  const rosterNeed = estimateRosterNeed(managerSlot, position, state);
  const affinity = managerAffinity(managerSlot, position);
  const shock = runShock(position, state.picks); // capped [-3,3]
  const runPressure = (shock + 3) / 6; // normalize to [0,1]

  return (
    weights.market_best_at_pos * marketBest +
    weights.roster_need * rosterNeed +
    weights.manager_affinity * affinity +
    weights.run_pressure * runPressure
  );
}

/**
 * Opponent pick policy for a single rollout step (docs/03 §Alg 5):
 * PositionScore = 0.45*market_best_at_pos + 0.25*roster_need
 *               + 0.20*manager_affinity + 0.10*run_pressure
 * choose position via softmax(T=0.8); then top-3 market players at pos: 70/20/10.
 */
export function opponentPickPolicy(
  managerSlot: number,
  availablePool: PlayerRecord[],
  state: DraftState,
  rngSeed: number
): PlayerRecord {
  const config = loadModelConfig();
  const rng = mulberry32(rngSeed);
  const weights = config.lookahead.opponent_policy.position_score_weights;
  const temperature = config.lookahead.opponent_policy.softmax_temperature;
  const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

  const scores = positions.map((pos) => positionScore(pos, managerSlot, availablePool, state, weights));
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxScore) / Math.max(1e-6, temperature)));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sumExp);

  const u1 = rng();
  let cumulative = 0;
  let chosenPos: Position = positions[positions.length - 1];
  for (let i = 0; i < positions.length; i++) {
    cumulative += probs[i];
    if (u1 <= cumulative) {
      chosenPos = positions[i];
      break;
    }
  }

  const atPos = availablePool
    .filter((p) => p.position === chosenPos && !p.is_drafted)
    .sort((a, b) => a.market.expected_pick - b.market.expected_pick);

  if (atPos.length === 0) {
    const fallback = [...availablePool].sort((a, b) => playerValue(b) - playerValue(a))[0];
    return fallback ?? availablePool[0];
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

/** Argmax version of the opponent policy (no sampling) — used by the deterministic floor. */
function expectedOpponentPick(managerSlot: number, availablePool: PlayerRecord[], state: DraftState): PlayerRecord {
  const config = loadModelConfig();
  const weights = config.lookahead.opponent_policy.position_score_weights;
  const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
  let bestPos: Position = positions[0];
  let bestScore = -Infinity;
  for (const pos of positions) {
    const score = positionScore(pos, managerSlot, availablePool, state, weights);
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }
  const atPos = availablePool
    .filter((p) => p.position === bestPos && !p.is_drafted)
    .sort((a, b) => a.market.expected_pick - b.market.expected_pick);
  if (atPos.length > 0) return atPos[0];
  const fallback = [...availablePool].sort((a, b) => playerValue(b) - playerValue(a))[0];
  return fallback ?? availablePool[0];
}

function bestAvailableResponse(pool: PlayerRecord[]): PlayerRecord | null {
  return pool.reduce<PlayerRecord | null>((acc, p) => (!acc || playerValue(p) > playerValue(acc) ? p : acc), null);
}

/** Never drop below this — deterministic expected lookahead (docs/03 §Alg 5 rollout budget). */
function deterministicLookahead(
  shortlist: PlayerRecord[],
  availablePool: PlayerRecord[],
  state: DraftState,
  gapSlots: number[]
): RolloutResult[] {
  return shortlist.map((candidate) => {
    let pool = availablePool.filter((p) => p.player_id !== candidate.player_id);
    for (const slot of gapSlots) {
      if (pool.length === 0) break;
      const picked = expectedOpponentPick(slot, pool, state);
      pool = pool.filter((p) => p.player_id !== picked.player_id);
    }
    const best = bestAvailableResponse(pool);
    return {
      candidatePlayerId: candidate.player_id,
      lookaheadValue: best ? playerValue(best) : 0,
      rolloutsUsed: 0,
      seedBundle: "deterministic",
      expectedBestResponsePlayerId: best ? best.player_id : null,
    };
  });
}

function simulateAll(
  shortlist: PlayerRecord[],
  availablePool: PlayerRecord[],
  state: DraftState,
  gapSlots: number[],
  rolloutsPerCandidate: number,
  seedBase: number,
  startTime: number,
  hardCeilingMs: number
): RolloutResult[] {
  const results: RolloutResult[] = [];
  for (const candidate of shortlist) {
    let sum = 0;
    let used = 0;
    const responseCounts = new Map<string, number>();
    for (let r = 0; r < rolloutsPerCandidate; r++) {
      if (r % 50 === 0 && Date.now() - startTime > hardCeilingMs) break; // latency safety valve
      let pool = availablePool.filter((p) => p.player_id !== candidate.player_id);
      for (let i = 0; i < gapSlots.length; i++) {
        if (pool.length === 0) break;
        // CRN: seed depends only on (rollout index, step index), never on the candidate,
        // so every candidate's branch sees the same opponent-behavior random draws.
        const seed = seedBase + r * 7919 + i * 104729;
        const picked = opponentPickPolicy(gapSlots[i], pool, state, seed);
        pool = pool.filter((p) => p.player_id !== picked.player_id);
      }
      const best = bestAvailableResponse(pool);
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

/**
 * Run CRN rollouts for every shortlist candidate, stepping the budget down
 * only if the latency budget is exceeded for this draft state.
 */
export async function runLookahead(
  shortlist: PlayerRecord[],
  availablePool: PlayerRecord[],
  state: DraftState
): Promise<RolloutResult[]> {
  const config = loadModelConfig();
  const gapSlots = opponentSlotsBetween(state);
  const seedBase = deriveSeedBase(state);

  // Never simulate opponents beyond your next pick, and if you're on the
  // clock right now with no gap, the "lookahead" degenerates to "what's
  // best available after taking p" — still meaningful, handled the same way.
  const tryBudgets = [...config.lookahead.rollout_budget_fallback].sort((a, b) => b - a);

  for (const budget of tryBudgets) {
    const t0 = Date.now();
    try {
      const results = simulateAll(
        shortlist,
        availablePool,
        state,
        gapSlots,
        budget,
        seedBase,
        t0,
        config.lookahead.latency_hard_ceiling_ms
      );
      const elapsed = Date.now() - t0;
      if (elapsed <= config.lookahead.latency_hard_ceiling_ms) {
        return results;
      }
    } catch {
      // fall through to the next (smaller) budget
    }
  }

  // Floor: deterministic survival-aware lookahead — the sequential term must
  // always be present in some form (CLAUDE.md, docs/03).
  return deterministicLookahead(shortlist, availablePool, state, gapSlots);
}

/**
 * Precompute hook: when the user is `lookahead.precompute_ahead_picks` picks
 * away, kick off the rollout in the background so it's ready before their
 * turn (docs/03 §Precompute while you wait). Caller decides transport
 * (in-memory cache, KV, etc.) — this just runs the computation.
 */
export async function precomputeIfUpcoming(
  state: DraftState,
  availablePool: PlayerRecord[]
): Promise<RolloutResult[] | null> {
  const config = loadModelConfig();
  if (state.on_the_clock_slot === state.user_slot) return null; // it's already the user's turn
  const picksAway = state.user_next_pick - state.current_pick;
  if (picksAway <= 0 || picksAway > config.lookahead.precompute_ahead_picks) return null;

  const shortlist = [...availablePool]
    .filter((p) => !p.is_drafted)
    .sort((a, b) => playerValue(b) - playerValue(a))
    .slice(0, config.candidate_pool.shortlist_size);

  try {
    return await runLookahead(shortlist, availablePool, state);
  } catch {
    return null;
  }
}
