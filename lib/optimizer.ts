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
import { computeAllReplacementValues, computeVORP, computeRosterGain } from "@/lib/vorp";
import { currentRosterGain } from "@/lib/lineup";
import { computeLeagueMarketRanks, tierUrgency, managerAffinity, runShock } from "@/lib/market";
import { survivalProb, adjustedSurvival, adpSigmaForRank } from "@/lib/survival";
import { computeCenterScale, applyZ, type CenterScale } from "@/lib/standardize";
import { generateReasons, confidenceLabel, checkDoNotReach, type ScoredCandidate } from "@/lib/reasons";
import { runLookahead, computeFinalScore } from "@/lib/lookahead";

interface ComponentSet {
  player: PlayerRecord;
  vorp: number;
  rosterGain: number;
  urgency: number;
  marketMispricing: number;
  upside: number;
  uncertainty: number;
  /** Pre-baked z-value for the K/DST guardrail (docs/03), 0 for every other position. */
  rosterPenaltyRaw: number;
  leagueMarketRank: number;
}

interface ScoredComponentSet extends ComponentSet {
  immediateScore: number;
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

/** Build the per-player component set (VORP, roster gain, urgency, market, upside, uncertainty). */
function computeComponents(
  available: PlayerRecord[],
  allPlayers: PlayerRecord[],
  state: DraftState,
  stage: ReturnType<typeof stageForRound>
): ComponentSet[] {
  const config = loadModelConfig();
  const replacementValues = computeAllReplacementValues(available);
  const marketRanks = computeLeagueMarketRanks(available, state);
  const userPlayers = playersForManager(state.user_slot, state, allPlayers);
  const round = state.current_round;

  return available.map((p) => {
    const vorp = computeVORP(p, replacementValues[p.position] ?? 0);
    const rGain = currentRosterGain(p, userPlayers);
    const rosterGain = computeRosterGain(vorp, rGain, stage);
    const urgency = tierUrgency(p.position, available, allPlayers);
    const marketEntry = marketRanks.get(p.player_id);
    const leagueMarketRank = marketEntry?.rank ?? p.league_market_rank;
    // Positive = the room is letting him fall further than fundamental value
    // suggests (a "discount"); negative = the room reaches for him early.
    const marketMispricing = leagueMarketRank - p.fundamental_rank;
    const upside = p.projection.weekly_p90;
    const uncertainty =
      p.projection.weekly_mean > 0 ? p.projection.weekly_sd / p.projection.weekly_mean : 0;

    let rosterPenaltyRaw = 0;
    if (p.position === "K" || p.position === "DST") {
      const bucket = kdstBucket(round);
      rosterPenaltyRaw = config.kdst_guardrail[bucket][p.position as "K" | "DST"];
    }

    return {
      player: p,
      vorp,
      rosterGain,
      urgency,
      marketMispricing,
      upside,
      uncertainty,
      rosterPenaltyRaw,
      leagueMarketRank,
    };
  });
}

/** docs/03 §Candidate generation — fixed union of top-N by each metric (config/model.yaml candidate_pool). */
function buildCandidatePool(components: ComponentSet[]): ComponentSet[] {
  const config = loadModelConfig().candidate_pool;
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
  cs: Record<"vorp" | "rosterGain" | "urgency" | "market" | "upside" | "uncertainty", CenterScale>,
  weights: ReturnType<typeof loadModelConfig>["stage_weights"]["R1_4"],
  overrideZ: number
): ScoredComponentSet {
  const vorpZ = applyZ(c.vorp, cs.vorp);
  const rosterGainZ = applyZ(c.rosterGain, cs.rosterGain);
  const urgencyZ = applyZ(c.urgency, cs.urgency);
  const marketZ = applyZ(c.marketMispricing, cs.market);
  const upsideZ = applyZ(c.upside, cs.upside);
  const uncertaintyZ = applyZ(c.uncertainty, cs.uncertainty);

  // Guardrail override: if this K/DST candidate's own VORP z-score clears the
  // "exceptional" bar, lift the pre-baked roster-penalty guardrail entirely.
  let rosterPenaltyZ = c.rosterPenaltyRaw;
  if (rosterPenaltyZ !== 0 && vorpZ > overrideZ) rosterPenaltyZ = 0;

  const immediateScore =
    weights.roster_gain * rosterGainZ +
    weights.urgency * urgencyZ +
    weights.market * marketZ +
    weights.upside * upsideZ -
    weights.roster_penalty * rosterPenaltyZ -
    weights.uncertainty * uncertaintyZ;

  return { ...c, immediateScore };
}

/** Full pipeline (docs/03 Alg 3-5). Throws on any failure — caller decides the fallback. */
async function computeRecommendation(state: DraftState, allPlayers: PlayerRecord[]): Promise<Recommendation> {
  const config = loadModelConfig();
  const stage = stageForRound(state.current_round);
  const draftedIds = new Set(state.drafted_player_ids);
  const available = allPlayers.filter((p) => !draftedIds.has(p.player_id) && !p.is_drafted);
  if (available.length === 0) throw new Error("optimizer: no available players");

  const components = computeComponents(available, allPlayers, state, stage);
  const candidates = buildCandidatePool(components);
  if (candidates.length === 0) throw new Error("optimizer: empty candidate pool");

  const cs = {
    vorp: computeCenterScale(candidates.map((c) => c.vorp)),
    rosterGain: computeCenterScale(candidates.map((c) => c.rosterGain)),
    urgency: computeCenterScale(candidates.map((c) => c.urgency)),
    market: computeCenterScale(candidates.map((c) => c.marketMispricing)),
    upside: computeCenterScale(candidates.map((c) => c.upside)),
    uncertainty: computeCenterScale(candidates.map((c) => c.uncertainty)),
  };
  const weights = config.stage_weights[stage];
  const overrideZ = config.kdst_guardrail.guardrail_override.exceptional_vorp_z;

  const scored = candidates
    .map((c) => scoreCandidate(c, cs, weights, overrideZ))
    .sort((a, b) => b.immediateScore - a.immediateScore);

  const shortlist = scored.slice(0, config.candidate_pool.shortlist_size);

  // Alg 5 — CRN rollouts to the user's next pick, for the shortlist only (expensive step).
  const rolloutResults = await runLookahead(
    shortlist.map((s) => s.player),
    available,
    state
  );
  const rolloutMap = new Map(rolloutResults.map((r) => [r.candidatePlayerId, r]));
  const lookaheadCS = computeCenterScale(
    shortlist.map((s) => rolloutMap.get(s.player.player_id)?.lookaheadValue ?? 0)
  );

  const finalScored: FinalScoredComponentSet[] = shortlist
    .map((s) => {
      const rollout = rolloutMap.get(s.player.player_id);
      const lookaheadValue = rollout?.lookaheadValue ?? 0;
      const finalScore = computeFinalScore(s.immediateScore, applyZ(lookaheadValue, lookaheadCS));
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

  // Survival to the user's own next pick (docs/03 Alg 4).
  const sigma = adpSigmaForRank(top.player.market.expected_pick);
  const baseSurv = survivalProb(top.player.market.expected_pick, sigma, state.current_pick, state.user_next_pick);
  const pressure = managerAffinity(state.on_the_clock_slot, top.player.position);
  const shock = runShock(top.player.position, state.picks);
  const survival = adjustedSurvival(baseSurv, pressure, shock, top.urgency);

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
        survivalToNextPick: 0,
        rosterGain: runnerUp.rosterGain,
        urgency: runnerUp.urgency,
        market: runnerUp.marketMispricing,
        upside: runnerUp.upside,
        lookaheadValue: runnerUp.lookaheadValue,
      }
    : null;

  let reasons = generateReasons(topCandidate, runnerUpCandidate);
  const doNotReach = checkDoNotReach(topCandidate, state.current_pick, reasons);
  if (doNotReach) reasons = Array.from(new Set([...reasons, "MODEL_DISAGREEMENT" as ReasonCode])).slice(0, 3);

  const alternatives: RecommendationAlternative[] = finalScored.slice(1, 5).map((s) => ({
    player_id: s.player.player_id,
    name: s.player.name,
    position: s.player.position,
    score: s.finalScore,
    survival_to_next_pick: 0,
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
    pick_number: state.current_pick,
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
      pick_number: state.current_pick,
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
    pick_number: state.current_pick,
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
