"""
precompute/ingest_fantasypros.py

Owner: data-engineer. Ground truth: docs/04_INTEGRATIONS.md §A, docs/03 Alg 2.

Pull FantasyPros /nfl/players, /nfl/{season}/projections, /nfl/{season}/consensus-rankings,
/nfl/injuries, /nfl/news via `x-api-key: FANTASYPROS_API_KEY` (from .env, never hardcoded,
never logged). Cache locally under precompute/cache/. This runs ONLY at precompute/build
time on the Mac -- never at request time (CLAUDE.md non-negotiable #1).

Builds the player identity crosswalk (docs/04 Player identity):
DraftEdge UUID <-> FantasyPros id <-> CBS id (external_ids=cbs) <-> GSIS (rarely
available from this endpoint; left null rather than fabricated), with a documented
fallback normalized_name + NFL_team + position match for anything the primary
FantasyPros id join can't resolve.

One-shot precompute run: refresh cadence from docs/04 (players daily, rankings 15m,
projections 30m, injuries/news 5m) doesn't matter here -- we fetch once per build
and cache with {source, fetched_at, season, week, version}.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

import requests

FANTASYPROS_BASE = "https://api.fantasypros.com/public/v2/json"
SEASON = 2026
WEEK = 0  # preseason / season-long, per docs/04
INGEST_VERSION = "1.0.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "precompute" / "cache"

DRAFTABLE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"]

# DraftEdge UUID namespace -- fixed so uuid5(NAMESPACE, fantasypros_id) is
# deterministic across builds (CLAUDE.md: deterministic seeds/ids).
DRAFT_EDGE_UUID_NAMESPACE = uuid.UUID("6f6a6e6a-1e1a-4c2e-9a2e-4f1d2c3b4a5e")


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

def get_api_key() -> str:
    """Read FANTASYPROS_API_KEY from the environment (or local .env). Never
    print/log the value."""
    key = os.environ.get("FANTASYPROS_API_KEY")
    if key:
        return key
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == "FANTASYPROS_API_KEY":
                return v.strip().strip('"').strip("'")
    raise RuntimeError(
        "FANTASYPROS_API_KEY not found in environment or .env. "
        "Set it before running the precompute pipeline."
    )


def _headers() -> dict[str, str]:
    return {"x-api-key": get_api_key()}


# ---------------------------------------------------------------------------
# HTTP + cache helpers
# ---------------------------------------------------------------------------

class FantasyProsError(RuntimeError):
    """Raised when a FantasyPros call fails in a way that must not be silently
    swallowed (CLAUDE.md rule 5 / hard gate)."""


def _get(path: str, params: dict[str, Any] | None = None, max_retries: int = 5) -> dict[str, Any]:
    url = f"{FANTASYPROS_BASE}/{path}"
    backoff = 2.0
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(url, params=params or {}, headers=_headers(), timeout=30)
        except requests.RequestException as exc:
            raise FantasyProsError(f"Network error calling {path}: {exc}") from exc
        if resp.status_code == 429 and attempt < max_retries:
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)
            last_exc = FantasyProsError(f"HTTP 429 on {path} (attempt {attempt + 1})")
            continue
        if resp.status_code != 200:
            # Never log/print the API key; body is safe (no secret echoed by FantasyPros).
            raise FantasyProsError(
                f"FantasyPros {path} returned HTTP {resp.status_code}: {resp.text[:500]}"
            )
        try:
            return resp.json()
        except ValueError as exc:
            raise FantasyProsError(f"FantasyPros {path} returned non-JSON body: {exc}") from exc
    raise FantasyProsError(f"FantasyPros {path} still rate-limited after {max_retries} retries: {last_exc}")


def _cache_path(name: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{name}.json"


def _write_cache(name: str, source: str, payload: Any, extra: dict[str, Any] | None = None) -> None:
    envelope = {
        "source": source,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "season": SEASON,
        "week": WEEK,
        "version": INGEST_VERSION,
        **(extra or {}),
        "data": payload,
    }
    _cache_path(name).write_text(json.dumps(envelope, indent=2))


def _read_cache(name: str) -> dict[str, Any] | None:
    p = _cache_path(name)
    if not p.exists():
        return None
    return json.loads(p.read_text())


# ---------------------------------------------------------------------------
# Documented endpoints (docs/04 §A)
# ---------------------------------------------------------------------------

def fetch_players(use_cache: bool = True) -> list[dict[str, Any]]:
    """GET /nfl/players -- base player list + external_ids (incl. CBS).

    NOTE: `ecr=included` (the docs/04 connectivity-gate query) restricts the
    response to ~512 ECR-ranked players and silently drops many players that
    DO appear in /nfl/{season}/projections (backups, deeper depth chart,
    even one DST team in this build). For the identity crosswalk we need
    every projected player resolvable, so this fetches the full unfiltered
    player universe instead (~8500 players incl. non-fantasy positions,
    still fast: <1s). The documented ecr=included call is still used verbatim
    in scripts/diagnose_integrations.py as the connectivity gate."""
    if use_cache:
        cached = _read_cache("players")
        if cached:
            return cached["data"]
    data = _get("nfl/players", {"external_ids": "cbs"})
    players = data.get("players", [])
    _write_cache("players", "fantasypros:/nfl/players", players)
    return players


def fetch_projections(position: str, season: int = SEASON, week: int = WEEK,
                       use_cache: bool = True) -> list[dict[str, Any]]:
    """GET /nfl/{season}/projections?position=X -- raw stat-line projections.
    The endpoint defaults to RB if no position is given, so callers must loop
    over DRAFTABLE_POSITIONS explicitly."""
    cache_name = f"projections_{position}_{season}_{week}"
    if use_cache:
        cached = _read_cache(cache_name)
        if cached:
            return cached["data"]
    data = _get(f"nfl/{season}/projections", {"position": position, "week": str(week)})
    players = data.get("players", [])
    _write_cache(cache_name, f"fantasypros:/nfl/{season}/projections", players,
                 extra={"position": position})
    return players


def fetch_projections_all_positions(season: int = SEASON, week: int = WEEK,
                                     use_cache: bool = True) -> dict[str, list[dict[str, Any]]]:
    out = {}
    for pos in DRAFTABLE_POSITIONS:
        out[pos] = fetch_projections(pos, season, week, use_cache)
        time.sleep(0.4)
    return out


def fetch_dst_weekly_points_allowed(season: int = SEASON, week: int = 1,
                                     use_cache: bool = True) -> dict[str, float]:
    """DST season-total projections (week=0) don't populate points-allowed tiers
    (def_pa_a..g are 0 for all teams as of this build). week=1 projections DO
    carry a direct weekly `def_pa` (expected points allowed) field, which is the
    only real source data available for the points-allowed component -- so we
    pull it separately rather than fabricate a season-long PA split. Returns
    {team_id: weekly_expected_points_allowed}."""
    cache_name = f"dst_weekly_pa_{season}_{week}"
    if use_cache:
        cached = _read_cache(cache_name)
        if cached:
            return cached["data"]
    data = _get(f"nfl/{season}/projections", {"position": "DST", "week": str(week)})
    out: dict[str, float] = {}
    for p in data.get("players", []):
        pa = p.get("stats", {}).get("def_pa")
        if pa is not None:
            out[p["team_id"]] = float(pa)
    _write_cache(cache_name, f"fantasypros:/nfl/{season}/projections(week={week})", out)
    return out


def fetch_rankings(position: str, season: int = SEASON, week: int = WEEK,
                    use_cache: bool = True) -> list[dict[str, Any]]:
    """GET /nfl/{season}/consensus-rankings?position=X -- ECR/ADP quality signal
    plus player_bye_week (not available from /nfl/players)."""
    cache_name = f"consensus_rankings_{position}_{season}_{week}"
    if use_cache:
        cached = _read_cache(cache_name)
        if cached:
            return cached["data"]
    data = _get(f"nfl/{season}/consensus-rankings", {"position": position, "week": str(week)})
    players = data.get("players", [])
    _write_cache(cache_name, f"fantasypros:/nfl/{season}/consensus-rankings", players,
                 extra={"position": position})
    return players


def fetch_rankings_all_positions(season: int = SEASON, week: int = WEEK,
                                  use_cache: bool = True) -> dict[str, list[dict[str, Any]]]:
    """Single overall-ADP call (position=ALL), not per-position.

    consensus-rankings?position=RB returns rank_ecr as the RB-only rank (RB1,
    RB2, ...), not an overall draft-order rank -- that previously got wired
    straight into `expected_pick`, so a kicker with rank_ecr=1 (K1) looked
    like the #1 overall pick. position=ALL returns the same schema with a
    true cross-positional rank_ecr (pos_rank still carries the per-position
    label, e.g. "RB5") -- that's the one downstream market logic needs.
    """
    return {"ALL": fetch_rankings("ALL", season, week, use_cache)}


def fetch_adp(scoring: str = "STD", season: int = SEASON, week: int = WEEK,
               use_cache: bool = True) -> list[dict[str, Any]]:
    """GET /nfl/{season}/consensus-rankings?type=adp -- real average draft
    position, i.e. where players ACTUALLY go.

    Distinct from the default type=ranking (ECR), which is where experts say
    players SHOULD go. The two diverge badly in the middle rounds: ECR had
    Nico Collins at 14 overall when his real ADP is 27. `expected_pick` feeds
    survival, so it needs ADP, not ECR.

    `rank_ecr` here is the ADP rank order; `rank_ave` is the mean draft
    position itself and is what survival wants. The public API tier is thin
    (~2 contributing sources), so treat rank_std from this payload as
    unreliable and keep the configured adp_sigma tiers instead.
    """
    cache_name = f"adp_{scoring}_{season}_{week}"
    if use_cache:
        cached = _read_cache(cache_name)
        if cached:
            return cached["data"]
    data = _get(f"nfl/{season}/consensus-rankings",
                {"position": "ALL", "week": str(week), "type": "adp", "scoring": scoring})
    players = data.get("players", [])
    _write_cache(cache_name, f"fantasypros:/nfl/{season}/consensus-rankings(type=adp)", players,
                 extra={"scoring": scoring, "total_experts": data.get("total_experts")})
    return players


def fetch_injuries(use_cache: bool = True) -> list[dict[str, Any]]:
    """GET /nfl/injuries -- feeds injury_status + data_freshness."""
    if use_cache:
        cached = _read_cache("injuries")
        if cached:
            return cached["data"]
    data = _get("nfl/injuries", {})
    injuries = data.get("injuries", [])
    _write_cache("injuries", "fantasypros:/nfl/injuries", injuries)
    return injuries


def fetch_news(use_cache: bool = True) -> list[dict[str, Any]]:
    """GET /nfl/news -- feeds news_age_minutes."""
    if use_cache:
        cached = _read_cache("news")
        if cached:
            return cached["data"]
    data = _get("nfl/news", {})
    items = data.get("items", [])
    _write_cache("news", "fantasypros:/nfl/news", items)
    return items


# ---------------------------------------------------------------------------
# Identity crosswalk (docs/04 §Player identity -- never join on name alone)
# ---------------------------------------------------------------------------

def _normalize_name(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[.\-']", "", name)
    name = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def build_identity_crosswalk(players: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """DraftEdge UUID <-> fantasypros_id <-> cbs_id <-> gsis_id (docs/04 §Player identity).

    Primary join: FantasyPros' own player_id is stable across /nfl/players,
    /nfl/{season}/projections (as `fpid`), and /nfl/{season}/consensus-rankings
    (as `player_id`) -- verified empirically against this API build. cbs_id
    comes directly from /nfl/players `external_ids=cbs` (field `cbs_id`).
    gsis_id is NOT exposed by any documented FantasyPros endpoint used here,
    so it is left null rather than invented; the fallback normalized-name match
    below is provenance-tagged in case a future GSIS source needs to join on it.

    Every player gets a deterministic DraftEdge UUID = uuid5(NAMESPACE, fpid),
    so re-running the build never reassigns ids (CLAUDE.md: deterministic).
    """
    crosswalk: dict[str, dict[str, Any]] = {}
    for p in players:
        fpid = str(p.get("player_id"))
        if not fpid or fpid == "None":
            continue
        cbs_id = p.get("cbs_id") or None
        draft_edge_id = str(uuid.uuid5(DRAFT_EDGE_UUID_NAMESPACE, fpid))
        crosswalk[fpid] = {
            "player_id": draft_edge_id,
            "fantasypros_id": fpid,
            "cbs_id": str(cbs_id) if cbs_id else None,
            "gsis_id": None,  # not available from documented endpoints; never fabricated
            "match_confidence": 1.0 if cbs_id else 0.6,
            "match_provenance": "fantasypros_players_endpoint" if cbs_id else "fantasypros_id_only_no_cbs_xref",
            "normalized_name": _normalize_name(p.get("player_name", "")),
            "name": p.get("player_name"),
            "position": p.get("position_id"),
            "nfl_team": p.get("team_id"),
        }
    return crosswalk


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def run_ingest(use_cache: bool = True, adp_scoring: str = "STD") -> dict[str, Any]:
    """Fetch everything documented in docs/04 §A once, cache to disk, and build
    the identity crosswalk. Never called at request time."""
    players = fetch_players(use_cache=use_cache)
    projections = fetch_projections_all_positions(use_cache=use_cache)
    dst_weekly_pa = fetch_dst_weekly_points_allowed(use_cache=use_cache)
    rankings = fetch_rankings_all_positions(use_cache=use_cache)
    adp = fetch_adp(scoring=adp_scoring, use_cache=use_cache)
    injuries = fetch_injuries(use_cache=use_cache)
    news = fetch_news(use_cache=use_cache)
    crosswalk = build_identity_crosswalk(players)

    _write_cache("identity_crosswalk", "derived:build_identity_crosswalk", crosswalk)

    with_cbs = sum(1 for v in crosswalk.values() if v["cbs_id"])
    print(f"[ingest_fantasypros] players={len(players)} crosswalk={len(crosswalk)} "
          f"with_cbs_id={with_cbs} projections_positions={list(projections.keys())} "
          f"adp={len(adp)}({adp_scoring}) injuries={len(injuries)} news={len(news)}")

    return {
        "players": players,
        "projections": projections,
        "dst_weekly_pa": dst_weekly_pa,
        "rankings": rankings,
        "adp": adp,
        "injuries": injuries,
        "news": news,
        "crosswalk": crosswalk,
    }


if __name__ == "__main__":
    try:
        run_ingest(use_cache=True)
    except FantasyProsError as exc:
        # Hard gate per CLAUDE.md rule 5: report exactly what happened, no guessing.
        print(f"[ingest_fantasypros] FANTASYPROS INGEST FAILED: {exc}")
        raise
