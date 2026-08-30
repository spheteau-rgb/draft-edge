/**
 * Alg 3-5 orchestrator (docs/03 §Candidate generation, §PickScore, §Audit).
 * This is the ONLY place the individual /lib modules (vorp, lineup, market,
 * survival, lookahead, reasons, standardize) are combined into a single
 * Recommendation. Never calls an LLM, never blocks on network I/O — all
 * inputs are the cached player pool + in-memory/KV draft state.
 *
 * CLAUDE.md non-negotiable: the live path must ALWAYS return a
 * recommendation. `getRecommendation` is the public entrypoint and never
 * throws — it falls back to a simpler heuristic (and eventually to a bare
 * best-fundamental-rank pick) rather than surfacing an error to the UI.
 */

import type {
  PlayerRecord,
  DraftState,
  Position,
  Recommendation,
  RecommendationAlternative,
  ReasonCode,
} from "@/types";
import { loadModelConfig, stageForRound } from "@/lib/config";
import { nextUserPick, slotForPick, LEAGUE_TEAMS, DRAFT_ROUNDS } from "@/lib/store";
import { computeAllReplacementValues, computeVORP, computeRosterGain } from "@/lib/vorp";
import { currentRosterGain } from "@/lib/lineup";
import { rosterCounts, evaluateConstruction, mustFillPositions } from "@/lib/roster_rules";
import { computeLeagueMarketRanks, tierUrgency, managerAffinity, runShock } from "@/lib/market";
import { survivalProb, adjustedSurvival, adpSigmaForRank } from "@/lib/survival";
import { computeCenterScale, applyZ, type CenterScale } from "@/lib/standardize";
import { generateReasons, confidenceLabel, checkDoNotReach, type ScoredCandidate } from "@/lib/reasons";
import { runLookahead, computeFinalScore, buildSimValuation } from "@/lib/lookahead";

interface ComponentSet {
  player: PlayerRecord;
  vorp: number;
  rosterGain: number;
  urgency: number;
  marketMispricing: number;
  upside: number;
  uncertainty: number;
  /** P(still on the board at the user's next turn) — Alg 4. Scored as a discount, and reused for display. */
  survival: number;
  /** Pre-baked z-value for the K/DST guardrail (docs/03), 0 for every other position. */
  rosterPenaltyRaw: number;
  leagueMarketRank: number;
  /** Hard roster-construction layer (lib/roster_rules.ts). */
  hardBlock: boolean;
  hardBlockReason: string | null;
  /** Soft, VORP-overridable penalty for an early QB/TE reach (z-scale). */
  earlyPenalty: number;
  /** Additive z-boost for a candidate that fills an unfilled starter slot. */
  needBoost: number;
}

interface ScoredComponentSet extends ComponentSet {
  immediateScore: number;
  /**
   * needBoost - resolved earlyPenalty: the same roster-fit nudge folded into
   * ImmediateScore (docs/03, docs/07 3.4 Skattebo-over-WR fix). LookaheadValue
   * from lib/lookahead.ts is pure position-agnostic VORP (candidate + best
   * response, both from buildSimValuation's valueOf) with zero fit/need
   * weighting, so a redundant 3rd RB with no open dedicated slot could still
   * out-rank an empty-starter WR1 once 0.55*z(LookaheadValue) was added back
   * in. Reapplying the identical fit delta here — instead of touching
   * lookahead.ts's rollout math — keeps the expensive CRN simulation
   * position-agnostic (correct: it's answering "what's left on the board",
   * not "what does the user need") while making sure FinalScore sees the same
   * fit signal ImmediateScore already does.
   */
  fitAdjustment: number;
}

interface FinalScoredComponentSet extends ScoredComponentSet {
  lookaheadValue: number;
  finalScore: number;
  expectedBestResponsePlayerId: string | null;
}

function kdstBucket(round: number): "R1_8" | "R9_11" | "R12_plus" {
  if (round <= 8) return "R1_8";
  if (round <= 11) return "R9_11";
  return "R12_plus";
}

/** Every player currently rostered (starters + bench) by a manager slot. */
function playersForManager(manager_slot: number, state: DraftState, allPlayers: PlayerRecord[]): PlayerRecord[] {
  const roster = state.rosters.find((r) => r.manager_slot === manager_slot);
  if (!roster) return [];
  const ids = new Set<string>([
    ...roster.starters.map((s) => s.player_id).filter((id): id is string => id !== null),
    ...roster.bench_player_ids,
  ]);
  return allPlayers.filter((p) => ids.has(p.player_id));
}

