# 15 — Draft Edge 2026: Fast-Core Production Algorithms
## Implementation-ready specification for the August 30, 2026 Family Affair draft

**Status:** Production V1 specification  
**Goal:** Give Claude the algorithms, not the research problem.  
**Constraint:** Build a reliable system in hours, not a multi-month research project.  
**Core rule:** No LLM call is required to calculate the pick recommendation.

---

# 0. Ruthless Scope

## Build now

Exactly five decision algorithms:

1. **Family Affair Scoring Engine**
2. **Projection Ensemble + Weekly Distribution Approximation**
3. **Dynamic Roster Value / Replacement Value**
4. **Family Affair Market + Player Survival Model**
5. **Fast Sequential Pick Optimizer**

Plus:
- draft-state engine;
- manual/live event ingestion;
- simple recommendation UI;
- deterministic tests;
- cached data;
- fallback ranking.

## Do NOT build before the 2026 draft

Defer:
- full season oracle simulator;
- policy distillation;
- hierarchical Bayesian MCMC;
- correlated weekly Monte Carlo across all NFL games;
- neural opponent models;
- reinforcement learning;
- complex trade/waiver optimizer;
- cloud architecture;
- distributed services.

These remain valid Phase-2 research, but they are not needed to generate a strong live draft edge.

---

# 1. System Objective

The V1 system does **not** attempt to estimate championship probability directly.

That would create false precision with too little time to calibrate.

Instead maximize a robust draft utility:

```text
PickScore(p)
    = CurrentRosterGain(p)
    + UrgencyValue(p)
    + MarketMispricing(p)
    + UpsideAdjustment(p)
    - RosterPenalty(p)
    - UncertaintyPenalty(p)
```

Every term must be on a comparable standardized scale.

The live rank is produced from this score.

This is intentionally interpretable and testable.

---

# 2. Algorithm 1 — Exact Family Affair Scoring Engine

## Input

A player's projected/simulated weekly raw statistics.

## Output

Fantasy points under exact Family Affair rules.

## Requirements

Never use generic projected fantasy points when raw stats are available.

The scoring engine must support:
- 6-point passing TD;
- 1 point / 20 passing yards;
- -1 INT;
- passing yard bonuses;
- rushing/receiving yard bonuses;
- long-TD bonuses;
- threshold reception scoring;
- kicker distance bonuses;
- Family Affair DST scoring.

## Threshold calculation

For cumulative bonus categories:

```python
def cumulative_bonus(value, thresholds):
    total = 0.0
    for threshold, bonus in thresholds:
        if value >= threshold:
            total += bonus
    return total
```

Example Family Affair passing-yard bonus:

```python
pass_yard_bonus = cumulative_bonus(
    pass_yards,
    [(250, 1), (300, 3), (400, 5)]
)
```

Long-TD bonus:

```python
def td_length_bonus(length):
    if length >= 50:
        return 3
    if length >= 40:
        return 2
    if length >= 30:
        return 1
    return 0
```

Reception range:

```python
def reception_bonus(receptions):
    if receptions >= 10:
        return 5
    if receptions >= 7:
        return 3
    if receptions >= 4:
        return 1
    return 0
```

### Important

Use exact CBS semantics verified from league settings.

Do not accidentally make the 4/7/10 reception ranges cumulative.

---

# 3. Algorithm 2 — Projection Ensemble

The strongest immediate projection strategy is a robust consensus, not a bespoke predictive model.

## Sources

Use any legally/technically available raw-stat projections, with FantasyPros as a major source.

For each player and stat `s`:

```text
Projection(player, s)
    = weighted_median_or_mean(source projections)
```

## V1 weighting

If source quality metadata is unavailable:

```text
equal weights
```

If FantasyPros consensus + 2–4 other independent sources are available:

```text
FantasyPros consensus: 0.40
other sources: split remaining 0.60 equally
```

Do not spend implementation time optimizing projection weights.

## Robustness

Winsorize obvious source errors.

For stat `x`:

```text
lower = Q10(sources)
upper = Q90(sources)
clip each source to [lower, upper]
average
```

With fewer than four sources, use median rather than winsorization.

---

# 4. Weekly Distribution Approximation

Family Affair bonuses are nonlinear, so season means alone are insufficient.

