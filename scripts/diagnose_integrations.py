"""
scripts/diagnose_integrations.py — STUB

Owner: integration-doctor. Ground truth: docs/04_INTEGRATIONS.md
§Diagnostic tool. Must exist, never prints secrets.

Expected output format:
    FantasyPros auth / players / CBS IDs / rankings / projections / injuries : PASS
    CBS league / auth / teams / rosters / draft order / draft results / latency : PASS|FAIL|UNKNOWN
    Browser companion : READY|NOT BUILT   Manual : PASS   OVERALL : READY|DEGRADED|BLOCKED
"""

from __future__ import annotations


def check_fantasypros() -> dict[str, str]:
    """Connectivity gate (docs/04 §A): HTTP 200, sport=NFL, players array,
    FantasyPros IDs present, CBS external IDs present where available."""
    raise NotImplementedError("integration-doctor: implement check_fantasypros")


def check_cbs() -> dict[str, str]:
    """Bounded gate order (docs/04 §B): host -> auth -> league resources ->
    draft results -> live behavior. Read-only, never automate picks."""
    raise NotImplementedError("integration-doctor: implement check_cbs")


def check_manual() -> str:
    """Manual entry is always PASS — it's the anchor and has no external dependency."""
    return "PASS"


def overall_status(fp: dict[str, str], cbs: dict[str, str]) -> str:
    """READY | DEGRADED | BLOCKED — never blocks manual-first usability."""
    raise NotImplementedError("integration-doctor: implement overall_status")


if __name__ == "__main__":
    raise NotImplementedError("integration-doctor: wire CLI entrypoint (print report, no secrets)")
