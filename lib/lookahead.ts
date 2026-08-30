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

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

interface PositionScoreWeights {
  market_best_at_pos: number;
  roster_need: number;
  manager_affinity: number;
  run_pressure: number;
}

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
export function opponentSlotsBetween(state: DraftState): number[] {
  const slots: number[] = [];
  for (let pick = state.current_pick + 1; pick < state.user_next_pick; pick++) {
    slots.push(slotForPick(pick));
  }
  return slots;
}

/** Deterministic per-draft-state seed base so a snapshot's rollouts can be replayed exactly. */
export function deriveSeedBase(state: DraftState): number {
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
 * managerAffinity(managerSlot, position) and runShock(position, state.picks)
 * are pure functions of inputs that never change within a single runLookahead
 * call (state.picks is the real draft history, untouched by simulated
 * opponent picks) — memoizing them collapses what would otherwise be up to
 * ~384,000 redundant recomputations (shortlist x rollouts x gapSlots x
 * positions) down to at most a few dozen.
 */
interface PositionScoreMemo {
  affinity: Map<string, number>;
  shock: Map<Position, number>;
}

function createPositionScoreMemo(): PositionScoreMemo {
  return { affinity: new Map(), shock: new Map() };
}

function memoizedAffinity(memo: PositionScoreMemo, managerSlot: number, position: Position): number {
  const key = `${managerSlot}:${position}`;
  let v = memo.affinity.get(key);
  if (v === undefined) {
    v = managerAffinity(managerSlot, position);
    memo.affinity.set(key, v);
  }
  return v;
}

function memoizedRunShock(memo: PositionScoreMemo, position: Position, picks: DraftState["picks"]): number {
  let v = memo.shock.get(position);
  if (v === undefined) {
    v = runShock(position, picks);
    memo.shock.set(position, v);
  }
  return v;
}

/**
 * Exact incremental simulation engine. Built ONCE per lookahead over the full
 * (already-undrafted) available pool, then reused across every candidate and
 * rollout. Instead of re-bucketing and re-scanning the whole ~600-player pool
 * for every simulated opponent pick, each pick reads the front of three
 * pre-sorted views, skipping only the handful of players removed so far this
 * rollout. That makes each opponent-pick decision O(picks-removed-so-far)
 * (<= ~2 dozen) instead of O(pool size) — identical numbers, no pool cap, no
 * approximation. Equivalence to naive per-call bucketing is asserted in
 * scripts/test_lookahead_equiv.ts.
 */
interface SimEngine {
  /** All players, playerValue descending (ties keep pool order) — best-available scans. */
  valueDescGlobal: PlayerRecord[];
  /** Per position, playerValue descending — best-at-position value scans. */
  byPosValueDesc: Map<Position, PlayerRecord[]>;
  /** Per position, ADP ascending (ties keep pool order) — top-3 / argmax selection. */
  byPosAdpAsc: Map<Position, PlayerRecord[]>;
  total: number;
  poolIds: Set<string>;
}

/**
 * The pool handed to runLookahead is already fully undrafted (optimizer filters
 * drafted + is_drafted before calling), so every player here is selectable.
 * JS Array.sort is stable, so ties in both comparators preserve the original
 * pool order — that stability is what makes the incremental front-scans below
 * numerically identical to sorting the live remaining subset every call.
 */
export function buildSimEngine(availablePool: PlayerRecord[]): SimEngine {
  const valueDescGlobal = [...availablePool].sort((a, b) => playerValue(b) - playerValue(a));
  const byPosValueDesc = new Map<Position, PlayerRecord[]>();
  const byPosAdpAsc = new Map<Position, PlayerRecord[]>();
  const poolIds = new Set<string>();
  for (const p of availablePool) {
    poolIds.add(p.player_id);
    let vd = byPosValueDesc.get(p.position);
    if (!vd) {
      vd = [];
      byPosValueDesc.set(p.position, vd);
    }
    vd.push(p);
    let aa = byPosAdpAsc.get(p.position);
    if (!aa) {
      aa = [];
      byPosAdpAsc.set(p.position, aa);
    }
    aa.push(p);
  }
  for (const arr of byPosValueDesc.values()) arr.sort((a, b) => playerValue(b) - playerValue(a));
  for (const arr of byPosAdpAsc.values()) arr.sort((a, b) => a.market.expected_pick - b.market.expected_pick);
  return { valueDescGlobal, byPosValueDesc, byPosAdpAsc, total: availablePool.length, poolIds };
}

/** First player in a pre-sorted view not yet removed this rollout (or null). */
function firstNotRemoved(arr: PlayerRecord[] | undefined, removed: Set<string>): PlayerRecord | null {
  if (!arr) return null;
  for (const p of arr) if (!removed.has(p.player_id)) return p;
  return null;
}

function bestAtPosValue(engine: SimEngine, position: Position, removed: Set<string>): number {
  const p = firstNotRemoved(engine.byPosValueDesc.get(position), removed);
  return p ? playerValue(p) : 0;
}

/** Best available player (max playerValue) not yet removed — the user's response at their next pick. */
function bestResponse(engine: SimEngine, removed: Set<string>): PlayerRecord | null {
  return firstNotRemoved(engine.valueDescGlobal, removed);
}

/**
 * PositionScore(pos) = 0.45*market_best_at_pos + 0.25*roster_need
 *                    + 0.20*manager_affinity + 0.10*run_pressure
 * Given the best-at-position value and best-overall value directly (both from
 * the incremental engine), so no per-call pool scan is needed here.
 */
function positionScoreFromValues(
  position: Position,
  managerSlot: number,
  bestAtPos: number,
  bestOverall: number,
  state: DraftState,
  weights: PositionScoreWeights,
  memo: PositionScoreMemo
): number {
  const marketBest = bestOverall > 0 ? Math.max(0, bestAtPos) / bestOverall : 0;
  const rosterNeed = estimateRosterNeed(managerSlot, position, state);
  const affinity = memoizedAffinity(memo, managerSlot, position);
  const shock = memoizedRunShock(memo, position, state.picks); // capped [-3,3]
  const runPressure = (shock + 3) / 6; // normalize to [0,1]
  return (
    weights.market_best_at_pos * marketBest +
    weights.roster_need * rosterNeed +
    weights.manager_affinity * affinity +
    weights.run_pressure * runPressure
  );
}

/** The six position scores for a single opponent decision, given current removals. */
function scorePositions(
  managerSlot: number,
  engine: SimEngine,
  removed: Set<string>,
  state: DraftState,
  weights: PositionScoreWeights,
  memo: PositionScoreMemo
): number[] {
  const bestAtPos = POSITIONS.map((pos) => bestAtPosValue(engine, pos, removed));
  const bestOverall = Math.max(...bestAtPos); // == max playerValue over the remaining pool
  return POSITIONS.map((pos, i) =>
    positionScoreFromValues(pos, managerSlot, bestAtPos[i], bestOverall, state, weights, memo)
  );
}

/**
 * Opponent pick policy for a single rollout step (docs/03 §Alg 5):
 * choose position via softmax(T); then top-3 by ADP at that position: 70/20/10.
 * Incremental: reads engine views, skipping `removed`.
 */
function opponentPickStep(
  managerSlot: number,
  engine: SimEngine,
  removed: Set<string>,
  state: DraftState,
  rngSeed: number,
  weights: PositionScoreWeights,
  temperature: number,
  top3Probs: number[],
  memo: PositionScoreMemo
): PlayerRecord | null {
  const rng = mulberry32(rngSeed);
  const scores = scorePositions(managerSlot, engine, removed, state, weights, memo);
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

  const adpArr = engine.byPosAdpAsc.get(chosenPos);
  const top3: PlayerRecord[] = [];
  if (adpArr) {
    for (const p of adpArr) {
      if (removed.has(p.player_id)) continue;
      top3.push(p);
      if (top3.length === 3) break;
    }
  }
  if (top3.length === 0) {
    // Chosen position exhausted — fall back to overall best available.
    return firstNotRemoved(engine.valueDescGlobal, removed);
  }

  const rawProbs = top3Probs.slice(0, top3.length);
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
function expectedOpponentPickStep(
  managerSlot: number,
  engine: SimEngine,
  removed: Set<string>,
  state: DraftState,
  weights: PositionScoreWeights,
  memo: PositionScoreMemo
): PlayerRecord | null {
  const scores = scorePositions(managerSlot, engine, removed, state, weights, memo);
  let bestPos: Position = POSITIONS[0];
  let bestScore = -Infinity;
  for (let i = 0; i < POSITIONS.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestPos = POSITIONS[i];
    }
  }
  const first = firstNotRemoved(engine.byPosAdpAsc.get(bestPos), removed);
  return first ?? firstNotRemoved(engine.valueDescGlobal, removed);
}

/** Never drop below this — deterministic expected lookahead (docs/03 §Alg 5 rollout budget). */
function deterministicLookahead(
  engine: SimEngine,
  shortlist: PlayerRecord[],
  state: DraftState,
  gapSlots: number[]
): RolloutResult[] {
  const config = loadModelConfig();
  const weights = config.lookahead.opponent_policy.position_score_weights;
  const memo = createPositionScoreMemo();
  return shortlist.map((candidate) => {
    const removed = new Set<string>([candidate.player_id]);
    let remaining = engine.total - (engine.poolIds.has(candidate.player_id) ? 1 : 0);
    for (const slot of gapSlots) {
      if (remaining === 0) break;
      const picked = expectedOpponentPickStep(slot, engine, removed, state, weights, memo);
      if (picked && !removed.has(picked.player_id)) {
        removed.add(picked.player_id);
        remaining--;
      }
    }
    const best = bestResponse(engine, removed);
    return {
      candidatePlayerId: candidate.player_id,
      lookaheadValue: best ? playerValue(best) : 0,
      rolloutsUsed: 0,
      seedBundle: "deterministic",
      expectedBestResponsePlayerId: best ? best.player_id : null,
    };
  });
}

/**
 * CRN Monte Carlo over the shortlist against a prebuilt SimEngine. Exported for
 * the equivalence test (scripts/test_lookahead_equiv.ts), which drives it with
 * fixed seeds and asserts identical output to a naive per-call reference.
 */
export function simulateAll(
  engine: SimEngine,
  shortlist: PlayerRecord[],
  state: DraftState,
  gapSlots: number[],
  rolloutsPerCandidate: number,
  seedBase: number,
  startTime: number,
  hardCeilingMs: number
): RolloutResult[] {
  const config = loadModelConfig();
  const weights = config.lookahead.opponent_policy.position_score_weights;
  const temperature = config.lookahead.opponent_policy.softmax_temperature;
  const top3Probs = config.lookahead.opponent_policy.top3_player_probs;
  const memo = createPositionScoreMemo();
  const results: RolloutResult[] = [];
  for (const candidate of shortlist) {
    let sum = 0;
    let used = 0;
    const responseCounts = new Map<string, number>();
    const candidateInPool = engine.poolIds.has(candidate.player_id);
    for (let r = 0; r < rolloutsPerCandidate; r++) {
      if (r % 50 === 0 && Date.now() - startTime > hardCeilingMs) break; // latency safety valve
      const removed = new Set<string>([candidate.player_id]);
      let remaining = engine.total - (candidateInPool ? 1 : 0);
      for (let i = 0; i < gapSlots.length; i++) {
        if (remaining === 0) break;
        // CRN: seed depends only on (rollout index, step index), never on the
        // candidate, so every candidate's branch sees the same opponent draws.
        const seed = seedBase + r * 7919 + i * 104729;
        const picked = opponentPickStep(gapSlots[i], engine, removed, state, seed, weights, temperature, top3Probs, memo);
        if (picked && !removed.has(picked.player_id)) {
          removed.add(picked.player_id);
          remaining--;
        }
      }
      const best = bestResponse(engine, removed);
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
  const engine = buildSimEngine(availablePool);

  // Never simulate opponents beyond your next pick, and if you're on the
  // clock right now with no gap, the "lookahead" degenerates to "what's
  // best available after taking p" — still meaningful, handled the same way.
  const tryBudgets = [...config.lookahead.rollout_budget_fallback].sort((a, b) => b - a);

  for (const budget of tryBudgets) {
    const t0 = Date.now();
    try {
      const results = simulateAll(
        engine,
        shortlist,
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
  return deterministicLookahead(engine, shortlist, state, gapSlots);
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
