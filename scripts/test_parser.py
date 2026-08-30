#!/usr/bin/env python3
"""Quick test of the draft results parser with messy text."""

import sys
from pathlib import Path

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent))

from draft_sync import parse_draft_results_text

# Sample messy text from a CBS webpage
SAMPLE_TEXT = """
Draft Results

Pick 1
Jahmyr Gibbs
RB, DET
8:32 PM ET

Pick 2
Travis Kelce
TE, KC
8:35 PM ET

Pick 3
Patrick Mahomes
QB, KC
8:38 PM ET

Pick 4
Jalen Hurts
QB, PHI
8:41 PM ET

Pick 5
Josh Allen
QB, BUF
8:44 PM ET
"""

print("Testing parser with sample messy text...")
print("=" * 60)

players = parse_draft_results_text(SAMPLE_TEXT)

print(f"\nExtracted {len(players)} players:")
for i, player in enumerate(players, 1):
    print(f"  {i}. {player}")

print("\n" + "=" * 60)
if len(players) >= 3:
    print("✓ Parser working! Ready for draft day.")
else:
    print("⚠️  Parser only found a few players. Check the format.")
