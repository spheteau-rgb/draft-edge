"""
precompute/ingest_fantasypros.py — STUB

Owner: data-engineer. Ground truth: docs/04_INTEGRATIONS.md §A, docs/03 Alg 2.

Pull FantasyPros /nfl/players, /nfl/{season}/rankings,
/nfl/{season}/consensus-rankings, /nfl/{season}/projections, /nfl/injuries,
/nfl/news via `x-api-key: FANTASYPROS_API_KEY` (from .env, never hardcoded,
never logged). Cache locally (players/ids daily, rankings 15m, projections
30m, injuries/news 5m). This runs ONLY at precompute/build time on the Mac —
never at request time (CLAUDE.md non-negotiable #1).

Build the player identity crosswalk here (docs/04 §Player identity):
DraftEdge UUID <-> FantasyPros id <-> CBS id (external_ids=cbs) <-> GSIS,
with fallback normalized_name + NFL_team + position matching for anything
FantasyPros doesn't resolve directly.
"""

from __future__ import annotations

import os
from typing import Any


FANTASYPROS_BASE = "https://api.fantasypros.com/public/v2/json"


def get_api_key() -> str:
    """Read FANTASYPROS_API_KEY from the environment. Never print/log the value."""
    raise NotImplementedError("data-engineer: implement get_api_key")


def fetch_players() -> list[dict[str, Any]]:
    """GET /nfl/players — base player list + external_ids (incl. CBS)."""
    raise NotImplementedError("data-engineer: implement fetch_players")


def fetch_projections(season: int = 2026, week: int = 0) -> list[dict[str, Any]]:
    """GET /nfl/{season}/projections — raw stat-line projections, week=0 preseason."""
    raise NotImplementedError("data-engineer: implement fetch_projections")


def fetch_rankings(season: int = 2026) -> list[dict[str, Any]]:
    """GET /nfl/{season}/rankings and /consensus-rankings — ECR for quality signal."""
    raise NotImplementedError("data-engineer: implement fetch_rankings")


def fetch_injuries() -> list[dict[str, Any]]:
    """GET /nfl/injuries — feeds data_freshness + injury_penalty."""
    raise NotImplementedError("data-engineer: implement fetch_injuries")


def build_identity_crosswalk(players: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """DraftEdge UUID <-> fantasypros_id <-> cbs_id <-> gsis_id (docs/04 §Player identity)."""
    raise NotImplementedError("data-engineer: implement build_identity_crosswalk")


if __name__ == "__main__":
    raise NotImplementedError("data-engineer: wire CLI entrypoint (cache to disk, no live calls at request time)")
