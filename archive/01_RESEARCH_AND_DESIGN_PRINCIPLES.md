# Research and Design Principles

## 1. What the Evidence Supports

### 1.1 Ensemble forecasts should be the prior

No single expert or projection source is reliably dominant across seasons, positions, and weeks. FantasyPros maintains separate preseason and in-season accuracy competitions and the leaderboards vary by year and task. This is evidence against building the system around a single forecaster.

Use:
- consensus projections;
- expert ranking dispersion;
- historical expert accuracy as a modest feature;
- independent football-usage models;
- market prices / ADP.

Do not over-weight last year's #1 expert.

### 1.2 League-specific scoring dominates generic ranks

If scoring is unusual, player value must be rebuilt from projected football statistics.

For player `i` with projected stat vector `x_i` and league scoring vector `w`:

\[
FP_i = w^\top x_i + b_i
\]

where `b_i` includes bonuses, thresholds, penalties, return-yard rules, first-down bonuses, TE premiums, long-play bonuses, etc.

Generic ECR should only enter later as market information.

### 1.3 Expected opportunity is more stable than raw fantasy outcomes

The ffverse `ffopportunity` project applies XGBoost to nflverse play-by-play to estimate expected fantasy points from opportunities.

The system should distinguish:
- realized fantasy output;
- opportunity quality/volume;
- efficiency above/below expectation.

This is particularly important for in-season breakout detection.

### 1.4 Simulation is useful, but simulation output is not automatically truth

`ffsimulator` demonstrates the value of bootstrap-based season simulation, optimal-lineup calculation, replacement levels, actual schedules, and trade evaluation.

However, a draft optimizer needs more:
- correlated player distributions;
- opponent drafting;
- future acquisitions;
- role uncertainty;
- playoff rules;
- calibration;
- variance reduction.

### 1.5 Top-heavy objectives imply that ceiling and covariance matter

Academic DFS optimization work demonstrates that when the payoff is top-heavy, maximizing mean alone may be suboptimal; variance and correlation can matter.

Season-long fantasy is not identical to DFS, but a championship objective is also nonlinear. Therefore:
- mean points cannot be the only objective;
- roster covariance matters;
- tail outcomes should be modeled;
- downside and robustness constraints are still needed.

### 1.6 The draft is a market, not a static ranking exercise

ADP answers:
> What does the broader market tend to pay?

Live draft behavior answers:
> What is this particular league paying now?

The engine should maintain both:
- global market prior;
- league-specific posterior.

The edge comes from discrepancies.

---

## 2. What Existing Systems Should Contribute

### nflverse

Use for:
- play-by-play;
- historical player/team data;
- schedule data;
- NFL season context;
- reproducible raw data.

### ffopportunity

Use as:
- benchmark expected-opportunity model;
- feature source;
- model-design reference.

Do not assume its historical XGBoost model is optimal for 2026. Retrain or benchmark against newer data.

### ffsimulator

Use as:
- reference implementation for fantasy-season simulation;
- lineup optimization patterns;
- replacement logic;
- bootstrap concepts.

Do not directly treat its small-simulation defaults as sufficient for live decision ranking.

### ffanalytics

Use as:
- reference for multi-source projections;
- uncertainty from projection dispersion;
- custom scoring;
- ADP/ECR integration.

Avoid relying on scraping behavior if a source provides a licensed API.

### FantasyPros API

Use, if the user's subscription/API entitlement permits, for:
- players;
- external IDs including CBS IDs;
- ECR/rankings;
- projections;
- injuries;
- news;
- expert comparisons.

FantasyPros public documentation currently exposes CBS external IDs in player metadata, which is valuable for identity resolution.

### FantasyPros Draft Assistant

Treat as:
- a useful comparison baseline;
- evidence that CBS live draft synchronization is technically feasible.

Do not attempt to reverse engineer proprietary FantasyPros sync internals.

---

## 3. Anti-Patterns

Do not:

- hardcode Zero RB, Hero RB, Robust RB, Late Round QB, or any other doctrine;
- optimize one pick without modeling future picks;
- maximize total projected points and call it championship optimization;
- use ADP as value;
- assume replacement level is fixed throughout a draft;
- assume league mates draft rationally;
- assume every expert error is independent;
- treat projected player outcomes as Gaussian by default;
- present simulation deltas without Monte Carlo error;
- use independent weekly player simulations where common game/team shocks matter;
- assume a drafted roster will start the mathematically optimal lineup every week;
- overfit opponent profiles after two picks;
- let a brittle CBS connector become a single point of failure.

---

## 4. Modeling Hierarchy

The system should reason in this hierarchy:

1. Football statistical outcomes
2. League scoring transformation
3. Weekly player fantasy distributions
4. Rest-of-season distributions
5. Positional replacement distributions
6. Roster weekly scoring distributions
7. Draft acquisition market
8. Opponent behavior
9. Future draft paths
10. Season standings
11. Playoffs
12. Championship utility

Every level should be testable independently.

---

## 5. Final Decision Philosophy

A player is not intrinsically "the best pick."

A pick is good only relative to:
- this league;
- this roster;
- this pick number;
- the remaining player pool;
- the managers between this pick and the next;
- future positional cliffs;
- player outcome uncertainty;
- the value of preserving options.

Therefore, recommendations must always be state-dependent.