We need a cheap approximation.

## V1 method

For each player, create weekly stat distributions from:
- projected season total;
- projected games;
- historical coefficient of variation by position/stat;
- player-specific recent volatility if available.

Approximate each positive counting statistic with a Gamma or lognormal distribution.

Example:

```text
weekly_mean = season_projection / projected_games

weekly_sd = weekly_mean * CV(position, stat)
```

Suggested initial CV values:

```yaml
QB:
  pass_yards: 0.25
  pass_td: 0.65
  rush_yards: 0.80
  rush_td: 1.80

RB:
  rush_yards: 0.50
  receptions: 0.65
  rec_yards: 0.80
  total_td: 1.35

WR:
  receptions: 0.55
  rec_yards: 0.65
  total_td: 1.50

TE:
  receptions: 0.60
  rec_yards: 0.70
  total_td: 1.55
```

These are priors, not asserted truths.

If historical weekly data can be fit quickly, replace with empirical position/tier CV values.

## Fast Monte Carlo

For each player:

```text
N = 2,000 weekly draws offline/pre-draft
```

Score each draw with the exact Family Affair scoring engine.

Store:

```text
mean_weekly_fp
median_weekly_fp
p10
p25
p75
p90
weekly_sd
prob_20_plus
prob_25_plus
prob_30_plus
```

This is done before the live draft.

Live recommendation does not resimulate player distributions.

---

# 5. Season Value

Compute:

```text
ExpectedSeasonPoints
    = ExpectedWeeklyPoints * ExpectedGames
```

But injury/games risk matters.

Use:

```text
RiskAdjustedSeasonPoints
    = ExpectedSeasonPoints
      - injury_penalty
```

V1 injury penalty:

```text
injury_penalty
    = ExpectedSeasonPoints
      * P(miss_material_time)
      * 0.25
```

If no calibrated injury probability is available, omit this term rather than invent one.

---

# 6. Algorithm 3 — Dynamic Replacement Value

Static VBD is useful but incomplete.

V1 should calculate state-dependent replacement value from the **currently available player pool**.

## Required starter demand

For a 12-team league:

```text
QB demand = 12
RB mandatory demand = 24
WR mandatory demand = 24
TE demand = 12
RWT flex demand = 12
K demand = 12
DST demand = 12
```

The flex demand should be assigned dynamically among RB/WR/TE.

## Available-pool replacement

For each position, sort currently available players by league-adjusted expected value.

Approximate replacement slot:

```text
replacement_index(position)
    = expected remaining starter demand at position
```

Then:

```text
VORP(p)
    = Value(p) - ReplacementValue(position)
```

---

# 7. Flex-Aware Replacement

A player is valuable because of how they improve the optimal starting lineup.

For candidate `p`:

1. add `p` to user's roster;
2. solve the best legal starting lineup;
3. calculate lineup value;
4. compare with lineup value before pick.

```text
CurrentRosterGain(p)
    = BestLineupValue(roster + p)
      - BestLineupValue(roster)
```

But early in a draft an empty roster makes this too myopic.

Therefore use:

```text
RosterGain(p)
    = 0.65 * VORP(p)
      + 0.35 * CurrentRosterGain(p)
```

Change weights as draft progresses:

```yaml
rounds_1_4:
  VORP: 0.75
  roster_fit: 0.25

rounds_5_9:
  VORP: 0.55
  roster_fit: 0.45

rounds_10_14:
  VORP: 0.35
  roster_fit: 0.65
```

---

# 8. Roster Penalties

Do not hard-code positional sequences.

But penalize roster fragility.

Example:

```text
RosterPenalty(p) =
    overfill_penalty
  + starter_hole_penalty
  + low_ceiling_bench_penalty
```

## Starter-hole penalty

As draft nears completion:

```text
remaining_picks < remaining_required_starters + 2
```

heavily penalize candidates that do not help fill required legal starters.

## K / DST

Until late rounds:

```text
K/DST penalty = high
```

unless their league-adjusted VORP is genuinely exceptional.

Suggested:

```yaml
rounds_1_8:
  K: -5.0 z-score units
  DST: -4.0

rounds_9_11:
  K: -2.0
  DST: -1.5

rounds_12_plus:
  K: 0
  DST: 0
```

