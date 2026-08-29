# 05 — Family Affair Historical Priors

Data: `data/family_affair_history.json` (Round-1 picks 2019–2025 + 2026 order).
Use it to predict **acquisition cost and opponent behavior** — it must NOT override
player fundamentals. Round-1 only exists; rounds 2–14 are unavailable, so keep
manager models modest.

## Core idea: two values per player
- **Fundamental League Value** — expected value under Family Affair scoring/roster.
- **Family Affair Market Value** — expected acquisition cost in *this* room.
The edge = the gap: a genuinely good player this room reliably lets slide.

## What the history says (directional)
1. Historically heavy **RB premium** in Round 1 (2019–2022 RB share 67–83%).
2. That premium **weakened sharply in 2023–2025** (RB 50/50/~64%; WR rising). This
   is a regime change — **recency-weight, don't flat-average 7 years.**
3. **Elite QBs go earlier** here than a generic 1-QB market — consistent with the
   rich QB scoring. Mahomes repeatedly Round 1; Hurts R1 in 2023.
4. **TE almost never Round 1** (only Kelce, 2022 & 2023).
5. Manager tendencies persist enough to model, but **tie behavior to manager
   identity, not draft slot** (order changes yearly; names change too).

## How to turn it into model inputs
- **LeaguePositionBias(pos):** recency-weighted (weights in the JSON) comparison of
  this room's Round-1 position share vs the current outside-market Round-1 share.
  Convert to a pick adjustment, **capped to [-5, +5]**.
- **ManagerAffinity(m, pos):** Beta-shrunk share of a manager's early picks by
  position, `k=8`, backed off to league rate. With only ~7 Round-1 picks per
  manager, this is a weak prior — use it to nudge position/tier survival, never to
  predict an exact player.
- **Identity resolution:** normalize team-name variants (e.g. "Domination" /
  "D.Omination") to one manager key; map to the 2026 order via
  `draft_order_2026`. Flag anything ambiguous for human confirm.

## Who picks between your turns (slot 4, 12 teams)
Snake, so before each of your picks the intervening managers are known. Example:
after your R1 pick (4), the next 14 selections (5→12 then 12→5-ish back to you at
21) come from specific managers — feed *their* affinities into the survival
correction so "will he last?" reflects the actual room, not generic ADP.

## Guardrails
- Never let limited history swing an expected pick by >5 spots.
- A champion's Round-1 pick does NOT prove the strategy caused the title — don't
  use standings causally without full rosters (which we don't have).
- If a historically RB-first manager opens WR-WR tonight, **update live** — live
  2026 selections outrank historical priors the moment the draft starts.

## Priority hierarchy (highest first)
1. Exact Family Affair scoring + roster rules
2. Current projections / weekly distributions
3. Current 2026 market (ADP/ECR)
4. Recent Family Affair behavior (2023–2025)
5. Manager-specific Family Affair behavior
6. Older Family Affair history (2019–2022)
7. **Live 2026 selections — highest weight once the draft begins**
