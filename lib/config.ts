/**
 * Loads config/model.yaml once and caches it in module scope (same pattern
 * as players.json — docs/09: "runtime reads it once and caches in module
 * scope; never refetches per request"). Every heuristic coefficient in /lib
 * must come from here, never be hardcoded inline.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export interface StageWeights {
  roster_gain: number;
  urgency: number;
  market: number;
  upside: number;
  roster_penalty: number;
  uncertainty: number;
  /** Opportunity-cost discount on AdjustedSurvival — subtracted, not added. */
  survival: number;
}

/** Loosely typed mirror of config/model.yaml. Extend as /lib modules need more fields. */
export interface ModelConfig {
  model_version: string;
  stage_weights: { R1_4: StageWeights; R5_9: StageWeights; R10_14: StageWeights };
  candidate_pool: {
    top_by_fundamental_value: number;
    top_by_vorp: number;
    top_by_urgency: number;
    top_by_market_mispricing: number;
    top_by_upside: number;
    shortlist_size: number;
  };
  standardization: { method: string };
  weekly_cv_priors: Record<string, Record<string, number>>;
  projection_ensemble: { n2_weights: Record<string, number>; winsorize_min_sources: number };
  injury_penalty_factor: number;
  starter_demand: Record<string, number>;
  roster_gain_weights: Record<"R1_4" | "R5_9" | "R10_14", { vorp: number; fit: number }>;
  kdst_guardrail: {
    R1_8: { K: number; DST: number };
    R9_11: { K: number; DST: number };
    R12_plus: { K: number; DST: number };
    guardrail_override: { exceptional_vorp_z: number };
  };
  roster_construction: {
    position_caps: Partial<Record<string, number>>;
    earliest_round: Partial<Record<string, number>>;
    early_position_penalty: Partial<
      Record<
        string,
        {
          before_round: number;
          penalty: number;
          /** Lift the penalty if the player's real (history-adjusted) ADP is already this early — market-corroborated elite. */
          override_expected_pick_max?: number;
          /** Fallback lift if ADP is missing/stale: stricter than the generic guardrail override. */
          override_vorp_z?: number;
        }
      >
    >;
    starter_need_boost: number;
    flex_only_boost: number;
    depth_targets: Partial<Record<string, number>>;
    depth_boost: number;
    depth_boost_max_gap: number;
  };
  market: {
    adp_weights: Record<string, number>;
    position_bias_cap: [number, number];
    manager_affinity_shrinkage_k: number;
    run_shock_window: number;
    run_shock_cap: [number, number];
    run_shock_baseline: "empirical" | "starter_demand";
    survival_logit_weights: { manager_pressure: number; run_shock: number; tier_urgency: number };
    adp_sigma_by_tier: Record<string, number>;
  };
  lookahead: {
    final_score_weight: number;
    rollout_budget_primary: number;
    rollout_budget_fallback: number[];
    rollout_budget_floor: string;
    latency_target_ms: number;
    latency_hard_ceiling_ms: number;
    precompute_ahead_picks: number;
    opponent_policy: {
      position_score_weights: {
        market_best_at_pos: number;
        roster_need: number;
        manager_affinity: number;
        run_pressure: number;
      };
      softmax_temperature: number;
      top3_player_probs: [number, number, number];
      roster_demand: {
        starter_requirement: Partial<Record<string, number>>;
        roster_target: Partial<Record<string, number>>;
        depth_need_weight: number;
      };
      kdst_hazard: { enabled: boolean; weight: number };
      autopick: {
        enabled: boolean;
        manager_rate_shrinkage_k: number;
        bucket_share_shrinkage_k: number;
      };
    };
  };
  confidence_thresholds: {
    close_call_max: number;
    low_max: number;
    moderate_max: number;
    high_max: number;
  };
  do_not_reach: { pick_gap_threshold: number; required_reason_codes: string[] };
  data_freshness: { cbs_poll_healthy_seconds: number; cbs_poll_warning_seconds: number };
  /** docs/10 — in-season mode. Not read by any draft-path module. */
  in_season: {
    final_week: number;
    min_ros_gain: { free_window: number; faab_window: number };
    guards: {
      injured_stud_rank: number;
      upside_p90_ratio: number;
      streamer_max_weeks: number;
      streamer_override_ros: number;
      surplus_over_demand: number;
    };
    injury_status: Record<string, { play_prob: number; weeks_out: number }>;
  };
}

let cachedConfig: ModelConfig | null = null;

export function loadModelConfig(): ModelConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.join(process.cwd(), "config", "model.yaml");
  const raw = fs.readFileSync(configPath, "utf8");
  cachedConfig = yaml.load(raw) as ModelConfig;
  return cachedConfig;
}

/** Map a round number (1-14, docs/02 draft.rounds) to a stage key used across /lib. */
export function stageForRound(round: number): "R1_4" | "R5_9" | "R10_14" {
  if (round <= 4) return "R1_4";
  if (round <= 9) return "R5_9";
  return "R10_14";
}