These are guardrails and should be removable if exact league scoring proves otherwise.

---

# 9. Algorithm 4 — Family Affair Market Model

We do not need a full hierarchical Bayesian model tomorrow.

Use a calibrated scoring model for expected pick.

## Base expected pick

```text
BaseExpectedPick(p)
    = weighted average of:
      current CBS ADP
      FantasyPros ADP/ECR acquisition signal
      other current market ADP
```

Suggested weights if all exist:

```yaml
CBS_ADP: 0.50
FantasyPros_ADP: 0.30
OtherMarketADP: 0.20
```

FantasyPros ECR should influence player quality, but ADP is the cleaner acquisition-cost signal.

---

# 10. Historical Family Affair Position Adjustment

From 2019–2025 history, create recency-weighted position aggressiveness.

For each position:

```text
LeaguePositionBias(pos)
    = mean(
        actual_family_affair_pick
        - outside_market_expected_pick
      )
```

If historical outside-market ADP is unavailable before draft, use a simpler prior:

```text
recent Family Affair Round-1 position share
vs
current market Round-1 position share
```

Then cap the adjustment.

```text
PositionAdjustment ∈ [-5, +5] picks
```

Never let limited history shift expected pick by 15 positions.

---

# 11. Manager-Specific Adjustment

For managers drafting before the user's next turn, estimate simple tendencies.

For manager `m`, position `pos`:

```text
ManagerAffinity(m, pos)
    = smoothed historical share of early picks at pos
```

Laplace/Beta-style shrinkage:

```text
smoothed_rate
    = (manager_count + k * league_rate)
      / (manager_total + k)
```

Use:

```text
k = 8
```

This ensures a few historical picks cannot dominate.

For V1, manager adjustment only needs to affect the probability a **position/tier** is taken.

Do not attempt exact per-player manager choice models.

---

# 12. Live Draft Market Update

After every pick, update two fast statistics:

## Position run

For last 6 picks:

```text
RunIntensity(pos)
    = count(position == pos) / 6
```

Compare with expected share.

```text
RunShock(pos)
    = observed_share - expected_share
```

Cap adjustment:

```text
RunPickAdjustment ∈ [-3, +3]
```

## Tier depletion

If a position tier had `n` players and only `r` remain:

```text
TierUrgency = 1 - r/n
```

This feeds the survival model and optimizer.

---

# 13. Player Survival Model

We need:

```text
P(player survives until my next pick)
```

This is the most important live algorithm beyond raw value.

## V1 survival calculation

Let:

```text
gap = number of selections before user's next pick
mu = ExpectedPick(player)
sigma = PickUncertainty(player)
```

Approximate player draft position:

```text
DraftPick ~ Normal(mu, sigma)
```

Then:

```text
P(survive next)
    = P(DraftPick >= next_user_pick | player still available)
```

Use a conditional truncated distribution because the player has survived to the current pick.

Pseudo:

```python
def survival_prob(mu, sigma, current_pick, next_pick):
    F_current = normal_cdf(current_pick, mu, sigma)
    F_next = normal_cdf(next_pick, mu, sigma)

    # conditional probability that selection occurs at/after next_pick
    denom = max(1e-9, 1 - F_current)
    return max(0, min(1, (1 - F_next) / denom))
```

## Sigma

Use ADP uncertainty if available.

Otherwise:

```yaml
top_24: 5
25_60: 8
61_100: 12
101_plus: 18
```

Increase sigma for:
- rookies;
- injured/questionable players;
- rapidly changing news.

---

# 14. Manager/Tier Survival Correction

The Normal survival prior is adjusted by the actual managers selecting before the next user pick.

For candidate `p` with position `pos`:

```text
hazard_multiplier =
    product over intervening managers:
      (1 + manager_pos_affinity_adjustment)
```

Simpler stable implementation:

```text
manager_pressure
    = average normalized affinity(pos)
      among intervening managers

survival_logit =
    logit(base_survival)
    - 0.70 * manager_pressure
    - 0.60 * run_shock(pos)
    - 0.80 * tier_urgency(pos)
```

Then:

```text
AdjustedSurvival = sigmoid(survival_logit)
```

Coefficients are initial heuristics.

Cap each live correction to prevent pathological behavior.

---

# 15. Urgency Value

