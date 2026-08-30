#!/bin/bash
# scripts/draft_day.sh — One-line draft day automation
# Run this every 30-60 seconds during the draft.
# It scrapes the CBS page, detects new picks, and updates the recommendation.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DRAFT EDGE — Live Pick Detection"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}✗ .env not found${NC}"
    echo "  Create it from .env.example and add your FantasyPros key"
    exit 1
fi

# Try interactive mode: user will paste HTML from "View Page Source"
echo "On your CBS draft results page:"
echo "  1. Right-click → View Page Source"
echo "  2. Cmd+A (select all)"
echo "  3. Cmd+C (copy)"
echo "  4. Come back here and paste (Cmd+V), then press Ctrl+D"
echo ""
echo -e "${YELLOW}Ready to paste HTML?${NC}"
echo "(Ctrl+D when done)"
echo ""

python3 scripts/scrape_draft_results.py --interactive

echo ""
echo "✓ Done. Run this script again in 30-60 seconds to detect more picks."
echo ""
