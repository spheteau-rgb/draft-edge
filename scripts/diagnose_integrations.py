"""
scripts/diagnose_integrations.py — Integration Health Check

Owner: integration-doctor. Ground truth: docs/04_INTEGRATIONS.md & archive/17.
§Diagnostic tool. Must exist, never prints secrets.

Expected output format:
    FantasyPros auth / players / CBS IDs / rankings / projections / injuries : PASS
    CBS league / auth / teams / rosters / draft order / draft results / latency : PASS|FAIL|UNKNOWN
    Browser companion : READY|NOT BUILT   Manual : PASS   OVERALL : READY|DEGRADED|BLOCKED
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)


@dataclass
class DiagnosticResult:
    name: str
    status: str
    error: Optional[str] = None
    latency_ms: Optional[float] = None

    def __str__(self) -> str:
        result = f"{self.name}{'.' * (40 - len(self.name))}{self.status}"
        if self.latency_ms is not None:
            result += f" ({self.latency_ms:.1f}ms)"
        return result


def load_env() -> dict[str, str]:
    """Load .env file. Never return secrets."""
    env = {}
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    key, _, value = line.partition("=")
                    if key:
                        env[key] = value
    return env


def check_fantasypros() -> list[DiagnosticResult]:
    """Test FantasyPros connectivity (docs/04 §A, archive/17 §3).

    Success criteria:
    - HTTP 200
    - sport = NFL
    - players array exists
    - FantasyPros IDs present
    - CBS external IDs present where available
    """
    env = load_env()
    api_key = env.get("FANTASYPROS_API_KEY", "").strip()
    results = []

    if not api_key:
        return [
            DiagnosticResult("FantasyPros API auth", "FAIL", "FANTASYPROS_API_KEY not set in .env"),
            DiagnosticResult("FantasyPros players", "SKIP"),
            DiagnosticResult("FantasyPros CBS IDs", "SKIP"),
            DiagnosticResult("FantasyPros rankings", "SKIP"),
            DiagnosticResult("FantasyPros projections", "SKIP"),
            DiagnosticResult("FantasyPros injuries", "SKIP"),
        ]

    base_url = "https://api.fantasypros.com/public/v2/json"
    headers = {"x-api-key": api_key}

    # Gate 1: Auth + players endpoint
    try:
        start = time.time()
        resp = requests.get(
            f"{base_url}/nfl/players?ecr=included&show=pos_rank&external_ids=cbs",
            headers=headers,
            timeout=10,
        )
        latency = (time.time() - start) * 1000

        if resp.status_code == 401:
            results.append(DiagnosticResult("FantasyPros API auth", "FAIL", "Invalid API key (401)"))
            results.extend([
                DiagnosticResult("FantasyPros players", "SKIP"),
                DiagnosticResult("FantasyPros CBS IDs", "SKIP"),
                DiagnosticResult("FantasyPros rankings", "SKIP"),
                DiagnosticResult("FantasyPros projections", "SKIP"),
                DiagnosticResult("FantasyPros injuries", "SKIP"),
            ])
            return results

        if resp.status_code != 200:
            results.append(DiagnosticResult(
                "FantasyPros API auth", "FAIL", f"HTTP {resp.status_code}"
            ))
            results.extend([
                DiagnosticResult("FantasyPros players", "SKIP"),
                DiagnosticResult("FantasyPros CBS IDs", "SKIP"),
                DiagnosticResult("FantasyPros rankings", "SKIP"),
                DiagnosticResult("FantasyPros projections", "SKIP"),
                DiagnosticResult("FantasyPros injuries", "SKIP"),
            ])
            return results

        data = resp.json()
        has_players = isinstance(data.get("players"), list) and len(data["players"]) > 0
        has_cbs_ids = has_players and any(
            p.get("external_ids", {}).get("cbs") for p in data.get("players", [])[:10]
        )

        results.append(DiagnosticResult("FantasyPros API auth", "PASS", latency_ms=latency))
        results.append(DiagnosticResult(
            "FantasyPros players", "PASS" if has_players else "FAIL",
            latency_ms=latency
        ))
        results.append(DiagnosticResult(
            "FantasyPros CBS IDs", "PASS" if has_cbs_ids else "WARN",
            error="CBS external IDs not in first 10 players" if not has_cbs_ids else None,
            latency_ms=latency
        ))
    except requests.Timeout:
        results.append(DiagnosticResult("FantasyPros API auth", "FAIL", "Timeout (10s)"))
        results.extend([
            DiagnosticResult("FantasyPros players", "SKIP"),
            DiagnosticResult("FantasyPros CBS IDs", "SKIP"),
            DiagnosticResult("FantasyPros rankings", "SKIP"),
            DiagnosticResult("FantasyPros projections", "SKIP"),
            DiagnosticResult("FantasyPros injuries", "SKIP"),
        ])
        return results
    except Exception as e:
        results.append(DiagnosticResult("FantasyPros API auth", "FAIL", str(e)[:50]))
        results.extend([
            DiagnosticResult("FantasyPros players", "SKIP"),
            DiagnosticResult("FantasyPros CBS IDs", "SKIP"),
            DiagnosticResult("FantasyPros rankings", "SKIP"),
            DiagnosticResult("FantasyPros projections", "SKIP"),
            DiagnosticResult("FantasyPros injuries", "SKIP"),
        ])
        return results

    # Gate 2–5: Rankings, Projections, Injuries (all optional for this check)
    for endpoint, label in [
        ("/nfl/2026/rankings", "FantasyPros rankings"),
        ("/nfl/2026/projections", "FantasyPros projections"),
        ("/nfl/injuries", "FantasyPros injuries"),
    ]:
        try:
            start = time.time()
            resp = requests.get(f"{base_url}{endpoint}", headers=headers, timeout=10)
            latency = (time.time() - start) * 1000
            status = "PASS" if resp.status_code == 200 else f"HTTP {resp.status_code}"
            results.append(DiagnosticResult(label, status, latency_ms=latency))
        except requests.Timeout:
            results.append(DiagnosticResult(label, "FAIL", "Timeout"))
        except Exception as e:
            results.append(DiagnosticResult(label, "FAIL", str(e)[:50]))

    return results


def check_cbs() -> list[DiagnosticResult]:
    """Test CBS connectivity (docs/04 §B, archive/17 §11).

    Gate order: host -> auth -> league resources -> draft results -> live behavior.
    Read-only, never automate picks.
    """
    env = load_env()
    league_id = env.get("CBS_LEAGUE_ID", "").strip()
    access_token = env.get("CBS_ACCESS_TOKEN", "").strip()
    results = []

    if not league_id or not access_token:
        results.append(DiagnosticResult(
            "CBS league",
            "UNSET",
            error="CBS_LEAGUE_ID or CBS_ACCESS_TOKEN not set"
        ))
        results.extend([
            DiagnosticResult("CBS authentication", "SKIP"),
            DiagnosticResult("CBS teams", "SKIP"),
            DiagnosticResult("CBS rosters", "SKIP"),
            DiagnosticResult("CBS draft order", "SKIP"),
            DiagnosticResult("CBS draft results", "SKIP"),
        ])
        return results

    base_url = "https://api.cbssports.com/fantasy"
    params = {"version": "3.0", "response_format": "JSON", "access_token": access_token}

    results.append(DiagnosticResult("CBS league", "SET"))

    # Gate 1: Test host/auth
    try:
        start = time.time()
        resp = requests.get(
            f"{base_url}/league/teams",
            params=params,
            timeout=10,
        )
        latency = (time.time() - start) * 1000

        if resp.status_code == 401:
            results.append(DiagnosticResult("CBS authentication", "FAIL", "Invalid token (401)"))
            results.extend([
                DiagnosticResult("CBS teams", "SKIP"),
                DiagnosticResult("CBS rosters", "SKIP"),
                DiagnosticResult("CBS draft order", "SKIP"),
                DiagnosticResult("CBS draft results", "SKIP"),
            ])
            return results

        if resp.status_code == 403:
            results.append(DiagnosticResult("CBS authentication", "FAIL", "Access denied (403)"))
            results.extend([
                DiagnosticResult("CBS teams", "SKIP"),
                DiagnosticResult("CBS rosters", "SKIP"),
                DiagnosticResult("CBS draft order", "SKIP"),
                DiagnosticResult("CBS draft results", "SKIP"),
            ])
            return results

        if resp.status_code != 200:
            results.append(DiagnosticResult(
                "CBS authentication", "FAIL", f"HTTP {resp.status_code}"
            ))
            results.extend([
                DiagnosticResult("CBS teams", "SKIP"),
                DiagnosticResult("CBS rosters", "SKIP"),
                DiagnosticResult("CBS draft order", "SKIP"),
                DiagnosticResult("CBS draft results", "SKIP"),
            ])
            return results

        results.append(DiagnosticResult("CBS authentication", "PASS", latency_ms=latency))
    except requests.Timeout:
        results.append(DiagnosticResult("CBS authentication", "FAIL", "Timeout (10s)"))
        results.extend([
            DiagnosticResult("CBS teams", "SKIP"),
            DiagnosticResult("CBS rosters", "SKIP"),
            DiagnosticResult("CBS draft order", "SKIP"),
            DiagnosticResult("CBS draft results", "SKIP"),
        ])
        return results
    except Exception as e:
        results.append(DiagnosticResult("CBS authentication", "FAIL", str(e)[:50]))
        results.extend([
            DiagnosticResult("CBS teams", "SKIP"),
            DiagnosticResult("CBS rosters", "SKIP"),
            DiagnosticResult("CBS draft order", "SKIP"),
            DiagnosticResult("CBS draft results", "SKIP"),
        ])
        return results

    # Gate 2–4: League resources
    for endpoint, label in [
        ("/league/teams", "CBS teams"),
        ("/league/rosters?team_id=all", "CBS rosters"),
        ("/league/draft/order", "CBS draft order"),
    ]:
        try:
            start = time.time()
            resp = requests.get(f"{base_url}{endpoint}", params=params, timeout=10)
            latency = (time.time() - start) * 1000
            status = "PASS" if resp.status_code == 200 else f"HTTP {resp.status_code}"
            results.append(DiagnosticResult(label, status, latency_ms=latency))
        except requests.Timeout:
            results.append(DiagnosticResult(label, "FAIL", "Timeout"))
        except Exception as e:
            results.append(DiagnosticResult(label, "FAIL", str(e)[:50]))

    # Gate 5: Draft results (likely /league/history/draft-results or similar)
    draft_result_endpoints = [
        "/league/history/draft-results",
        "/league/draft/results",
        "/league/history/results",
    ]
    draft_result_status = "UNKNOWN"
    draft_result_error = "No draft results endpoint found (may not exist yet)"

    for endpoint in draft_result_endpoints:
        try:
            start = time.time()
            resp = requests.get(f"{base_url}{endpoint}", params=params, timeout=10)
            latency = (time.time() - start) * 1000
            if resp.status_code == 200:
                draft_result_status = "PASS"
                draft_result_error = None
                break
            elif resp.status_code == 404:
                continue
            else:
                draft_result_status = f"HTTP {resp.status_code}"
                draft_result_error = None
                break
        except requests.Timeout:
            draft_result_status = "TIMEOUT"
            break
        except Exception:
            continue

    results.append(DiagnosticResult("CBS draft results", draft_result_status, error=draft_result_error))

    return results


def check_manual() -> DiagnosticResult:
    """Manual entry is always PASS — it's the anchor and has no external dependency."""
    return DiagnosticResult("Manual entry", "PASS")