The value of selecting a player now instead of waiting:

```text
UrgencyValue(p)
    = (1 - P_survive_next(p))
      * LossIfGone(p)
```

Estimate:

```text
LossIfGone(p)
    = Value(p)
      - ExpectedBestAlternativeAtPositionNextPick(p)
```

V1 alternative:

Take the top remaining same-position player expected to survive to the next user pick.

Thus:

```text
UrgencyValue
    = GoneProbability
      * ExpectedTierDrop
```

This captures option value without full dynamic programming.

---

# 16. Market Mispricing

Define two ranks:

```text
FundamentalRank(p)
MarketRank(p)
```

Then:

```text
RankEdge(p)
    = MarketRank(p) - FundamentalRank(p)
```

Positive = player is cheaper than the model thinks he should be.

Standardize:

```text
MarketMispricingZ
    = RankEdge / 12
```

Cap:

```text
[-2.0, +2.0]
```

Do not double-count market value and survival.

Market mispricing is a smaller secondary term.

---

# 17. Upside Adjustment

Late rounds should favor asymmetric payoff.

Use stored weekly distribution:

```text
UpsideScore(p)
    = 0.5 * z(P90_weekly)
      + 0.5 * z(prob_25_plus)
```

Early rounds:

```text
UpsideWeight = 0.10
```

Middle:

```text
0.20
```

Late:

```text
0.40
```

For rounds 10+ also reward contingent opportunity:

```text
handcuff / ambiguous-backfield / rookie-growth bonus
```

Only if represented by structured feature data.

Do not use LLM intuition to generate the bonus.

---

# 18. Uncertainty Penalty

Early draft picks should not chase model noise.

For candidate:

```text
UncertaintyPenalty
    = z(projection_source_dispersion)
```

Weights:

```yaml
rounds_1_4: 0.25
rounds_5_9: 0.10
rounds_10_14: -0.05
```

The negative late-round value means uncertainty can become desirable when replacement cost is low.

---

# 19. Algorithm 5 — Final Fast Sequential Pick Optimizer

For every serious candidate:

```text
Score(p)
    = w1 * RosterGainZ(p)
      + w2 * UrgencyZ(p)
      + w3 * MarketMispricingZ(p)
      + w4 * UpsideZ(p)
      - w5 * RosterPenaltyZ(p)
      - w6 * UncertaintyZ(p)
```

## Recommended weights

### Rounds 1–4

```yaml
RosterGain: 0.55
Urgency: 0.25
MarketMispricing: 0.08
Upside: 0.07
RosterPenalty: 0.05
UncertaintyPenalty: 0.15
```

### Rounds 5–9

```yaml
RosterGain: 0.45
Urgency: 0.30
MarketMispricing: 0.08
Upside: 0.15
RosterPenalty: 0.10
UncertaintyPenalty: 0.08
```

### Rounds 10–14

```yaml
RosterGain: 0.30
Urgency: 0.20
MarketMispricing: 0.05
Upside: 0.35
RosterPenalty: 0.20
UncertaintyPenalty: -0.05
```

Weights need not sum to 1 because terms are standardized.

---

# 20. Candidate Set

Do not score every player deeply under the clock.

Create candidate union:

```text
top 8 by fundamental value
top 5 by VORP
top 5 by urgency
top 5 by market mispricing
top 5 by upside
```

Deduplicate.

Usually 10–20 candidates.

This is trivial to compute live.

---

# 21. Two-Turn Lookahead

This is the most valuable extra algorithm we can afford.

For each candidate `p` now:

1. assume we draft `p`;
2. remove likely opponent picks probabilistically until next user pick;
3. estimate best available player then;
4. calculate two-pick sequence value.

No full-season Monte Carlo.

## Deterministic expected lookahead

For every other player `q`:

```text
ExpectedAvailabilityValue(q)
    = P_survive_next(q) * Value(q)
```

At next turn estimate:

```text
NextPickValue(p)
    = max_q ExpectedAvailabilityValue(q | roster+p)
```

Then:

```text
TwoTurnScore(p)
    = ImmediateScore(p)
      + lambda * NextPickValue(p)
```

Suggested:

```text
lambda = 0.55
```

This single-step lookahead captures much of the benefit of a complex dynamic program.

---

