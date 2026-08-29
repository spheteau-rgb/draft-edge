"""
precompute/build_players.py — STUB

Owner: data-engineer. Ground truth: docs/03_ALGORITHMS.md Alg 1-3,
docs/09_DEPLOYMENT.md.

Pipeline (build-time only, on the Mac — this is the ONLY place
core/scoring.py runs, per CLAUDE.md):
    ingest_fantasypros.fetch_projections()
        -> projection ensemble (docs/03 Alg 2; N-based aggregation rule)
        -> weekly distribution (CV priors from config/model.yaml)
        -> Monte Carlo N=2000, scored by core/scoring.py (Family Affair rules)
        -> per-player: mean/median wk FP, p10/p25/p75/p90, sd, prob_20/25/30+
        -> FundamentalRank (Alg 3: scoring + VORP + roster fit, static)
    -> write ../data/players.json matching types/index.ts `PlayerRecord[]`
    -> write ../data/priors.json (weekly distribution priors used for Monte Carlo)

Never invent data (injury probabilities, FG-distance splits, DST
sub-components) absent from source data — see docs/03 K/DST guardrail notes
and CLAUDE.md.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

CORE_DIR = Path(__file__).resolve().parent.parent / "core"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

sys.path.insert(0, str(CORE_DIR.parent))  # allows `from core.scoring import ...`


def run_monte_carlo(player_projection: dict[str, Any], n: int = 2000) -> dict[str, Any]:
    """N=2000 weekly draws/player, score each with core/scoring.py, aggregate
    to mean/median/p10/p25/p75/p90/sd/prob_20+/25+/30+ (docs/03 Alg 2)."""
    raise NotImplementedError("data-engineer: implement run_monte_carlo")


def compute_fundamental_rank(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Static FundamentalRank per docs/03 Alg 1-3 (pure Family Affair value)."""
    raise NotImplementedError("data-engineer: implement compute_fundamental_rank")


def build_players_json() -> list[dict[str, Any]]:
    """Full pipeline; returns a list matching types/index.ts PlayerRecord[]."""
    raise NotImplementedError("data-engineer: implement build_players_json")


def write_output(players: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DATA_DIR / "players.json"
    with out_path.open("w") as f:
        json.dump(players, f, indent=2)


if __name__ == "__main__":
    raise NotImplementedError("data-engineer: wire CLI entrypoint (build -> write_output)")