/**
 * The pick number survival and the lookahead are both measured to.
 * `state.user_next_pick` equals `current_pick` while the user is on the clock,
 * which is right for display but would make survival trivially 1.0; the real
 * question is "will he last until my NEXT turn after this one."
 */
function survivalHorizon(state: DraftState): number {
  return state.on_the_clock_slot === state.user_slot
    ? nextUserPick(state.current_pick, state.user_slot)
    : state.user_next_pick;
}

/**
 * The slot that picks immediately after this one — the "about to snipe him"
 * pressure signal. `on_the_clock_slot` is the user themselves while they are
 * actively picking, so it can't be used directly.
 */
function pressureSlot(state: DraftState): number {
  return state.on_the_clock_slot === state.user_slot
    ? slotForPick(state.current_pick + 1)
    : state.on_the_clock_slot;
}

interface ComponentBundle {
  components: ComponentSet[];
  replacementValues: Record<Position, number>;
  counts: Record<Position, number>;
}

/** Build the per-player component set (VORP, roster gain, urgency, market, upside, uncertainty). */
function computeComponents(
  available: PlayerRecord[],
  allPlayers: PlayerRecord[],
  state: DraftState,
  stage: ReturnType<typeof stageForRound>
): ComponentBundle {
  const config = loadModelConfig();
  const replacementValues = computeAllReplacementValues(available);
  const marketRanks = computeLeagueMarketRanks(available, state);

  // Both sides of MarketMispricing must be ranks over the SAME population.
  // `player.fundamental_rank` is a rank over the whole preseason pool while
  // computeLeagueMarketRanks ranks only who is left, so differencing them added
  // a drifting offset that grew with every pick and, worse, reordered
  // candidates by how many drafted players happened to sit above them. Ranking
  // fundamental value over the available pool puts both on "spots among who's
  // still on the board."
  const availableFundamentalRank = new Map<string, number>();
  [...available]
    .sort((a, b) => a.fundamental_rank - b.fundamental_rank)
    .forEach((p, idx) => availableFundamentalRank.set(p.player_id, idx + 1));
  const userPlayers = playersForManager(state.user_slot, state, allPlayers);
  const counts = rosterCounts(userPlayers);
  const round = state.current_round;

  // End-of-draft "must-fill": how many picks does the user have left, and does
  // that force the pool down to only still-needed mandatory positions (so K/DST
  // actually get taken before the roster becomes illegal).
  const totalPicks = LEAGUE_TEAMS * DRAFT_ROUNDS;
  let remainingUserPicks = 0;
  for (let pk = state.current_pick; pk <= totalPicks; pk++) {
    if (slotForPick(pk) === state.user_slot) remainingUserPicks += 1;
  }
  const forced = mustFillPositions(counts, remainingUserPicks);

  // Per-position weekly_p90 mean/sd over the available pool, so "upside" can be
  // expressed as a WITHIN-position z-score. Raw weekly_p90 is cross-position
  // points (QBs 25-30 pt ceilings dominate); a naive relative ceiling
  // ((p90-mean)/mean) fixes the scale but INVERTS within-position ranking,
  // rewarding low-mean scrubs. Within-position z keeps studs above scrubs AND
  // is comparable across positions — the correct normalization.
  const p90ByPos: Record<string, number[]> = {};
  for (const p of available) (p90ByPos[p.position] ??= []).push(p.projection.weekly_p90);
  const p90Stats: Record<string, { mean: number; sd: number }> = {};
  for (const [pos, vals] of Object.entries(p90ByPos)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length);
    p90Stats[pos] = { mean, sd: Math.sqrt(variance) };
  }

  // Survival inputs. `managerAffinity` and `runShock` depend only on position
  // (the slot and pick history are fixed for this call), so memoize them rather
  // than recomputing per player across the whole available pool.
  const horizon = survivalHorizon(state);
  const oppSlot = pressureSlot(state);
  const pressureByPos = new Map<Position, { pressure: number; shock: number }>();

  const components = available.map((p) => {
    const vorp = computeVORP(p, replacementValues[p.position] ?? 0);
    const rGain = currentRosterGain(p, userPlayers, replacementValues);
    const rosterGain = computeRosterGain(vorp, rGain, stage);
    const urgency = tierUrgency(p.position, available, allPlayers);
    const marketEntry = marketRanks.get(p.player_id);
    const leagueMarketRank = marketEntry?.rank ?? p.league_market_rank;
    // Positive = the room is letting him fall further than fundamental value
    // suggests (a "discount"); negative = the room reaches for him early.
    const marketMispricing =
      leagueMarketRank - (availableFundamentalRank.get(p.player_id) ?? p.fundamental_rank);
    // Position-NORMALIZED ceiling: weekly_p90 z-scored WITHIN the player's
    // position. Raw weekly_p90 is cross-position points, so QBs (25-30 pt
    // ceilings) dominated the upside term and surfaced backup QBs in R10-14
    // where upside is weighted heaviest (0.35). Within-position z removes that
    // scale bias while preserving stud-over-scrub ordering at each position.
    const ps = p90Stats[p.position];
    const upside = ps && ps.sd > 0 ? (p.projection.weekly_p90 - ps.mean) / ps.sd : 0;
    const uncertainty =
      p.projection.weekly_mean > 0 ? p.projection.weekly_sd / p.projection.weekly_mean : 0;

    let pressureEntry = pressureByPos.get(p.position);
    if (!pressureEntry) {
      pressureEntry = {
        pressure: managerAffinity(oppSlot, p.position),
        shock: runShock(p.position, state.picks, round),
      };
      pressureByPos.set(p.position, pressureEntry);
    }
    const survival = adjustedSurvival(
      survivalProb(p.market.expected_pick, adpSigmaForRank(p.market.expected_pick), state.current_pick, horizon),
      pressureEntry.pressure,
      pressureEntry.shock,
      urgency
    );

    let rosterPenaltyRaw = 0;
    if (p.position === "K" || p.position === "DST") {
      const bucket = kdstBucket(round);
      rosterPenaltyRaw = config.kdst_guardrail[bucket][p.position as "K" | "DST"];
    }

    // Hard roster-construction layer: caps (no backup QB/TE, one K, one DST),
    // earliest-round gates (K/DST), soft early-reach penalty, starter-need boost.
    const construction = evaluateConstruction(p.position, counts, round);

    // Must-fill override: near the end, restrict the pool to still-needed
    // mandatory positions. A forced-needed position is also UN-blocked (it
    // can't be at cap since it's below its minimum, and its earliest-round gate
    // must yield to fielding a legal lineup).
    let hardBlock = construction.hardBlock;
    let hardBlockReason = construction.hardBlockReason;
    if (forced) {
      if (forced.has(p.position)) {
        hardBlock = false;
        hardBlockReason = null;
      } else {
        hardBlock = true;
        hardBlockReason = `must-fill: only ${[...forced].join("/")} remaining`;
      }
    }

    return {
      player: p,
      vorp,
      rosterGain,
      urgency,
      marketMispricing,
      upside,
      uncertainty,
      survival,
      rosterPenaltyRaw,
      leagueMarketRank,
      hardBlock,
      hardBlockReason,
      earlyPenalty: construction.earlyPenalty,
      needBoost: construction.needBoost,
    };
  });

  return { components, replacementValues, counts };
}

