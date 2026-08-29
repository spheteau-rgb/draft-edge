/**
 * Small fixture player pool (docs/03 shapes) used for local dev + unit tests
 * while data/players.json (data-engineer's precompute output) isn't ready
 * yet. Covers QB/RB/WR/TE/K/DST. Shape matches `PlayerRecord` exactly, so
 * swapping in the real players.json requires zero code changes.
 */

import type { PlayerRecord } from "@/types";

function projection(
  seasonPoints: number,
  games = 17,
  cvOverride?: number
): PlayerRecord["projection"] {
  const weeklyMean = seasonPoints / games;
  const cv = cvOverride ?? 0.4;
  const weeklySd = weeklyMean * cv;
  return {
    season_projection_points: seasonPoints,
    weekly_mean: weeklyMean,
    weekly_sd: weeklySd,
    weekly_p10: Math.max(0, weeklyMean - 1.28 * weeklySd),
    weekly_p25: Math.max(0, weeklyMean - 0.67 * weeklySd),
    weekly_p75: weeklyMean + 0.67 * weeklySd,
    weekly_p90: weeklyMean + 1.28 * weeklySd,
    prob_20plus: weeklyMean > 18 ? 0.4 : 0.1,
    prob_25plus: weeklyMean > 22 ? 0.3 : 0.05,
    prob_30plus: weeklyMean > 26 ? 0.15 : 0.02,
    expected_games: games,
    injury_penalty: 0,
    risk_adjusted_points: seasonPoints,
    projection_source_count: 1,
    projection_disagreement: null,
    source_timestamp: "2026-08-29T00:00:00.000Z",
  };
}

function market(adp: number): PlayerRecord["market"] {
  return {
    adp_cbs: adp,
    adp_fantasypros: adp + 1,
    adp_other: null,
    expected_pick: adp,
    adp_sigma: adp <= 24 ? 5 : adp <= 60 ? 8 : adp <= 100 ? 12 : 18,
  };
}

function player(
  id: string,
  name: string,
  position: PlayerRecord["position"],
  team: string,
  seasonPoints: number,
  adp: number,
  extra?: Partial<PlayerRecord>
): PlayerRecord {
  return {
    player_id: id,
    name,
    position,
    nfl_team: team,
    external_ids: {},
    projection: projection(seasonPoints),
    market: market(adp),
    fundamental_rank: 0,
    league_market_rank: 0,
    vorp: null,
    bye_week: null,
    injury_status: null,
    news_age_minutes: null,
    data_freshness: "GREEN",
    is_drafted: false,
    drafted_by_slot: null,
    ...extra,
  };
}

export const MOCK_PLAYERS: PlayerRecord[] = [
  player("p-mahomes", "Patrick Mahomes", "QB", "KC", 380, 28),
  player("p-allen", "Josh Allen", "QB", "BUF", 400, 18),
  player("p-cmc", "Christian McCaffrey", "RB", "SF", 340, 3),
  player("p-bijan", "Bijan Robinson", "RB", "ATL", 300, 5),
  player("p-walker", "Kenneth Walker", "RB", "SEA", 230, 30),
  player("p-lamb", "CeeDee Lamb", "WR", "DAL", 310, 6),
  player("p-nabers", "Malik Nabers", "WR", "NYG", 260, 9),
  player("p-jefferson", "Justin Jefferson", "WR", "MIN", 320, 4),
  player("p-kelce", "Travis Kelce", "TE", "KC", 220, 20),
  player("p-tucker", "Justin Tucker", "K", "BAL", 140, 160),
  player("p-49ers", "San Francisco 49ers", "DST", "SF", 130, 150),
];
