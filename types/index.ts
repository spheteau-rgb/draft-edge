/**
 * Draft Edge — shared TypeScript types.
 *
 * Single source of truth for:
 *  - the players.json schema written by /precompute (Python)
 *  - draft state / events read & written by /app/api routes and /lib (TS)
 *  - the recommendation response shape (docs/06_UI_AND_API.md)
 *
 * Ground truth: docs/03_ALGORITHMS.md (§Audit, §Rank separation, §Confidence,
 * §Reason codes) and docs/06_UI_AND_API.md (API contract). Keep this file in
 * sync with both — do not let the Python and TS shapes drift; players.json
 * MUST validate against `PlayerRecord[]` (data-engineer owns the writer,
 * architect owns the type).
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

/** Legal starting lineup slots (docs/02 roster.starters + RWT flex). */
export type LineupSlotType = "QB" | "RB" | "WR" | "TE" | "RWT" | "K" | "DST" | "BENCH";

/** Rolled-up freshness badge shown next to every recommendation (docs/06). */
export type DataFreshness = "GREEN" | "YELLOW" | "RED";

/** docs/03 §Reason codes — template-filled, no LLM, max 3 shown. */
export type ReasonCode =
  | "VALUE_GAP"
  | "WONT_SURVIVE"
  | "POSITION_CLIFF"
  | "LEAGUE_DISCOUNT"
  | "SCORING_EDGE"
  | "ROSTER_NEED"
  | "UPSIDE"
  | "TIER_DEPTH"
  | "MODEL_DISAGREEMENT";

/** docs/03 §Confidence — derived from score separation, never a fake probability. */
export type DecisionConfidence = "CLOSE CALL" | "LOW" | "MODERATE" | "HIGH" | "VERY HIGH";

/** docs/02 draft.rounds stages used for round-dependent weights (docs/03). */
export type DraftStage = "R1_4" | "R5_9" | "R10_14";

// ---------------------------------------------------------------------------
// Player (players.json — written by Python precompute, read-only at runtime)
// ---------------------------------------------------------------------------

export interface PlayerIdentity {
  /** Draft Edge UUID — the only id used for joins inside the app. */
  player_id: string;
  name: string;
  position: Position;
  nfl_team: string;
  /** Crosswalk (docs/04 §Player identity) — never join on name alone. */
  external_ids: {
    fantasypros_id?: string;
    cbs_id?: string;
    gsis_id?: string;
  };
}

/** Alg 2 (docs/03) — projection ensemble + weekly Monte Carlo distribution. */
export interface PlayerProjection {
  season_projection_points: number;
  weekly_mean: number;
  weekly_sd: number;
  weekly_p10: number;
  weekly_p25: number;
  weekly_p75: number;
  weekly_p90: number;
  prob_20plus: number;
  prob_25plus: number;
  prob_30plus: number;
  expected_games: number;
  /** ExpectedSeasonPoints * P(miss_material_time) * 0.25; 0 if no calibrated prob. */
  injury_penalty: number;
  risk_adjusted_points: number;
  /** N in the Alg 2 ensemble rule (N=1 FantasyPros-only is expected for V1). */
  projection_source_count: number;
  /** Spread across sources when N>=2; null when N=1 (no invented uncertainty). */
  projection_disagreement: number | null;
  /** ISO timestamp of the underlying source pull, for freshness rollup. */
  source_timestamp: string;
}

/** Alg 4 (docs/03) inputs — ADP + Family Affair history, refined live at runtime. */
export interface PlayerMarket {
  adp_cbs: number | null;
  adp_fantasypros: number | null;
  adp_other: number | null;
  /** Weighted ADP blend + Family Affair position bias, capped [-5,+5] (docs/03). */
  expected_pick: number;
  /** Sigma for survival_prob (docs/03): top_24:5, 25-60:8, 61-100:12, 101+:18. */
  adp_sigma: number;
}

/**
 * A single player row as stored in data/players.json and served by
 * GET /api/players. Precomputed fields (identity, projection, market,
 * fundamental_rank) never change at request time. `is_drafted` /
 * `drafted_by_slot` / `league_market_rank` / `vorp` are draft-state
 * dependent and are recomputed by the TS runtime optimizer (/lib), not
 * stored statically — they are included here as the in-memory shape the
 * optimizer produces after merging players.json with draft:state.
 */
export interface PlayerRecord extends PlayerIdentity {
  projection: PlayerProjection;
  market: PlayerMarket;

  /** FundamentalRank — pure Family Affair value (Alg 1-3). Static per build. */
  fundamental_rank: number;
  /** LeagueMarketRank — Alg 4, recomputed live as the room drafts. */
  league_market_rank: number;
  /** VORP(p) = Value(p) - ReplacementValue(pos); null until computed for a state. */
  vorp: number | null;

  bye_week: number | null;
  /** e.g. "Questionable" | "Out" | "IR"; null = no designation. */
  injury_status: string | null;
  news_age_minutes: number | null;
  data_freshness: DataFreshness;