/** docs/03 §Candidate generation — fixed union of top-N by each metric (config/model.yaml candidate_pool). */
function buildCandidatePool(components: ComponentSet[]): ComponentSet[] {
  const config = loadModelConfig().candidate_pool;
  // Hard roster-construction filter FIRST (lib/roster_rules.ts): remove
  // structurally-wrong picks (backup QB/TE, 2nd K/DST, early K/DST) before the
  // pool is even built. Safety net (CLAUDE.md non-negotiable #1): if that would
  // empty the pool — a degenerate late-draft state — keep the full set so the
  // live path always returns a pick.
  const eligible = components.filter((c) => !c.hardBlock);
  const pool = eligible.length > 0 ? eligible : components;
  components = pool;

  const byFundamental = [...components]
    .sort((a, b) => a.player.fundamental_rank - b.player.fundamental_rank)
    .slice(0, config.top_by_fundamental_value);
  const byVorp = [...components].sort((a, b) => b.vorp - a.vorp).slice(0, config.top_by_vorp);
  const byUrgency = [...components].sort((a, b) => b.urgency - a.urgency).slice(0, config.top_by_urgency);
  const byMarket = [...components]
    .sort((a, b) => b.marketMispricing - a.marketMispricing)
    .slice(0, config.top_by_market_mispricing);
  const byUpside = [...components].sort((a, b) => b.upside - a.upside).slice(0, config.top_by_upside);

  const map = new Map<string, ComponentSet>();
  for (const c of [...byFundamental, ...byVorp, ...byUrgency, ...byMarket, ...byUpside]) {
    map.set(c.player.player_id, c);
  }
  return Array.from(map.values());
}

