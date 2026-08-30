#!/usr/bin/env python3
"""
scripts/draft_sync.py — Draft Day Pick Sync

Sync picked players from CBS webpage to Draft Edge recommendation engine.
Handles messy webpage text with intelligent fuzzy matching against player pool.

Usage:
  # Parse players from HTML file
  python3 scripts/draft_sync.py --html-file draft.html

  # Parse players from raw text (interactively)
  python3 scripts/draft_sync.py --interactive

  # Full flow: copy webpage → paste → see recommendation
  bash scripts/draft_day_sync.sh
"""

from __future__ import annotations

import json
import sys
import argparse
import requests
from pathlib import Path
from typing import Optional

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: BeautifulSoup4 not installed. Run: pip install beautifulsoup4")
    sys.exit(1)


def load_known_players() -> set[str]:
    """Load player names from the cached player pool for fuzzy matching."""
    try:
        player_file = Path(__file__).parent.parent / "data" / "players.json"
        if player_file.exists():
            with open(player_file) as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {normalize_text(p.get("name", "")) for p in data}
                elif isinstance(data, dict) and "players" in data:
                    return {normalize_text(p.get("name", "")) for p in data["players"]}
    except Exception:
        pass
    return set()


def normalize_text(text: str) -> str:
    """Normalize text for comparison."""
    return text.lower().strip()


def fuzzy_match_name(candidate: str, known_players: set[str], threshold: float = 0.75) -> bool:
    """Check if candidate name is likely a real player using fuzzy matching."""
    from difflib import SequenceMatcher

    normalized = normalize_text(candidate)

    # Filter out junk (pure numbers, single letters, common words)
    if len(normalized) < 4 or normalized.isdigit():
        return False

    common_junk = {
        "pick", "round", "team", "position", "player", "name", "slot",
        "nfl", "cbs", "draft", "results", "time", "date", "et", "pm", "am",
        "owner", "manager", "user", "slot", "bye", "week", "rb", "wr", "te",
        "qb", "dst", "k", "def", "flex", "rwt", "ut", "coach", "injury",
        "bye week", "downed", "game", "score", "points", "bye"
    }
    if normalized in common_junk:
        return False

    # Filter out time-like patterns (8:32, 8:35, etc.)
    if ":" in normalized or any(c.isdigit() for c in normalized[:2]):
        return False

    # Check against known players (exact or close match)
    for known in known_players:
        ratio = SequenceMatcher(None, normalized, known).ratio()
        if ratio >= threshold:
            return True

    return False


def parse_draft_results_text(text: str) -> list[str]:
    """
    Extract player names from raw webpage text using fuzzy matching.
    Handles messy text from view-source or copy-paste.
    """
    known_players = load_known_players()

    # Try HTML parsing first
    try:
        soup = BeautifulSoup(text, "html.parser")
        # Remove script/style tags
        for tag in soup(["script", "style"]):
            tag.decompose()

        # Try to find a table
        table = soup.find("table")
        if table:
            rows = table.find_all("tr")
            candidates = []
            for row in rows:
                cols = row.find_all("td")
                for col in cols:
                    candidate = col.get_text(strip=True)
                    if fuzzy_match_name(candidate, known_players):
                        candidates.append(candidate)
            if candidates:
                return candidates

        # Fallback: extract all text
        text = soup.get_text()
    except Exception:
        pass

    # Parse raw text: split by newlines and filter for player names
    lines = text.split("\n")
    candidates = []

    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue

        # Try to extract name from line
        # Common pattern: "Pick# Team PlayerName Pos NFLTeam"
        parts = line.split()

        # Collect consecutive parts that might form a player name
        for i in range(len(parts)):
            # Try to form a name from 2-3 consecutive parts
            for length in [3, 2]:  # Try longer names first
                if i + length > len(parts):
                    continue

                candidate = " ".join(parts[i : i + length])
                if fuzzy_match_name(candidate, known_players):
                    # Clean up (remove trailing junk like positions)
                    candidate = candidate.split()[0:2]  # Keep max 2 parts
                    candidate_str = " ".join(candidate)
                    if candidate_str not in candidates:
                        candidates.append(candidate_str)

    return candidates