# 22. Improved Two-Turn Lookahead — 100 Mini Rollouts

If performance allows:

For each top 8 candidate:

Run only `N = 100` draft-to-next-turn rollouts.

Each intervening manager:
1. draw position from simple manager/tier distribution;
2. select highest market-ranked available player at that position with noise;
3. continue until user's next pick.

Then record best resulting roster value at next user pick.

```text
LookaheadValue(p)
    = average best-next-pick value across 100 rollouts
```

Use common random seeds across candidates.

This should execute extremely fast in Python.

If >1.5 sec, fall back to deterministic expected lookahead.

---

# 23. Opponent Pick Policy for Mini Rollouts

For manager `m`:

```text
PositionScore(pos)
    = 0.45 * market_best_at_position
      + 0.25 * roster_need
      + 0.20 * manager_affinity
      + 0.10 * run_pressure
```

Choose position with softmax temperature:

```text
T = 0.8
```

Then select among top 3 market players at that position:

```text
70% best
20% second
10% third
```

This is intentionally simple.

Do not claim it is a calibrated behavioral model.

Its purpose is merely better lookahead than assuming pure ADP order.

---

# 24. Final V1 Recommendation

```text
FinalScore(p)
    = ImmediateScore(p)
      + 0.55 * z(LookaheadValue(p))
```

Rank descending.

Recommendation:

```text
#1 player = PICK
#2–#4 = alternatives
```

---

# 25. Confidence

Do not generate arbitrary "87%" confidence.

Use score separation.

Let:

```text
gap = Score_1 - Score_2
```

Compute across all candidate scores:

```text
score_sd
```

Then:

```text
separation = gap / score_sd
```

Map:

```yaml
separation < 0.10: CLOSE CALL
0.10-0.25: LOW
0.25-0.50: MODERATE
0.50-0.90: HIGH
>0.90: VERY HIGH
```

UI can display labels.

If a percentage is desired, use only a cosmetic bounded mapping and label it "decision confidence," not probability of being correct.

---

# 26. Reason Codes

The numerical system emits structured reasons.

Maximum 3:

```text
VALUE_GAP
WONT_SURVIVE
POSITION_CLIFF
LEAGUE_DISCOUNT
SCORING_EDGE
ROSTER_NEED
UPSIDE
TIER_DEPTH
```

Generate explanations from templates:

```text
WONT_SURVIVE:
"Only {survival_pct}% chance to reach your next pick."

LEAGUE_DISCOUNT:
"Family Affair is drafting this position later than its league-adjusted value."

POSITION_CLIFF:
"The next comparable {position} projects {delta} points lower."
```

No LLM required.

---

# 27. Data Freshness

Every external dataset stores:

```text
source
fetched_at
season
version/hash
```

Recommendation UI shows:

```text
FantasyPros: 23 min old
CBS state: LIVE
Model: v1.0.3
```

If cache stale:
- continue;
- lower confidence;
- do not block.

---

# 28. Fallback Ladder

If lookahead errors:

```text
ImmediateScore
```

If survival model errors:

```text
RosterGain + market mispricing + upside
```

If custom projection layer errors:

```text
Family Affair-scored FantasyPros/raw projection
```

If all else fails:

```text
league-adjusted VORP
```

The user always gets a pick.

---

# 29. Required Tests Before Draft

## Scoring

Boundary tests:

```text
passing: 249, 250, 299, 300, 399, 400
rushing: 99, 100, 149, 150, 199, 200
receiving: same
receptions: 3, 4, 6, 7, 9, 10
TD distance: 29, 30, 39, 40, 49, 50
FG distance equivalents
```

## Draft state

- no duplicate player;
- snake order correct;
- pick #4 user slot correct;
- undo restores exact state;
- manual correction works.

## Survival

Properties:

```text
P(survive next) in [0,1]
later next pick => weakly lower survival
earlier expected ADP => weakly lower survival
higher sigma => probability moves toward uncertainty
```

## Optimizer

- if candidate A dominates B on every input, B cannot outrank A;
- removing urgency weight returns value-heavy ordering;
- no K/DST early unless guardrail disabled;
- legal roster still achievable before final pick.

---

# 30. Baselines

Before shipping, compare V1 against:

```text
A. FantasyPros ECR
B. current ADP
C. league-adjusted projected points
D. static VORP
```