/** PickScore(p) per docs/03 — robust (median/MAD) standardization frozen over the candidate union. */
function scoreCandidate(
  c: ComponentSet,
  cs: Record<"vorp" | "rosterGain" | "urgency" | "market" | "upside" | "uncertainty" | "survival", CenterScale>,
  weights: ReturnType<typeof loadModelConfig>["stage_weights"]["R1_4"],
  overrideZ: number,
  earlyPenaltyConfig: ReturnType<typeof loadModelConfig>["roster_construction"]["early_position_penalty"]
): ScoredComponentSet {
  const vorpZ = applyZ(c.vorp, cs.vorp);
  const rosterGainZ = applyZ(c.rosterGain, cs.rosterGain);
  const urgencyZ = applyZ(c.urgency, cs.urgency);
  const marketZ = applyZ(c.marketMispricing, cs.market);
  const upsideZ = applyZ(c.upside, cs.upside);
  const uncertaintyZ = applyZ(c.uncertainty, cs.uncertainty);
  const survivalZ = applyZ(c.survival, cs.survival);

  // Guardrail override: if this K/DST candidate's own VORP z-score clears the
  // "exceptional" bar, lift the pre-baked roster-penalty guardrail entirely.
  let rosterPenaltyZ = c.rosterPenaltyRaw;
  if (rosterPenaltyZ !== 0 && vorpZ > overrideZ) rosterPenaltyZ = 0;

  const baseScore =
    weights.roster_gain * rosterGainZ +
    weights.urgency * urgencyZ +
    weights.market * marketZ +
    weights.upside * upsideZ -
    weights.roster_penalty * rosterPenaltyZ -
    weights.uncertainty * uncertaintyZ -
    // Opportunity cost: a candidate who will still be there at your next turn
    // is one you can have later for free, so discount him now.
    weights.survival * survivalZ;

  // Roster-construction adjustments (lib/roster_rules.ts), applied as a direct
  // z-nudge through a sign-correct channel we own (NOT the kdst rosterPenalty
  // term). Applied directly (not scaled by the stage's roster-gain weight) so
  // depth balance still bites in the late rounds where that weight shrinks:
  //  - needBoost: fills an unfilled STARTER slot (+1.0) or builds depth toward
  //    the RB/WR target (proportional to the gap) -> nudge up.
  //  - earlyPenalty: QB/TE reached before the room usually takes them -> nudge
  //    down, UNLESS the player is market-corroborated elite (his own blended,
  //    history-adjusted ADP already has him going this early — not just our
  //    model liking him) or clears a stricter VORP bar as a fallback. "Way too
  //    irresistible to pass" requires the room to agree, per config/model.yaml.
  let earlyPenalty = c.earlyPenalty;
  if (earlyPenalty !== 0) {
    const cfg = earlyPenaltyConfig[c.player.position];
    const adpCorroborated =
      cfg?.override_expected_pick_max !== undefined &&
      c.player.market.expected_pick <= cfg.override_expected_pick_max;
    const vorpCorroborated = cfg?.override_vorp_z !== undefined && vorpZ > cfg.override_vorp_z;
    if (adpCorroborated || vorpCorroborated) earlyPenalty = 0;
  }

  const immediateScore = baseScore + c.needBoost - earlyPenalty;
  const fitAdjustment = c.needBoost - earlyPenalty;

  return { ...c, immediateScore, fitAdjustment };
}