  is_drafted: boolean;
  drafted_by_slot: number | null;
}

// ---------------------------------------------------------------------------
// Draft state & events (KV: draft:state, draft:log — docs/04, docs/09)
// ---------------------------------------------------------------------------

/** Canonical draft event — every provider (cbs_api/browser/manual) maps to this. */
export interface DraftEvent {
  event_type: "draft_pick" | "undo" | "correction";
  source: "cbs_api" | "browser" | "manual";
  source_event_id: string;
  pick_number: number;
  round: number;
  manager_slot: number;
  player_source_id: string | null;
  /** Resolved Draft Edge player id after identity match; null if unresolved. */
  player_id: string | null;
  player_name: string;
  position: Position;
  nfl_team: string;
  /** ISO timestamp. */
  observed_at: string;
}

/** A reconciled pick as persisted in draft:state.picks (docs/04 §Reconciliation). */
export interface DraftPick {
  pick_number: number;
  round: number;
  manager_slot: number;
  player_id: string;
  player_name: string;
  position: Position;
  nfl_team: string;
  source: "cbs_api" | "browser" | "manual";
  observed_at: string;
}

export interface RosterSlot {
  slot: LineupSlotType;
  /** Assigned via lineup optimization (lib/lineup.ts), not statically. */
  player_id: string | null;
}

export interface TeamRoster {
  manager_slot: number;
  team_name: string;
  starters: RosterSlot[];
  bench_player_ids: string[];
}

export interface DraftState {
  draft_id: string;
  season: number;
  current_pick: number;
  current_round: number;
  on_the_clock_slot: number;
  /** docs/02 draft.user_slot (4) / user_team ("Mama There Goes That Man"). */
  user_slot: number;
  /** Next pick_number at which user_slot is on the clock. */
  user_next_pick: number;
  picks: DraftPick[];
  rosters: TeamRoster[];
  drafted_player_ids: string[];
  status: "not_started" | "in_progress" | "paused" | "complete";
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Provider health (KV: providers:health — docs/01, docs/04)
// ---------------------------------------------------------------------------

export interface ProviderHealth {
  provider: "fantasypros" | "cbs_api" | "browser" | "manual";
  status: "healthy" | "degraded" | "down" | "unknown";
  last_success_at: string | null;
  latency_ms: number | null;
  message?: string;
}

export interface SystemHealth {
  providers: ProviderHealth[];
  players_json_build_time: string;
  model_version: string;
  data_freshness: DataFreshness;
}

// ---------------------------------------------------------------------------
// Recommendation (GET /api/recommendation — docs/06)
// ---------------------------------------------------------------------------

export interface RecommendationAlternative {
  player_id: string;
  name: string;
  position: Position;
  score: number;
  survival_to_next_pick: number;
  /** Distinct reason a DO_NOT_REACH runner-up is surfaced (docs/03/06). */
  do_not_reach_flag?: boolean;
}

export interface Recommendation {
  pick_number: number;
  recommended_player_id: string;
  recommended_player_name: string;
  position: Position;
  decision_confidence: DecisionConfidence;
  score: number;
  survival_to_next_pick: number;
  /** Max 3, template-filled (docs/03 §Reason codes). */
  reasons: ReasonCode[];
  fundamental_rank: number;
  league_market_rank: number;
  /** MODEL DISAGREEMENT — REVIEW badge trigger (docs/03 §DO_NOT_REACH). */
  do_not_reach_flag: boolean;
  data_freshness: DataFreshness;
  alternatives: RecommendationAlternative[];
  /**
   * "Consequence of waiting" (docs/06): the expected best alternative at the
   * user's next pick per the lookahead rollouts, and the score edge over the
   * current runner-up. Null when a lookahead couldn't be computed (fallback
   * ladder engaged — docs/04 §Failure ladder).
   */
  expected_alternative_if_wait: { player_id: string; name: string } | null;
  edge_vs_runner_up: number | null;
}

// ---------------------------------------------------------------------------
// Audit snapshot (KV list draft:audit / audit.jsonl — docs/03 §Audit)
// ---------------------------------------------------------------------------

export interface AuditSnapshot {
  pick: number;
  state_hash: string;
  model_version: string;
  recommended_player: string;
  fundamental_rank: number;
  league_market_rank: number;
  expected_pick: number;
  final_score: number;
  runner_up: string;
  score_gap: number;
  survival_next: number;
  do_not_reach_flag: boolean;
  projection_source_count: number;
  projection_disagreement: number | null;
  data_freshness: DataFreshness;
  roster_gain: number;
  urgency: number;
  market: number;
  upside: number;
  lookahead_value: number;
  rollouts: number;
  seed_bundle: string;
  standardization: {
    method: "median_mad" | "winsorized_mean_sd";
    center: Record<string, number>;
    scale: Record<string, number>;
  };
  stage_weights: {
    roster: number;
    urgency: number;
    market: number;
    upside: number;
    penalty: number;
    uncertainty: number;
  };
  reasons: ReasonCode[];
}