def overall_status(fp_results: list[DiagnosticResult], cbs_results: list[DiagnosticResult]) -> str:
    """Determine READY | DEGRADED | BLOCKED.

    - READY: FantasyPros + at least one live draft source (CBS or manual)
    - DEGRADED: FantasyPros + CBS issues but manual works
    - BLOCKED: FantasyPros failed (can't run)

    Manual entry always works, so we never block usability.
    """
    fp_passed = any(r.status == "PASS" for r in fp_results)
    cbs_auth = next((r for r in cbs_results if r.name == "CBS authentication"), None)
    cbs_auth_ok = cbs_auth and cbs_auth.status == "PASS"

    if not fp_passed:
        return "BLOCKED"
    if cbs_auth_ok and any(r.status == "PASS" for r in cbs_results):
        return "READY"
    return "DEGRADED"


def main() -> None:
    """Print diagnostic report."""
    print("\n" + "=" * 60)
    print("DRAFT EDGE INTEGRATION CHECK")
    print("=" * 60)

    fp_results = check_fantasypros()
    print("\nFantasyPros:")
    for r in fp_results:
        status_str = r.status
        if r.error:
            status_str += f" ({r.error})"
        print(f"  {r}")

    cbs_results = check_cbs()
    print("\nCBS:")
    for r in cbs_results:
        status_str = r.status
        if r.error:
            status_str += f" ({r.error})"
        print(f"  {r}")

    manual_result = check_manual()
    print("\nFallback:")
    print(f"  {manual_result}")

    overall = overall_status(fp_results, cbs_results)
    print(f"\nOVERALL............................ {overall}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