def sync_picks(
    picked_player_names: list[str], api_url: str = "http://localhost:3000"
) -> Optional[dict]:
    """Send picked players to Draft Edge and get recommendation."""
    endpoint = f"{api_url}/api/draft/sync"

    payload = {"picked_player_names": picked_player_names}

    try:
        print(f"\n📤 Syncing {len(picked_player_names)} picks to Draft Edge...\n")
        resp = requests.post(endpoint, json=payload, timeout=10)

        if resp.status_code != 200:
            print(f"❌ Sync failed: HTTP {resp.status_code}")
            print(resp.text)
            return None

        data = resp.json()

        # Show current state
        state = data.get("current_state", {})
        print("=" * 70)
        print(f"DRAFT STATE")
        print("=" * 70)
        print(f"Current Pick: {state.get('current_pick', '?')}")
        print(f"Total Picked: {state.get('picked_count', '?')}")
        print(f"Picks Applied: {data.get('picks_applied', 0)}")

        # Show recommendation
        rec = data.get("recommendation", {})
        print("\n" + "=" * 70)
        print(f"🎯 RECOMMENDATION")
        print("=" * 70)
        print(f"Player: {rec.get('recommended_player_name', '?')}")
        print(f"Position: {rec.get('position', '?')}")
        print(f"Confidence: {rec.get('decision_confidence', '?')}")
        print(f"Score: {rec.get('score', 0):.1f}")
        print(f"Survival to Next: {rec.get('survival_to_next_pick', 0):.1%}")

        reasons = rec.get("reasons", [])
        if reasons:
            print(f"\nReasons:")
            for reason in reasons[:3]:  # Show top 3
                code = reason.get("code", "?")
                text = reason.get("text", "")
                print(f"  • {code}: {text}")

        alternatives = rec.get("alternatives", [])
        if alternatives:
            print(f"\nAlternatives:")
            for alt in alternatives[:2]:  # Show top 2
                print(f"  • {alt.get('player_name', '?')} ({alt.get('position', '?')})")

        print("=" * 70 + "\n")
        return data

    except requests.ConnectionError:
        print(f"❌ Could not connect to Draft Edge at {api_url}")
        print("   Make sure the app is running: npm run dev")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync draft picks and get recommendation"
    )
    parser.add_argument("--html-file", help="Path to saved HTML file")
    parser.add_argument("--interactive", action="store_true", help="Paste HTML interactively")
    parser.add_argument(
        "--api-url",
        default="http://localhost:3000",
        help="Draft Edge API URL (default: localhost:3000)",
    )
    args = parser.parse_args()

    html = None

    if args.html_file:
        with open(args.html_file) as f:
            html = f.read()
        print(f"✓ Loaded HTML from {args.html_file}")

    elif args.interactive:
        print("Paste the HTML from CBS (right-click → View Page Source):")
        print("Press Ctrl+D (Mac/Linux) or Ctrl+Z + Enter (Windows) when done:\n")
        html = sys.stdin.read()

    else:
        print("Usage: python3 draft_sync.py [--html-file FILE | --interactive]")
        sys.exit(1)

    if not html:
        print("ERROR: No HTML/text provided")
        sys.exit(1)

    # Parse players (handles both HTML and raw text)
    print("📍 Parsing picked players...")
    players = parse_draft_results_text(html)

    if not players:
        print("❌ Could not extract players from text")
        print("   Make sure you pasted the full page source and it includes a draft results table")
        sys.exit(1)

    print(f"✓ Extracted {len(players)} picked players")
    print(f"  Samples: {', '.join(players[:5])}")

    # Show parsing confidence
    if len(players) < 10:
        print("\n⚠️  Low number of picks detected. Make sure you pasted the full page.")
    elif len(players) > 168:  # 12 teams * 14 rounds
        print("\n⚠️  Too many picks detected. Some might be duplicates or junk.")

    # Sync and get recommendation
    result = sync_picks(players, args.api_url)
    if not result:
        sys.exit(1)

    # Show summary
    print("\n" + "=" * 70)
    print(f"✓ Successfully synced {result.get('picks_applied', 0)} new picks")
    print("=" * 70)


if __name__ == "__main__":
    main()
