# 02 — League & Scoring (confirmed rules)

Source of truth for code: `core/league_config.yaml` + `core/scoring.py` (verified).
This doc explains the semantics and flags what still needs verification.

## Draft & roster
- League: **Family Affair** (CBS). Season 2026. **12 teams** (history confirms 12
  every year; eyeball-verify in the room).
- **Snake, 14 rounds, custom order, 60-second pick clock.**
- **You are slot 4**, team **"Mama There Goes That Man"**.
- Starters (9): **QB, RB, RB, WR, WR, TE, RWT(flex from RB/WR/TE), K, DST.**
- 14 drafted = 9 starters + 5 bench. Position Limits tab not captured — verify max
  per position during the draft.
- Derive pick numbers from `(teams, slot, round, snake_direction)` — do NOT
  hardcode. For 12 teams, slot 4 → overall picks 4, 21, 28, 45, 52, 69, 76, 93,
  100, 117, 124, 141, 148, 165.

## Why this league is not generic (the sources of edge)
1. **QB scoring is rich:** 6-pt pass TD, 1 pt / 20 pass yds, only −1 per INT, plus
   passing yardage + long-TD bonuses. Raises QB scores a lot — but the draft
   question is *elite-minus-replacement*, not raw points. Test whether elite-QB
   separation justifies earlier QB.
2. **Nonlinear milestones:** 250/300/400 pass, 100/150/200 rush & rec are
   **cumulative** bonuses → score simulated weekly lines, then average.
   `Score(E[stats]) ≠ E[Score(stats)]`.
3. **Long-TD bonuses:** 30/40/50-yd TDs add 1/2/3 → convex upside for explosive
   players. Treat explosive-TD propensity as a shrinkage feature; don't overfit.
4. **Threshold receptions:** 4/7/10 catches → 1/3/5, a **range (non-cumulative)**,
   NOT linear PPR. Rewards target monopolists who cross 7 and 10. Needs weekly
   reception distribution, not season totals.
5. **Flex (RWT):** the 7th skill starter competes across RB/WR/TE → solve the
   starting lineup jointly (assignment), not with static per-position ranks.
6. **Rich DST:** generous points-allowed table + forced-fumble scoring. Don't
   assume "DST last" — derive its marginal value.
7. **Kicker distance:** FG base 3 + 30/40/50 bonuses (1/2/3) → long-leg kickers may
   differentiate more than generic ranks imply.

## Scoring semantics (as implemented & tested)
- **Yardage:** continuous/fractional (pass 1/20, rush & rec 1/10). `VERIFY_FRACTIONAL`.
- **Yardage bonuses:** cumulative (a 400-yd passing game gets +1+3+5 = 9).
- **TD length & FG length:** single band per event (a 50-yd TD gets +3, not +1+2+3).
- **Receptions:** single band (10 catches = +5, not 1+3+5). `VERIFY_RANGE_VS_BONUS`.
- **DST points allowed:** single tier lookup; tiers above 30 unobserved → 0. Verify.

## Verified test coverage (already passing — 52 cases)
Passing 249/250/299/300/399/400; rushing & receiving 99/100/149/150/199/200;
receptions 3/4/6/7/9/10; TD distance 29/30/39/40/49/50; FG 29→50; extra point;
composite QB line; all DST PA tiers + DST event scoring. Run `core/test_scoring.py`.

## SCORING_VERIFICATION_STATUS (hard startup gate, non-blocking)
This is the single source of truth for what's confirmed vs assumed. It replaces any
reference elsewhere in the docs to a fixed count ("six VERIFY items") — always say
**"scoring/league VERIFY items"** instead, since the actual count is 8 and may grow.
Each item is `VERIFIED` (confirmed on the Family Affair CBS test-scoring/settings
page) or `ASSUMED` (best-guess default, not yet confirmed). **Do not silently
promote ASSUMED to VERIFIED** — only a human confirming against the league's own
settings page flips the flag. The app must still run with items ASSUMED (the public
web cannot access a private commissioner page), but the diagnostics screen must show
a **yellow banner** listing every ASSUMED item so the assumption never quietly
becomes treated as fact.

| # | Item | Status | Current assumption |
|---|------|--------|---------------------|
| 1 | Team count = 12 | ASSUMED | 12 (confirmed by 2019-2025 history; eyeball-verify in room) |
| 2 | Reception scoring: range vs cumulative | ASSUMED | Non-cumulative band: 4-6=+1, 7-9=+3, 10+=+5 (10 receptions = +5, NOT +1+3+5=+9) |
| 3 | Yardage fractional vs per-N | ASSUMED | Fractional/continuous (pass 1/20, rush & rec 1/10) |
| 4 | DST points-allowed tiers above 30 | ASSUMED | 31+ = 0 (unobserved in source screenshots) |
| 5 | Position Limits (max per position) | ASSUMED | UNCONFIRMED — no hard cap enforced yet |
| 6 | Full 12th draft-order slot | ASSUMED | Derived from snake formula, not hand-confirmed |
| 7 | Position-specific scoring overrides | ASSUMED | None known |
| 8 | Return-yard category | ASSUMED | Only return TDs credited (+6); no return-yardage category assumed |

If any assumption is wrong, change `core/league_config.yaml` and (if needed) the
matching band/threshold list in `core/scoring.py`, then re-run tests, then flip that
row to `VERIFIED` here.
