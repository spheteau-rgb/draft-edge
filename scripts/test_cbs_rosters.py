"""
scripts/test_cbs_rosters.py — CBS Roster Endpoint Discovery

Test which authentication method works for the rosters endpoint.
Try: (1) unauthenticated, (2) with session cookies, (3) error handling.
"""

from __future__ import annotations

import os
import requests
from typing import Optional


def load_env() -> dict[str, str]:
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


def test_rosters_unauthenticated(league_id: str) -> Optional[dict]:
    """Test if rosters endpoint works without authentication."""
    url = "https://api.cbssports.com/fantasy/league/rosters"
    params = {
        "league_id": league_id,
        "version": "3.0",
        "team_id": "all",
        "response_format": "JSON",
    }
    try:
        print(f"Testing unauthenticated: GET {url}?league_id={league_id}&...")
        resp = requests.get(url, params=params, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"✓ SUCCESS — got {len(data.get('rosters', []))} rosters")
            return data
        elif resp.status_code == 401:
            print("✗ Requires authentication (401)")
            return None
        else:
            print(f"✗ Error: HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"✗ Exception: {e}")
        return None


def test_rosters_with_token(league_id: str, access_token: str) -> Optional[dict]:
    """Test if rosters endpoint works with access_token."""
    url = "https://api.cbssports.com/fantasy/league/rosters"
    params = {
        "league_id": league_id,
        "version": "3.0",
        "team_id": "all",
        "response_format": "JSON",
        "access_token": access_token,
    }
    try:
        print(f"\nTesting with access_token...")
        resp = requests.get(url, params=params, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"✓ SUCCESS — got {len(data.get('rosters', []))} rosters")
            return data
        elif resp.status_code == 401:
            print("✗ Invalid token (401)")
            return None
        else:
            print(f"✗ Error: HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"✗ Exception: {e}")
        return None


def main() -> None:
    print("=" * 60)
    print("CBS ROSTERS ENDPOINT DISCOVERY")
    print("=" * 60)

    env = load_env()
    league_id = env.get("CBS_LEAGUE_ID", "").strip()
    access_token = env.get("CBS_ACCESS_TOKEN", "").strip()

    if not league_id:
        print("\n✗ CBS_LEAGUE_ID not set in .env")
        print("  Set it manually: CBS_LEAGUE_ID=<your_league_id>")
        print("  (Find it in the CBS URL: fatwo.football.cbssports.com/.../{LEAGUE_ID}/...)")
        return

    print(f"\nLeague ID: {league_id}")

    # Try unauthenticated
    result = test_rosters_unauthenticated(league_id)
    if result:
        print("\n✓ GOOD NEWS: Rosters endpoint works unauthenticated!")
        print("  We can implement roster-diff polling without a token.")
        return

    # Try with token if available
    if access_token:
        result = test_rosters_with_token(league_id, access_token)
        if result:
            print("\n✓ GOOD NEWS: Rosters endpoint works with access_token!")
            print("  We can implement roster-diff polling.")
            return
    else:
        print("\n✗ CBS_ACCESS_TOKEN not set in .env — skipping token test")

    print("\n" + "=" * 60)
    print("RESULT: Rosters endpoint requires authentication we don't have.")
    print("FALLBACK: Use browser companion extension (Option B).")
    print("  The extension runs in your browser with session auth,")
    print("  and POSTs draft events to the Draft Edge backend.")
    print("=" * 60)


if __name__ == "__main__":
    main()
