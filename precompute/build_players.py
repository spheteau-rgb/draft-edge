"""
precompute/build_players.py

Owner: data-engineer. Ground truth: docs/03_ALGORITHMS.md Alg 1-3,
docs/04_INTEGRATIONS.md, docs/09_DEPLOYMENT.md.

Pipeline (build-time only, on the Mac -- this is the ONLY place
core/scoring.py runs, per CLAUDE.md):
    ingest_fantasypros.run_ingest()
        -> projection ensemble (docs/03 Alg 2; N=1 for V1, FantasyPros only)
        -> weekly distribution (CV priors from config/model.yaml)
        -> Monte Carlo N=2000, scored by core/scoring.py (Family Affair rules)
        -> per-player: mean/median wk FP, p10/p25/p75/p90, sd, prob_20/25/30+
        -> FundamentalRank (static per build; positional value-over-replacement)
    -> write ../data/players.json matching types/index.ts `PlayerRecord[]`
    -> write ../data/priors.json (docs/05 -- LeaguePositionBias + ManagerAffinity)

Never invent data (injury probabilities, FG-distance splits, DST
sub-components) absent from source data -- see docs/03 K/DST guardrail notes
and CLAUDE.md. Deterministic seeds throughout (CLAUDE.md).
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import yaml

CORE_DIR = Path(__file__).resolve().parent.parent / "core"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
REPO_ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(CORE_DIR.parent))  # allows `from core.scoring import ...`

from core.scoring import StatLine, score_line  # noqa: E402
from precompute import ingest_fantasypros as fp  # noqa: E402

MODEL_VERSION = "1.0.0"
GAMES_PER_SEASON = 17  # 2026 NFL regular season; expected_games baseline (no injury data invented)
MC_N = 2000

# Deterministic seed namespace so re-running the build reproduces identical
# Monte Carlo draws for a given player (CLAUDE.md: deterministic seeds).
SEED_NAMESPACE = uuid.UUID("2a3b4c5d-6e7f-4001-8002-9a0b1c2d3e4f")


def _seed_for(fpid: str) -> int:
    return int.from_bytes(
        uuid.uuid5(SEED_NAMESPACE, fpid).bytes[:8], "big", signed=False
    ) % (2**32 - 1)


def load_model_config() -> dict[str, Any]:
    with (CONFIG_DIR / "model.yaml").open() as f:
        return yaml.safe_load(f)


# Default CVs for stats the docs/03 CV-prior table doesn't cover (interceptions,
# fumbles, K attempts/makes, DST discrete events). Documented, conservative,
# not tuned per-player -- flagged here rather than silently hardcoded inline.
DEFAULT_CV = {
    "pass_int": 0.45,
    "fumbles": 0.80,
    "k_fga": 0.35,
    "k_fg": 0.35,
    "k_xpt": 0.30,
    "dst_sack": 0.45,
    "dst_int": 0.65,
    "dst_td": 1.60,
    "dst_ff": 0.55,
    "dst_fr": 0.70,
    "dst_safety": 2.00,
}
DST_PA_ADDITIVE_SD = 10.0  # points; weekly points-allowed is additive-noise, not multiplicative


def _gamma_draws(rng: np.random.Generator, mean: float, cv: float, n: int) -> np.ndarray:
    """Gamma(mean, cv) draws per docs/03 Alg 2 ('approximate each positive stat
    with Gamma/lognormal'). Degenerates to all-zero when mean<=0."""
    mean = max(float(mean), 0.0)
    if mean <= 1e-9 or cv <= 0:
        return np.zeros(n)
    k = 1.0 / (cv * cv)
    scale = mean / k
    return rng.gamma(shape=k, scale=scale, size=n)


# ---------------------------------------------------------------------------
# Per-position weekly stat-line builders (raw FantasyPros season stats -> N draws)
# ---------------------------------------------------------------------------

def _weekly_draws_qb(rng, stats: dict, cv: dict, n: int) -> list[StatLine]:
    g = GAMES_PER_SEASON
    pass_yards = _gamma_draws(rng, stats.get("pass_yds", 0) / g, cv["QB"]["pass_yards"], n)
    pass_td = _gamma_draws(rng, stats.get("pass_tds", 0) / g, cv["QB"]["pass_td"], n)
    pass_int = _gamma_draws(rng, stats.get("pass_ints", 0) / g, DEFAULT_CV["pass_int"], n)
    rush_yards = _gamma_draws(rng, stats.get("rush_yds", 0) / g, cv["QB"]["rush_yards"], n)
    rush_td = _gamma_draws(rng, stats.get("rush_tds", 0) / g, cv["QB"]["rush_td"], n)
    fumbles = _gamma_draws(rng, stats.get("fumbles", 0) / g, DEFAULT_CV["fumbles"], n)
    two_pt = _gamma_draws(rng, stats.get("2pt_tds", 0) / g, 1.0, n)
    lines = []
    for i in range(n):
        lines.append(StatLine(
            pass_yards=float(pass_yards[i]), pass_td=int(round(pass_td[i])),
            interceptions=int(round(pass_int[i])), pass_2pt=int(round(two_pt[i])),
            rush_yards=float(rush_yards[i]), rush_td=int(round(rush_td[i])),
            fumbles_lost=int(round(fumbles[i])),
        ))
    return lines


def _weekly_draws_skill(rng, stats: dict, pos: str, cv: dict, n: int) -> list[StatLine]:
    """RB/WR/TE: rushing (RB/WR) + receiving, shared total_td split by season
    rush/rec TD share (score-neutral: rush_td and rec_td both = 6 pts, no
    length-band bonus applied since we don't have TD-length splits, so the
    split doesn't affect total score -- see report)."""
    g = GAMES_PER_SEASON
    pos_cv = cv[pos]
    rush_yds_season = stats.get("rush_yds", 0) or 0
    rec_yds_season = stats.get("rec_yds", 0) or 0
    rush_tds_season = stats.get("rush_tds", 0) or 0
    rec_tds_season = stats.get("rec_tds", 0) or 0
    total_tds_season = rush_tds_season + rec_tds_season
    rush_share = (rush_tds_season / total_tds_season) if total_tds_season > 1e-9 else 0.0

    rush_cv = cv["RB"]["rush_yards"]  # reuse RB's rushing CV for any position's rush volume
    rush_yards = _gamma_draws(rng, rush_yds_season / g, rush_cv, n) if rush_yds_season else np.zeros(n)
    receptions = _gamma_draws(rng, stats.get("rec_rec", 0) / g, pos_cv["receptions"], n)
    rec_yards = _gamma_draws(rng, rec_yds_season / g, pos_cv["rec_yards"], n)
    total_td = _gamma_draws(rng, total_tds_season / g, pos_cv["total_td"], n)
    fumbles = _gamma_draws(rng, stats.get("fumbles", 0) / g, DEFAULT_CV["fumbles"], n)

    lines = []
    for i in range(n):
        td_i = int(round(total_td[i]))
        rush_td_i = int(round(td_i * rush_share))
        rec_td_i = td_i - rush_td_i
        lines.append(StatLine(
            rush_yards=float(rush_yards[i]), rush_td=rush_td_i,
            receptions=int(round(receptions[i])), rec_yards=float(rec_yards[i]),
            rec_td=rec_td_i, fumbles_lost=int(round(fumbles[i])),
        ))
    return lines


def _weekly_draws_k(rng, stats: dict, n: int) -> list[StatLine]:
    """No FG-distance splits in the source data (fga/fg/xpt only) -- per
    docs/03 'never fabricate FG-distance', we score every made FG at
    distance=0 so score_kicker() adds fg_base=3 and no length bonus. This
    reuses core/scoring.py's real function rather than reimplementing it,
    and is an honest 'unknown distance, no bonus assumed' choice, not an
    invented distance."""
    g = GAMES_PER_SEASON
    fg = _gamma_draws(rng, stats.get("fg", 0) / g, DEFAULT_CV["k_fg"], n)
    xpt = _gamma_draws(rng, stats.get("xpt", 0) / g, DEFAULT_CV["k_xpt"], n)
    lines = []
    for i in range(n):
        makes = int(round(fg[i]))
        lines.append(StatLine(fg_distances=[0.0] * makes, extra_points=int(round(xpt[i]))))
    return lines


def _weekly_draws_dst(rng, stats: dict, weekly_pa_mean: float | None, n: int) -> list[StatLine]:
    g = GAMES_PER_SEASON
    sack = _gamma_draws(rng, stats.get("def_sack", 0) / g, DEFAULT_CV["dst_sack"], n)
    intc = _gamma_draws(rng, stats.get("def_int", 0) / g, DEFAULT_CV["dst_int"], n)
    td = _gamma_draws(rng, stats.get("def_td", 0) / g, DEFAULT_CV["dst_td"], n)
    ff = _gamma_draws(rng, stats.get("def_ff", 0) / g, DEFAULT_CV["dst_ff"], n)
    fr = _gamma_draws(rng, stats.get("def_fr", 0) / g, DEFAULT_CV["dst_fr"], n)
    safety = _gamma_draws(rng, stats.get("def_safety", 0) / g, DEFAULT_CV["dst_safety"], n)
    if weekly_pa_mean is not None:
        pa = rng.normal(loc=weekly_pa_mean, scale=DST_PA_ADDITIVE_SD, size=n)
        pa = np.clip(pa, 0, 60)
    else:
        pa = None  # no source data -- omit the points-allowed component entirely, don't invent it

    lines = []
    for i in range(n):
        lines.append(StatLine(
            dst_sacks=int(round(sack[i])), dst_int=int(round(intc[i])), dst_td=int(round(td[i])),
            dst_forced_fumble=int(round(ff[i])), dst_fumble_rec=int(round(fr[i])),
            dst_safety=int(round(safety[i])),
            dst_points_allowed=int(round(pa[i])) if pa is not None else None,
        ))
    return lines


# ---------------------------------------------------------------------------
# Monte Carlo
# ---------------------------------------------------------------------------

def run_monte_carlo(lines: list[StatLine], n: int = MC_N) -> dict[str, Any]:
    """Score EACH of the N weekly draws with core/scoring.py and aggregate
    (docs/03 Alg 2). Never scores an averaged stat line."""
    fp_scores = np.array([score_line(s) for s in lines], dtype=float)
    mean = float(np.mean(fp_scores))
    median = float(np.median(fp_scores))
    sd = float(np.std(fp_scores, ddof=1)) if len(fp_scores) > 1 else 0.0
    p10, p25, p75, p90 = (float(x) for x in np.percentile(fp_scores, [10, 25, 75, 90]))
    prob_20 = float(np.mean(fp_scores >= 20))
    prob_25 = float(np.mean(fp_scores >= 25))
    prob_30 = float(np.mean(fp_scores >= 30))
    return {
        "weekly_mean": round(mean, 3), "weekly_median": round(median, 3), "weekly_sd": round(sd, 3),
        "weekly_p10": round(p10, 3), "weekly_p25": round(p25, 3),
        "weekly_p75": round(p75, 3), "weekly_p90": round(p90, 3),
        "prob_20plus": round(prob_20, 4), "prob_25plus": round(prob_25, 4), "prob_30plus": round(prob_30, 4),
    }


# ---------------------------------------------------------------------------
# Static FundamentalRank (Alg 1-3, positional value-over-replacement)
# ---------------------------------------------------------------------------

def compute_fundamental_rank(players: list[dict[str, Any]], model_cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Static FundamentalRank per docs/03 Alg 1-3: pure Family Affair value,
    positional VORP against config/model.yaml starter_demand. This is a
    SIMPLIFIED, non-flex-aware static baseline computed once (assuming no
    picks made yet) so every player has an initial rank in players.json.
    The live, flex-aware, roster-state-dependent VORP/RosterGain (Alg 3's
    full assignment-optimization version) is computed at request time by the
    TS runtime (lib/vorp.ts) against the same players.json -- this function
    does not attempt to duplicate that; see the report for this scope note."""
    demand = model_cfg["starter_demand"]
    by_pos: dict[str, list[dict[str, Any]]] = {}
    for p in players:
        by_pos.setdefault(p["position"], []).append(p)

    replacement_value: dict[str, float] = {}
    for pos, plist in by_pos.items():
        plist.sort(key=lambda p: p["projection"]["risk_adjusted_points"], reverse=True)
        pos_demand = demand.get(pos, demand.get("RWT", 12) if pos in ("RB", "WR", "TE") else 12)
        idx = min(pos_demand, len(plist) - 1) if plist else 0
        replacement_value[pos] = plist[idx]["projection"]["risk_adjusted_points"] if plist else 0.0

    for p in players:
        p["_static_vorp"] = p["projection"]["risk_adjusted_points"] - replacement_value.get(p["position"], 0.0)

    ranked = sorted(players, key=lambda p: p["_static_vorp"], reverse=True)
    for i, p in enumerate(ranked, start=1):
        p["fundamental_rank"] = i
        del p["_static_vorp"]
    return ranked


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def _injury_status_map(injuries: list[dict[str, Any]]) -> dict[str, str]:
    return {str(i["player_id"]): i.get("status") for i in injuries if i.get("status")}


def _news_age_map(news: list[dict[str, Any]], fetched_at_iso: str) -> dict[str, float]:
    fetched_at = time.strptime(fetched_at_iso, "%Y-%m-%dT%H:%M:%SZ")
    fetched_epoch = time.mktime(fetched_at)
    out: dict[str, float] = {}
    for item in news:
        pid = item.get("player_id")
        created = item.get("created")
        if not pid or not created:
            continue
        try:
            created_epoch = time.mktime(time.strptime(created, "%Y-%m-%d %H:%M:%S"))
        except ValueError:
            continue
        age_min = max(0.0, (fetched_epoch - created_epoch) / 60.0)
        key = str(pid)
        if key not in out or age_min < out[key]:
            out[key] = age_min
    return out


def build_players_json(use_cache: bool = True) -> list[dict[str, Any]]:
    """Full pipeline; returns a list matching types/index.ts PlayerRecord[]."""
    model_cfg = load_model_config()
    cv = model_cfg["weekly_cv_priors"]

    ingested = fp.run_ingest(use_cache=use_cache)
    crosswalk = ingested["crosswalk"]
    projections = ingested["projections"]  # {pos: [player,...]}
    dst_weekly_pa = ingested["dst_weekly_pa"]  # {team_id: weekly_pa}
    rankings = ingested["rankings"]  # {pos: [player,...]}
    injuries = ingested["injuries"]
    news = ingested["news"]

    injury_status = _injury_status_map(injuries)
    players_cache = fp._read_cache("players")
    fetched_at_iso = players_cache["fetched_at"] if players_cache else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    news_age = _news_age_map(news, fetched_at_iso)

    # rankings: fpid -> {bye_week, adp, adp_ppr, ecr, tier}
    ranking_by_fpid: dict[str, dict[str, Any]] = {}
    for pos, plist in rankings.items():
        for p in plist:
            fpid = str(p.get("player_id"))
            ranking_by_fpid[fpid] = {
                "bye_week": p.get("player_bye_week"),
                "cbs_id": p.get("cbs_player_id"),
                "rank_ecr": p.get("rank_ecr"),
                "rank_std": p.get("rank_std"),
            }

    out_players: list[dict[str, Any]] = []
    skipped_no_crosswalk = 0

    for pos, plist in projections.items():
        for proj in plist:
            fpid = str(proj.get("fpid"))
            identity = crosswalk.get(fpid)
            if identity is None:
                skipped_no_crosswalk += 1
                continue
            stats = proj.get("stats", {})
            rng = np.random.default_rng(_seed_for(fpid))

            if pos == "QB":
                lines = _weekly_draws_qb(rng, stats, cv, MC_N)
            elif pos in ("RB", "WR", "TE"):
                lines = _weekly_draws_skill(rng, stats, pos, cv, MC_N)
            elif pos == "K":
                lines = _weekly_draws_k(rng, stats, MC_N)
            elif pos == "DST":
                weekly_pa = dst_weekly_pa.get(proj.get("team_id"))
                lines = _weekly_draws_dst(rng, stats, weekly_pa, MC_N)
            else:
                continue

            mc = run_monte_carlo(lines, MC_N)
            season_projection_points = float(stats.get("points", 0.0))
            expected_games = float(GAMES_PER_SEASON)
            expected_season_points = mc["weekly_mean"] * expected_games
            # No calibrated P(miss_material_time) available from documented
            # FantasyPros endpoints -> omit injury_penalty entirely (docs/03).
            injury_penalty = 0.0
            risk_adjusted_points = expected_season_points - injury_penalty

            rank_info = ranking_by_fpid.get(fpid, {})
            bye_week_raw = rank_info.get("bye_week")
            try:
                bye_week = int(bye_week_raw) if bye_week_raw not in (None, "", "0") else None
            except (TypeError, ValueError):
                bye_week = None

            adp_fp = rank_info.get("rank_ecr")
            adp_sigma = 18.0
            sigma_tiers = model_cfg["market"]["adp_sigma_by_tier"]
            if adp_fp is not None:
                if adp_fp <= 24:
                    adp_sigma = sigma_tiers["top_24"]
                elif adp_fp <= 60:
                    adp_sigma = sigma_tiers["picks_25_60"]
                elif adp_fp <= 100:
                    adp_sigma = sigma_tiers["picks_61_100"]
                else:
                    adp_sigma = sigma_tiers["picks_101_plus"]

            record = {
                "player_id": identity["player_id"],
                "name": identity["name"],
                "position": pos,
                "nfl_team": identity["nfl_team"],
                "external_ids": {
                    "fantasypros_id": identity["fantasypros_id"],
                    "cbs_id": identity["cbs_id"] or rank_info.get("cbs_id"),
                    "gsis_id": identity["gsis_id"],
                },
                "projection": {
                    "season_projection_points": round(season_projection_points, 2),
                    "weekly_mean": mc["weekly_mean"],
                    "weekly_median": mc["weekly_median"],  # docs/03 Alg 2 ('mean/median wk FP'); additive vs types/index.ts
                    "weekly_sd": mc["weekly_sd"],
                    "weekly_p10": mc["weekly_p10"],
                    "weekly_p25": mc["weekly_p25"],
                    "weekly_p75": mc["weekly_p75"],
                    "weekly_p90": mc["weekly_p90"],
                    "prob_20plus": mc["prob_20plus"],
                    "prob_25plus": mc["prob_25plus"],
                    "prob_30plus": mc["prob_30plus"],
                    "expected_games": expected_games,
                    "injury_penalty": injury_penalty,
                    "risk_adjusted_points": round(risk_adjusted_points, 2),
                    "projection_source_count": 1,  # FantasyPros only, V1 (locked decision)
                    "projection_disagreement": None,
                    "source_timestamp": fetched_at_iso,
                },
                "market": {
                    "adp_cbs": None,  # no CBS ADP source wired for V1; TS layer supplies live ADP if available
                    "adp_fantasypros": adp_fp,
                    "adp_other": None,
                    "expected_pick": float(adp_fp) if adp_fp is not None else 999.0,
                    "adp_sigma": float(adp_sigma),
                },
                "fundamental_rank": 0,  # filled by compute_fundamental_rank
                "league_market_rank": 0,  # recomputed live by TS runtime; static placeholder = ECR order
                "vorp": None,  # draft-state dependent; computed live by TS runtime
                "bye_week": bye_week,
                "injury_status": injury_status.get(fpid),
                "news_age_minutes": round(news_age[fpid], 1) if fpid in news_age else None,
                "data_freshness": "GREEN",  # accurate at build time; runtime recomputes as data ages
                "is_drafted": False,
                "drafted_by_slot": None,
            }
            out_players.append(record)

    out_players = compute_fundamental_rank(out_players, model_cfg)

    # league_market_rank placeholder: order by FantasyPros ECR (adp_fantasypros)
    # when present, else push to the back. Alg 4 (live) supersedes this at runtime.
    by_ecr = sorted(out_players, key=lambda p: (p["market"]["adp_fantasypros"] is None,
                                                 p["market"]["adp_fantasypros"] or 9999))
    for i, p in enumerate(by_ecr, start=1):
        p["league_market_rank"] = i

    if skipped_no_crosswalk:
        print(f"[build_players] WARNING: {skipped_no_crosswalk} projected players had no identity-crosswalk match")

    return out_players


def write_output(players: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DATA_DIR / "players.json"
    with out_path.open("w") as f:
        json.dump(players, f, indent=2)
    print(f"[build_players] wrote {out_path} ({len(players)} players)")


# ---------------------------------------------------------------------------
# priors.json (docs/05) -- LeaguePositionBias + ManagerAffinity, recency-weighted
# ---------------------------------------------------------------------------

# Kept identical to lib/priors.ts OUTSIDE_MARKET_ROUND1_SHARE so the two
# independent computations (this offline artifact + the TS runtime's live
# read of family_affair_history.json) don't silently drift.
OUTSIDE_MARKET_ROUND1_SHARE = {"RB": 0.45, "WR": 0.42, "QB": 0.08, "TE": 0.05, "K": 0.0, "DST": 0.0}
POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"]
BIAS_CAP = 5.0
AFFINITY_K = 8


def _normalize_team_name(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def build_priors_json() -> dict[str, Any]:
    history_path = DATA_DIR / "family_affair_history.json"
    history = json.loads(history_path.read_text())

    recency_weights = history["recency_weights"]
    position_share_round1 = history["position_share_round1"]
    drafts = history["drafts"]
    draft_order_2026 = history["draft_order_2026"]

    # Recency-weighted room Round-1 position share.
    totals: dict[str, float] = {}
    weight_sum = 0.0
    for year, shares in position_share_round1.items():
        clean_year = year.replace("_visible", "")
        weight = recency_weights.get(clean_year, recency_weights.get(year, 0.0))
        if weight <= 0:
            continue
        weight_sum += weight
        for pos, share in shares.items():
            totals[pos] = totals.get(pos, 0.0) + weight * share
    room_share = {pos: (totals.get(pos, 0.0) / weight_sum if weight_sum > 0 else 0.0) for pos in POSITIONS}

    # LeaguePositionBias: convert (room_share - outside_market_share) into a
    # pick-adjustment, capped [-5, +5] (docs/05). Scale factor chosen so a
    # full 20-point share gap maps to roughly the cap; deliberately modest.
    league_position_bias: dict[str, float] = {}
    for pos in POSITIONS:
        gap = room_share.get(pos, 0.0) - OUTSIDE_MARKET_ROUND1_SHARE.get(pos, 0.0)
        adj = max(-BIAS_CAP, min(BIAS_CAP, gap * 25.0))
        league_position_bias[pos] = round(adj, 2)

    # Manager identity resolution: normalize team-name variants to one key,
    # map to draft_order_2026 slots. "The Dan Clan", "Milwaukee Champions",
    # and the unresolved 2025 pick-12 (null team) never appear in the 2026
    # order -- flagged as unresolved rather than guessed (docs/05 rule).
    TEAM_NAME_ALIASES = {"d.omination": "domination"}
    slot_by_team_key: dict[str, int] = {}
    manager_by_slot: dict[int, str | None] = {}
    for entry in draft_order_2026:
        if not entry.get("team"):
            continue
        key = _normalize_team_name(entry["team"])
        slot_by_team_key[key] = entry["slot"]
        manager_by_slot[entry["slot"]] = entry.get("manager")

    unresolved_teams: set[str] = set()
    manager_counts: dict[int, dict[str, int]] = {e["slot"]: {p: 0 for p in POSITIONS} for e in draft_order_2026}
    manager_totals: dict[int, int] = {e["slot"]: 0 for e in draft_order_2026}

    for year, picks in drafts.items():
        for pick in picks:
            team = pick.get("team")
            pos = pick.get("pos")
            if not team or pos not in POSITIONS:
                if not team:
                    unresolved_teams.add(f"{year}:pick{pick.get('pick')}:UNKNOWN_TEAM")
                continue
            raw_key = _normalize_team_name(team)
            key = TEAM_NAME_ALIASES.get(raw_key, raw_key)
            slot = slot_by_team_key.get(key)
            if slot is None:
                unresolved_teams.add(team)
                continue
            manager_counts[slot][pos] += 1
            manager_totals[slot] += 1

    # Beta-shrunk manager affinity: (count + k*league_rate) / (total + k).
    manager_affinity: dict[str, Any] = {}
    for entry in draft_order_2026:
        slot = entry["slot"]
        total = manager_totals.get(slot, 0)
        counts = manager_counts.get(slot, {p: 0 for p in POSITIONS})
        smoothed = {}
        for pos in POSITIONS:
            league_rate = room_share.get(pos, 0.0)
            smoothed[pos] = round((counts[pos] + AFFINITY_K * league_rate) / (total + AFFINITY_K), 4)
        manager_affinity[str(slot)] = {
            "team": entry.get("team"),
            "manager": entry.get("manager"),
            "sample_size": total,
            "raw_counts": counts,
            "smoothed_position_share": smoothed,
        }

    return {
        "source": "derived:build_priors_json",
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "season": 2026,
        "version": MODEL_VERSION,
        "recency_weighted_room_round1_share": {k: round(v, 4) for k, v in room_share.items()},
        "outside_market_round1_share_baseline": OUTSIDE_MARKET_ROUND1_SHARE,
        "league_position_bias": league_position_bias,
        "league_position_bias_cap": [-BIAS_CAP, BIAS_CAP],
        "manager_affinity": manager_affinity,
        "manager_affinity_shrinkage_k": AFFINITY_K,
        "unresolved_teams": sorted(unresolved_teams),
        "notes": (
            "Round-1 history only (docs/05). unresolved_teams (e.g. 'The Dan "
            "Clan', 'Milwaukee Champions', and the obscured 2025 pick-12) do "
            "not map to a 2026 draft_order slot and are excluded from "
            "manager_affinity rather than guessed, per docs/05 identity rule."
        ),
    }


def write_priors_output(priors: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DATA_DIR / "priors.json"
    with out_path.open("w") as f:
        json.dump(priors, f, indent=2)
    print(f"[build_players] wrote {out_path}")


if __name__ == "__main__":
    t0 = time.time()
    players = build_players_json(use_cache=True)
    write_output(players)
    priors = build_priors_json()
    write_priors_output(priors)
    print(f"[build_players] done in {time.time() - t0:.1f}s")
