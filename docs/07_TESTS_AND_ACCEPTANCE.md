# 07 — Tests, Acceptance & Runbook

## Build sequence (with a stop-loss)
| Step | Deliverable | Gate |
|---|---|---|
| 1 | League config + scoring | `core/test_scoring.py` green (already is) |
| 2 | FantasyPros ingestion + identity map + cache | diagnose_integrations shows PASS + CBS IDs |
| 3 | Precompute pipeline → `data/players.json` | every active player has a scored weekly distribution |
| 4 | VORP + flex-aware lineup optimizer + base ranking | dominance test passes |
| 5 | Market + survival + historical priors | survival monotonicity tests pass |
| 6 | Final score + 1-turn lookahead + reason codes | recommendation returns in <1s |
| 7 | Draft-state engine + manual entry + UI | **full mock draft playable manually** |
| 8 | CBS live provider (time-boxed) | live latency measured, or manual improved |
| 9 | Mock draft, latency, acceptance, freeze | all gates below green |

**Stop-loss:** if time is short, cut in this order: CBS automation → cosmetic UI/PWA
extras → manager-specific refinements → REDUCE ROLLOUT COUNT (500→250→100). Always
preserve at least deterministic survival-aware lookahead — the sequential term is
more important to winning than most polish. Never cut the scoring engine, VORP,
manual entry, or the deploy.

## Required tests
**Scoring** (done): boundaries at 249/250/299/300/399/400 (pass), 99/100/149/150/
199/200 (rush & rec), receptions 3/4/6/7/9/10, TD & FG distance 29→50, DST PA tiers.

**Draft state:**
- no duplicate player can be drafted
- snake order correct; your slot-4 picks land at 4,21,28,45,52,69,76,93,100,117,124,141,148,165 (12-team)
- undo restores exact prior state
- manual correction works

**Survival (properties):** P∈[0,1]; later next-pick ⇒ weakly lower survival;
earlier expected ADP ⇒ weakly lower survival; higher sigma ⇒ moves toward 0.5.

**Optimizer (properties):** if candidate A dominates B on every input, B can't
outrank A; removing urgency weight returns value-heavy ordering; no K/DST early
unless guardrail disabled; a legal roster is still achievable before the final pick.

**Baselines (sanity, not proof of superiority):** compare V1 ordering vs
FantasyPros ECR, current ADP, league-adjusted projected points, static VORP. Each
added component should change picks for an identifiable reason.

**Historical replay (fast, optional):** for each past season, reveal opponents
sequentially and check the market model gives the actual Round-1 position more
probability than a generic model. If ADP snapshots aren't available in time, use
history only as a shrunk prior — do not block.

**Deterministic full-draft shadow simulation (highest-value final QA step, run
before freeze):** script a full 12-team, 14-round (165-pick) snake draft with a
realistic-but-random opponent policy (same as the lookahead's opponent model) and
Draft Edge making every user-slot-4 pick, all roster constraints enforced, no
duplicate players allowed. Fix a seed and confirm the SAME seed produces an
IDENTICAL result every run. Then rerun with 100 different seeds. This is not meant
to prove Draft Edge "wins" — it's meant to surface: roster dead ends, an
unreachable legal starting lineup, unexpected/runaway K or DST picks, runaway
z-scores, survival-probability bugs, duplicated players, latency spikes on any
pick, and recommendation oscillation (the top pick flipping without a state
change). Fix anything the 100-run sweep surfaces before freeze.

## Acceptance gates (all must pass before draft)
- [ ] `core/test_scoring.py` green
- [ ] diagnose_integrations: FantasyPros PASS; CBS PASS or explicitly DEGRADED with
      manual READY
- [ ] players.json built for all draftable players, with distributions
- [ ] a full 14-round mock draft completed from slot 4 via manual entry
- [ ] recommendation latency <1s on your turn
- [ ] undo/correct verified mid-mock
- [ ] no secrets in git (`git grep` clean); `.env` gitignored; FantasyPros key
      rotated after setup
- [ ] public URL loads on the PHONE over CELLULAR (wifi off) and on the Mac
- [ ] cross-device sync: a pick entered on one device appears on the other in <3s
- [ ] device-switch mid-draft works: reload on a 2nd device shows exact current state
- [ ] app added to phone home screen (PWA) opens fullscreen and reaches live state
- [ ] the scoring/league VERIFY items in docs/02 confirmed (or explicitly accepted
      as ASSUMED, with the yellow banner visible in diagnostics)
- [ ] deterministic shadow draft: same seed -> identical result; 100-seed sweep run
      with no roster dead ends, no duplicate players, no latency spikes

## Draft-day runbook (Sun Aug 30, before 5:00 PM ET)
**T-3h**
1. `git pull`; activate venv; `python3 core/test_scoring.py` (green).
2. Refresh data: run precompute → new players.json. Confirm freshness.
3. `python3 scripts/diagnose_integrations.py` → OVERALL READY (or DEGRADED+manual).
4. If using CBS live: do the one-time token step; confirm roster-diff detects a pick
   in a test. If flaky, switch to browser companion; if still flaky, go manual.
5. Open the CBS **test-scoring** page and confirm the scoring/league VERIFY items. Fix config if needed.

**T-30m**
6. Open Draft Edge UI on the Mac; open CBS draft room alongside.
7. Set your slot (4) and team; confirm your pick numbers display correctly.
8. Do a 3-pick dry run of manual entry + undo.

**During**
9. Each pick: it appears (live or you tap it). On your turn, read PICK + reasons +
   survival. You have ~60s and the rec is already on screen — glance, sanity-check the top 2-3, confirm.
10. If anything glitches: undo, re-enter manually, keep going. The engine never
    depends on the connector.

**If CBS breaks entirely:** nothing changes for you except you type each pick.
That is the designed-for case, not an emergency.
