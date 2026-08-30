#!/bin/bash
# scripts/draft_day_sync.sh — Complete Draft Day Workflow
#
# One script for all your draft-day needs:
# 1. Scrape CBS draft results HTML
# 2. Parse picked player names
# 3. Sync to Draft Edge backend
# 4. Display next recommendation
#
# Run every 20-60 seconds during the draft:
#   bash scripts/draft_day_sync.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

API_URL="${DRAFT_EDGE_API_URL:-http://localhost:3000}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DRAFT EDGE — Live Sync & Recommendation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if app is running
if ! curl -s "$API_URL/api/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Draft Edge not running at $API_URL${NC}"
    echo "  Start it with: npm run dev"
    echo ""
fi

echo -e "${BLUE}1. GATHER PICKED PLAYERS${NC}"
echo "   On your CBS draft results page:"
echo "   • Right-click → View Page Source"
echo "   • Cmd+A (select all)"
echo "   • Cmd+C (copy)"
echo ""
echo "Then come back here and paste (Cmd+V), then Ctrl+D:"
echo ""

# Collect HTML
HTML=$(cat)

# Sync
echo ""
echo -e "${BLUE}2. SYNCING TO DRAFT EDGE...${NC}"
python3 "$REPO_ROOT/scripts/draft_sync.py" --interactive <<< "$HTML" --api-url "$API_URL"

echo ""
echo -e "${GREEN}✓ Done.${NC} Run this script again in 30-60 seconds."
echo ""