The purpose of the test is not to prove long-run championship superiority by tomorrow.

It is to ensure the optimizer produces sensible decisions and that each added component changes picks for a mathematically identifiable reason.

---

# 31. Historical Replay — Fast Version

Use the supplied 2019–2025 Round-1 data immediately.

For every historical pick:

1. construct remaining player pool if historical ADP snapshot is available;
2. test whether Family Affair market model gives greater probability to actual position than a generic model;
3. evaluate manager affinity calibration.

If historical ADP snapshots are not available in time, do **not** block production.

Use the history only as a shrunk positional/manager prior.

---

# 32. Implementation Order for Claude

Claude should execute exactly this order:

## Hour 1
- league config;
- scoring engine;
- tests.

## Hour 2
- player schema;
- FantasyPros/raw projection ingestion;
- Family Affair scoring transformation.

## Hour 3
- VORP;
- flex-aware roster optimizer;
- fundamental ranking.

## Hour 4
- ADP market model;
- survival model;
- historical manager/position priors.

## Hour 5
- final pick scoring;
- two-turn lookahead;
- reason codes.

## Hour 6
- draft state;
- manual input;
- simple UI.

## Hour 7
- CBS live adapter if feasible/permitted;
- otherwise improve manual input.

## Hour 8
- mock drafts;
- latency;
- bugs;
- freeze.

If implementation needs more time, cut CBS automation before cutting the decision engine.

Manual draft-state entry is acceptable.

A weak model with a perfect connector is not.

---

# 33. Minimal API Contract

```text
GET /draft/state
POST /draft/pick
POST /draft/undo
GET /recommendation
GET /players
GET /health
```

Recommendation response:

```json
{
  "pick_number": 4,
  "recommended_player_id": "internal-id",
  "recommended_player_name": "Example Player",
  "position": "RB",
  "decision_confidence": "HIGH",
  "score": 2.14,
  "survival_to_next_pick": 0.12,
  "reasons": [
    "WONT_SURVIVE",
    "VALUE_GAP",
    "POSITION_CLIFF"
  ],
  "alternatives": [
    {
      "player_id": "...",
      "score": 1.82,
      "survival_to_next_pick": 0.68
    }
  ]
}
```

---

# 34. What Claude Must Not Research

Claude should **not** stop implementation to debate:

- optimal Bayesian prior family;
- whether Gamma or lognormal is theoretically best;
- exact DFS covariance literature;
- reinforcement-learning formulation;
- full championship-equity simulation;
- neural choice models.

Those are Phase 2.

For tomorrow, implement this specification literally unless tests expose a contradiction.

---

# 35. Quantitative Rationale

Why this V1 is strong:

- exact league scoring captures the largest obvious source of market error;
- robust projection consensus reduces source-specific error;
- state-dependent VORP captures positional scarcity;
- flex-aware roster gain avoids rigid draft strategies;
- survival probability prices acquisition timing;
- historical Family Affair priors adapt to this actual room;
- live run/tier updates react to current behavior;
- one-turn stochastic lookahead captures sequential option value;
- upside weighting changes rationally with round;
- all components are interpretable and fast.

It sacrifices theoretical elegance for robustness under the actual time constraint.

That is the correct engineering trade.

---

# 36. Phase-2 Algorithms After the Draft

Preserve the longer roadmap:

1. calibrated weekly joint distributions;
2. correlated team/game simulation;
3. full-season playoff/championship simulator;
4. hierarchical multinomial opponent model;
5. fitted survival model;
6. approximate dynamic programming/oracle draft policy;
7. policy distillation into low-latency model;
8. in-season waiver/trade optimizer.

But none of these should block the 2026 V1.

---

# 37. Claude Instruction

Use this exact instruction:

> Implement `15_DRAFT_EDGE_2026_FAST_CORE_ALGORITHMS.md` as the governing production algorithm for the August 30 draft. Do not redesign it into a research project. Build the five algorithms in the stated order, write the required tests, and preserve the fallback ladder. The live recommendation path must remain deterministic and must not call an LLM. Where a coefficient is explicitly described as an initial heuristic, put it in configuration so it can be changed without code edits. If an external integration threatens the schedule, preserve manual draft-state entry and finish the quantitative engine first.
