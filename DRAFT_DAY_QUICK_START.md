# Draft Day Quick Start — Zero-Thinking Manual Entry

**Date:** Sunday Aug 30, 2026, 5:00 PM ET  
**Your Team:** Mama There Goes That Man (Slot 4)  
**Pick Clock:** 60 seconds

---

## Pre-Draft Checklist (Do This Saturday)

- [ ] Run `python3 scripts/diagnose_integrations.py` — ensure FantasyPros is GREEN
- [ ] Test the app at `http://localhost:3000` or deployed Vercel URL
- [ ] Close ALL other browser tabs except CBS draft + Draft Edge (side-by-side)
- [ ] Bookmark the Draft Edge URL on your phone + iPad

---

## During Draft: Automated Sync + Manual Entry

**The workflow:** Every 30-60 seconds, paste the CBS draft results page and get an updated recommendation.

### Step 1: Setup Side-by-Side Screens

- **Left:** CBS draft results page (already open)
- **Right:** Draft Edge app + terminal side-by-side

### Step 2: Every 30-60 Seconds, Run the Sync Script

```bash
bash scripts/draft_day_sync.sh
```

**What happens:**
1. Script prompts you to paste HTML from CBS
2. You go to CBS draft results → Right-click → **View Page Source**
3. `Cmd+A` → `Cmd+C` (select all, copy)
4. Come back to terminal, paste (Cmd+V)
5. Press `Ctrl+D` (to finish input)
6. **Script extracts all picked players, syncs to Draft Edge, shows the NEXT RECOMMENDATION**

**Output shows:**
- Current pick number
- How many picks have been made
- 🎯 **Recommended player** (position, confidence, score)
- Why (top 3 reasons)
- Alternatives (if you want to pivot)

### Step 3: When It's Your Turn

1. See the recommendation on your screen
2. Go to CBS and make that pick (or a different one if you have a reason)
3. The app is already updated with all previous picks
4. Next sync will show your updated recommendation

**Time:** ~2 minutes per 30-second interval, mostly just pasting HTML

---

## The App on Draft Day

**Always visible:**
- Current pick recommendation (highlighted)
- Reason (e.g., "SCORING_EDGE", "POSITION_CLIFF", "WONT_SURVIVE")
- Survival % to next pick
- Freshness indicators (FantasyPros, CBS, build time)

**What's NOT required:**
- CBS live polling (manual entry is the anchor)
- Complex configuration
- Thinking about state — just type the player name

---

## If Something Breaks

**App won't load?**
→ Restart the dev server or reload Vercel URL

**Can't find a player to type?**
→ Check spelling against the CBS board, or type partial name (e.g., "Mahomes" not "Patrick Mahomes")

**Recommendation seems wrong?**
→ Manually enter the pick anyway; move on. We'll debug post-draft.

**Forgot to enter a pick?**
→ Go back a few picks, click "undo", re-enter in correct order.

---

## Post-Draft

1. Export your picks from CBS
2. Run `python3 scripts/replay.py` to backtest the recommendation quality
3. Check Draft Edge output (`data/draft_results.json`) vs CBS for accuracy

---

## Contacts

**If live features fail:**
- Scraping broken? Manual entry still works.
- Manual entry broken? That's a bug — screenshot + report immediately.

**Remember:** Manual entry is the anchor. Everything else is optional enhancement.

---

## Final Checklist (Sunday ~4:45 PM)

- [ ] App is loaded at http://localhost:3000 or Vercel URL
- [ ] Terminal is open and ready to run `bash scripts/draft_day_sync.sh`
- [ ] CBS draft results page is open in a separate browser window
- [ ] FantasyPros data is fresh: `python3 scripts/diagnose_integrations.py` shows GREEN
- [ ] You've tested the sync once: run `bash scripts/draft_day_sync.sh`, paste test HTML
- [ ] Display shows the current recommendation correctly
- [ ] You're ready to draft

**You've got this.** Paste every 30-60s, trust the model, win the league.