/** Full pipeline (docs/03 Alg 3-5). Throws on any failure — caller decides the fallback. */
async function computeRecommendation(state: DraftState, allPlayers: PlayerRecord[]): Promise<Recommendation> {
  const config = loadModelConfig();
  const stage = stageForRound(state.current_round);
  const draftedIds = new Set(state.drafted_player_ids);
  const available = allPlayers.filter((p) => !draftedIds.has(p.player_id) && !p.is_drafted);
  if (available.length === 0) throw new Error("optimizer: no available players");

  const { components, replacementValues, counts } = computeComponents(available, allPlayers, state, stage);
  const candidates = buildCandidatePool(components);
  if (candidates.length === 0) throw new Error("optimizer: empty candidate pool");

  const cs = {
    vorp: computeCenterScale(candidates.map((c) => c.vorp)),
    rosterGain: computeCenterScale(candidates.map((c) => c.rosterGain)),
    urgency: computeCenterScale(candidates.map((c) => c.urgency)),
    market: computeCenterScale(candidates.map((c) => c.marketMispricing)),
    upside: computeCenterScale(candidates.map((c) => c.upside)),
    uncertainty: computeCenterScale(candidates.map((c) => c.uncertainty)),
    survival: computeCenterScale(candidates.map((c) => c.survival)),
  };
  const weights = config.stage_weights[stage];
  const overrideZ = config.kdst_guardrail.guardrail_override.exceptional_vorp_z;

  const scored = candidates
    .map((c) => scoreCandidate(c, cs, weights, overrideZ, config.roster_construction.early_position_penalty))
    .sort((a, b) => b.immediateScore - a.immediateScore);

  const shortlist = scored.slice(0, config.candidate_pool.shortlist_size);

  const lookaheadTargetPick = survivalHorizon(state);
  const lookaheadState: DraftState =
    lookaheadTargetPick === state.user_next_pick ? state : { ...state, user_next_pick: lookaheadTargetPick };

  // Alg 5 — CRN rollouts to the user's next pick, for the shortlist only (expensive step).
  const rolloutResults = await runLookahead(
    shortlist.map((s) => s.player),
    available,
    lookaheadState,
    buildSimValuation(replacementValues, counts)
  );
  const rolloutMap = new Map(rolloutResults.map((r) => [r.candidatePlayerId, r]));
  // z-standardize LookaheadValue over its OWN raw (position-agnostic VORP)
  // distribution first — that's what the CRN rollout actually measured, and
  // corrupting the pre-z values with a +/-1.0 fit nudge is a no-op when raw
  // VORP spans ~150-180 points (docs/07 3.4 replay: the shift vanished under
  // rounding). Then add the SAME fitAdjustment (needBoost - resolved
  // earlyPenalty) already folded into ImmediateScore to the Z-SCORE itself,
  // in the z-scale units it's calibrated in (docs/03 roster_construction:
  // starter_need_boost/flex_only_boost are z-equivalents, exactly like the
  // needBoost/earlyPenalty term added directly onto ImmediateScore's own
  // z-scored baseScore). This is what stops a redundant 3rd RB (flex-only,
  // RB dedicated slots already full) from out-scoring an empty WR1 (dedicated)
  // purely on positional-scarcity VORP once 0.55*z(LookaheadValue) is added
  // back into FinalScore.
  const lookaheadCS = computeCenterScale(
    shortlist.map((s) => rolloutMap.get(s.player.player_id)?.lookaheadValue ?? 0)
  );
  const fitAdjustedLookaheadZ = (s: ScoredComponentSet) =>
    applyZ(rolloutMap.get(s.player.player_id)?.lookaheadValue ?? 0, lookaheadCS) + s.fitAdjustment;

  const finalScored: FinalScoredComponentSet[] = shortlist
    .map((s) => {
      const rollout = rolloutMap.get(s.player.player_id);
      const lookaheadValue = rollout?.lookaheadValue ?? 0;
      const finalScore = computeFinalScore(s.immediateScore, fitAdjustedLookaheadZ(s));
      return {
        ...s,
        lookaheadValue,
        finalScore,
        expectedBestResponsePlayerId: rollout?.expectedBestResponsePlayerId ?? null,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  const top = finalScored[0];
  const runnerUp: FinalScoredComponentSet | null = finalScored[1] ?? null;

  const survival = top.survival;

  const scoreCS = computeCenterScale(finalScored.map((s) => s.finalScore));
  const scoreGap = runnerUp ? top.finalScore - runnerUp.finalScore : scoreCS.scale;
  const confidence = confidenceLabel(scoreGap, scoreCS.scale);

  const topCandidate: ScoredCandidate = {
    player: top.player,
    finalScore: top.finalScore,
    survivalToNextPick: survival,
    rosterGain: top.rosterGain,
    urgency: top.urgency,
    market: top.marketMispricing,
    upside: top.upside,
    lookaheadValue: top.lookaheadValue,
  };
  const runnerUpCandidate: ScoredCandidate | null = runnerUp
    ? {
        player: runnerUp.player,
        finalScore: runnerUp.finalScore,
        survivalToNextPick: runnerUp.survival,
        rosterGain: runnerUp.rosterGain,
        urgency: runnerUp.urgency,
        market: runnerUp.marketMispricing,
        upside: runnerUp.upside,
        lookaheadValue: runnerUp.lookaheadValue,
      }
    : null;

  let reasons = generateReasons(topCandidate, runnerUpCandidate, state.current_pick);
  const doNotReach = checkDoNotReach(topCandidate, state.current_pick, reasons);
  if (doNotReach) reasons = Array.from(new Set([...reasons, "MODEL_DISAGREEMENT" as ReasonCode])).slice(0, 3);

  const alternatives: RecommendationAlternative[] = finalScored.slice(1, 5).map((s) => ({
    player_id: s.player.player_id,
    name: s.player.name,
    position: s.player.position,
    score: s.finalScore,
    survival_to_next_pick: s.survival,
  }));

  const expectedResponse = top.expectedBestResponsePlayerId
    ? allPlayers.find((p) => p.player_id === top.expectedBestResponsePlayerId)
    : null;

  // Freshness rollup (docs/06): worst-of the recommended player's own tag and
  // whether any candidate is missing a projection source timestamp entirely.
  const freshness: Recommendation["data_freshness"] =
    top.player.data_freshness === "RED"
      ? "RED"
      : shortlist.some((s) => s.player.data_freshness === "RED")
        ? "YELLOW"
        : top.player.data_freshness;

  return {
    pick_number: state.user_next_pick,
    is_user_on_the_clock: state.on_the_clock_slot === state.user_slot,
    picks_until_your_turn: Math.max(0, state.user_next_pick - state.current_pick),
    recommended_player_id: top.player.player_id,
    recommended_player_name: top.player.name,
    position: top.player.position,
    decision_confidence: confidence,
    score: top.finalScore,
    survival_to_next_pick: survival,
    reasons,
    fundamental_rank: top.player.fundamental_rank,
    league_market_rank: top.leagueMarketRank,
    do_not_reach_flag: doNotReach,
    data_freshness: freshness,
    alternatives,
    expected_alternative_if_wait: expectedResponse
      ? { player_id: expectedResponse.player_id, name: expectedResponse.name }
      : null,
    edge_vs_runner_up: runnerUp ? scoreGap : null,
  };
}

/** Cheapest possible fallback: best available player by precomputed FundamentalRank. Never throws. */
function fallbackRecommendation(state: DraftState, allPlayers: PlayerRecord[]): Recommendation {
  const draftedIds = new Set(state.drafted_player_ids);
  const available = allPlayers
    .filter((p) => !draftedIds.has(p.player_id) && !p.is_drafted)
    .sort((a, b) => a.fundamental_rank - b.fundamental_rank);
  const top = available[0];

  if (!top) {
    return {
      pick_number: state.user_next_pick,
      is_user_on_the_clock: state.on_the_clock_slot === state.user_slot,
      picks_until_your_turn: Math.max(0, state.user_next_pick - state.current_pick),
      recommended_player_id: "",
      recommended_player_name: "No players available",
      position: "RB",
      decision_confidence: "LOW",
      score: 0,
      survival_to_next_pick: 0,
      reasons: [],
      fundamental_rank: 0,
      league_market_rank: 0,
      do_not_reach_flag: false,
      data_freshness: "RED",
      alternatives: [],
      expected_alternative_if_wait: null,
      edge_vs_runner_up: null,
    };
  }

  return {
    pick_number: state.user_next_pick,
    is_user_on_the_clock: state.on_the_clock_slot === state.user_slot,
    picks_until_your_turn: Math.max(0, state.user_next_pick - state.current_pick),
    recommended_player_id: top.player_id,
    recommended_player_name: top.name,
    position: top.position,
    decision_confidence: "LOW",
    score: 0,
    survival_to_next_pick: 0.5,
    reasons: [],
    fundamental_rank: top.fundamental_rank,
    league_market_rank: top.league_market_rank,
    do_not_reach_flag: false,
    data_freshness: "RED",
    alternatives: available.slice(1, 5).map((p) => ({
      player_id: p.player_id,
      name: p.name,
      position: p.position,
      score: 0,
      survival_to_next_pick: 0.5,
    })),
    expected_alternative_if_wait: null,
    edge_vs_runner_up: null,
  };
}

/**
 * Public entrypoint — ALWAYS returns a Recommendation (CLAUDE.md non-negotiable
 * #1: the live path never blocks, never throws to the caller). Falls down the
 * ladder: full pipeline -> bare fundamental-rank fallback.
 */
export async function getRecommendation(state: DraftState, allPlayers: PlayerRecord[]): Promise<Recommendation> {
  try {
    return await computeRecommendation(state, allPlayers);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("optimizer: full pipeline failed, using fallback", err);
    return fallbackRecommendation(state, allPlayers);
  }
}
