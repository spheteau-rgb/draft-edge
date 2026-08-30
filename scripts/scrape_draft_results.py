"""
scripts/scrape_draft_results.py — CBS Draft Results Scraper

Scrapes the draft results page to extract picked players and detect new picks.
Minimal user involvement: just run it periodically, it handles state internally.

Usage:
  python3 scripts/scrape_draft_results.py [--url URL] [--html-file FILE]

Examples:
  # Auto-load the page (requires Selenium + Chrome/Edge)
  python3 scripts/scrape_draft_results.py --url https://fatwo.football.cbssports.com/draft/results

  # Parse a saved HTML file (easiest for Sunday)
  python3 scripts/scrape_draft_results.py --html-file draft_results.html

  # Enter HTML interactively
  python3 scripts/scrape_draft_results.py --interactive
"""

from __future__ import annotations

import json
import os
import sys
import argparse
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: BeautifulSoup4 not installed. Run: pip install beautifulsoup4")
    sys.exit(1)


@dataclass
class DraftPick:
    pick_number: int
    round_num: int
    team: str
    player_name: str
    position: str
    nfl_team: str

    def __str__(self) -> str:
        return f"Pick {self.pick_number}: {self.player_name} ({self.position}, {self.nfl_team}) → {self.team}"


def parse_draft_results(html: str) -> list[DraftPick]:
    """Extract draft picks from CBS draft results HTML."""
    soup = BeautifulSoup(html, "html.parser")
    picks = []

    # Look for the draft results table
    # CBS uses various table structures; try multiple selectors
    table = soup.find("table", {"class": lambda x: x and "draft" in x.lower()})
    if not table:
        table = soup.find("table")

    if not table:
        print("WARNING: No table found. Trying to parse from rows...")
        # Fallback: look for any table with player data
        rows = soup.find_all("tr")
    else:
        rows = table.find_all("tr")

    for i, row in enumerate(rows):
        cols = row.find_all("td")
        if len(cols) < 3:
            continue

        try:
            # Try to extract: pick#, round, team, player, pos, nfl_team
            # CBS structure varies, so we're flexible
            text_cols = [col.get_text(strip=True) for col in cols]

            if not text_cols[0].replace(".", "").isdigit():
                continue

            pick_num = int(text_cols[0].replace(".", ""))
            round_num = (pick_num - 1) // 12 + 1  # Assume 12 teams

            # Find player name (usually a link or bold text)
            player_link = row.find("a")
            player_name = (
                player_link.get_text(strip=True)
                if player_link
                else text_cols[2] if len(text_cols) > 2 else "Unknown"
            )

            # Position and NFL team (heuristic)
            position = text_cols[3] if len(text_cols) > 3 else "?"
            nfl_team = text_cols[4] if len(text_cols) > 4 else "?"
            team = text_cols[1] if len(text_cols) > 1 else "?"

            # Filter noise
            if len(player_name) < 2 or player_name.lower() in ("pick", "player", "team"):
                continue

            picks.append(
                DraftPick(
                    pick_number=pick_num,
                    round_num=round_num,
                    team=team,
                    player_name=player_name,
                    position=position,
                    nfl_team=nfl_team,
                )
            )
        except (ValueError, IndexError, AttributeError):
            continue

    return picks


def load_previous_state() -> list[str]:
    """Load the list of previously scraped player names."""
    state_file = Path(__file__).parent.parent / "data" / "draft_state.json"
    if state_file.exists():
        try:
            with open(state_file) as f:
                data = json.load(f)
                return data.get("picked_players", [])
        except Exception:
            pass
    return []


def save_state(picks: list[DraftPick]) -> None:
    """Save the current list of picked players."""
    state_file = Path(__file__).parent.parent / "data" / "draft_state.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    picked = [p.player_name for p in picks]
    with open(state_file, "w") as f:
        json.dump({"picked_players": picked}, f, indent=2)


def detect_new_picks(
    current_picks: list[DraftPick], previous_players: list[str]
) -> list[DraftPick]:
    """Return picks that are new since the last run."""
    current_players = {p.player_name for p in current_picks}
    previous_set = set(previous_players)
    new_players = current_players - previous_set
    return [p for p in current_picks if p.player_name in new_players]


def scrape_from_url(url: str) -> Optional[str]:
    """Load and return HTML from a URL using Selenium."""
    try:
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
    except ImportError:
        print("ERROR: Selenium not installed. Run: pip install selenium")
        print("  OR use --html-file to provide saved HTML instead.")
        return None

    try:
        # Use headless Chrome/Edge
        options = webdriver.ChromeOptions()
        options.add_argument("--headless")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")

        driver = webdriver.Chrome(options=options)
        driver.get(url)

        # Wait for page to load
        WebDriverWait(driver, 10).until(
            lambda d: d.find_elements(By.TAG_NAME, "table")
        )

        html = driver.page_source
        driver.quit()
        return html
    except Exception as e:
        print(f"ERROR: Could not load {url}: {e}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape CBS draft results and detect new picks"
    )
    parser.add_argument(
        "--url",
        default="https://fatwo.football.cbssports.com/draft/results",
        help="CBS draft results URL",
    )
    parser.add_argument("--html-file", help="Path to saved HTML file")
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Prompt to paste HTML",
    )
    args = parser.parse_args()

    html = None

    if args.html_file:
        with open(args.html_file) as f:
            html = f.read()
        print(f"Loaded HTML from {args.html_file}")

    elif args.interactive:
        print("Paste the HTML from 'View Page Source' and press Ctrl+D (Mac/Linux) or Ctrl+Z (Windows) twice:")
        html = sys.stdin.read()

    else:
        print(f"Fetching {args.url}...")
        html = scrape_from_url(args.url)
        if not html:
            print("ERROR: Could not load page. Try --html-file or --interactive instead.")
            sys.exit(1)

    # Parse picks
    picks = parse_draft_results(html)
    if not picks:
        print("ERROR: Could not extract any picks from HTML.")
        print("  Make sure you're on the draft results page and the HTML is complete.")
        sys.exit(1)

    # Detect new picks
    previous = load_previous_state()
    new_picks = detect_new_picks(picks, previous)

    print("\n" + "=" * 70)
    print(f"DRAFT RESULTS: {len(picks)} total picks")
    print("=" * 70)

    if new_picks:
        print(f"\n🆕 NEW PICKS ({len(new_picks)}):")
        for pick in new_picks:
            print(f"  {pick}")
    else:
        print("\n(No new picks since last run)")

    print(f"\n📊 ALL PICKS ({len(picks)}):")
    for pick in picks:
        marker = "🆕" if pick in new_picks else "  "
        print(f"{marker} {pick}")

    # Save state
    save_state(picks)
    print(f"\n✓ State saved. Run again to detect new picks.")
    print("=" * 70)


if __name__ == "__main__":
    main()
