# 03 — Decision Algorithms (implementation-ready)

Five algorithms + a final combiner. All coefficients below go in `config/model.yaml`
so they're tunable without code edits. Do NOT turn this into a research project —
implement it literally unless a test exposes a contradiction. Phase-2 ideas
(oracle sim, MCMC, correlated MC, RL, policy distillation) are explicitly deferred.

## Objective (robust draft utility, not championship prob)
```
PickScore(p) = w_roster * z(RosterGain)
             + w_urg    * z(Urgency)
             + w_mkt    * z(MarketMispricing)
             + w_up     * z(Upside)
             - w_pen    * z(RosterPenalty)
             - w_unc    * z(UncertaintyPenalty)
```
The terms are NOT equally weighted after z-scoring. Weights are **round-stage
dependent** (early: fundamentals dominate; late: upside dominates). Use exactly this
table (put it in `config/model.yaml`; do not invent your own):

| Draft stage | RosterGain | Urgency | Market | Upside | RosterPenalty | Uncertainty |
|---|---|---|---|---|---|---|
| **R1–4**   | 0.55 | 0.25 | 0.08 | 0.07 | 0.05 |  0.15 |
| **R5–9**   | 0.45 | 0.30 | 0.08 | 0.15 | 0.10 |  0.08 |
| **R10–14** | 0.30 | 0.20 | 0.05 | 0.35 | 0.20 | -0.05 |

The **negative** Uncertainty weight in R10–14 is intentional: late in the draft some
uncertainty is valuable because you're hunting asymmetric (high-ceiling) bench
outcomes, so variance is rewarded, not penalized. Do not "fix" it to positive.

### Candidate generation (define the set BEFORE standardizing)
z-scores depend on the population, so the candidate set must be fixed and explicit —
otherwise a player's score can move just because a low-quality candidate enters/leaves
the pool. Build the candidate pool as the **union** of:
```
top 8  by Fundamental Value
top 5  by VORP
top 5  by Urgency
top 5  by Market Mispricing
top 5  by Upside
```
Deduplicate; exclude illegal/unavailable players (already drafted, or can't fill a
legal roster slot). Compute all six component values over this fixed union, then
standardize, then rank to the final shortlist (top 8 also feed the lookahead below).

### Robust, frozen standardization
Standardize each component with **median/MAD** (or a winsorized mean/SD) rather than
raw mean/SD, so one outlier candidate can't distort the scale. **Freeze the
transformation for a given draft state** (persist the centering/scaling params in the
audit snapshot, §Audit). A recommendation must not materially change merely because
the normalization population shifted; it should change only when a player's underlying
value or the draft state changes.

## Alg 1 — Exact scoring engine  (DONE: core/scoring.py)
Score raw weekly stat lines under Family Affair rules. Never use generic fantasy
points when raw stats are available.

## Alg 2 — Projection ensemble + weekly distribution  (precompute)
- **ProjectionProvider architecture:** `FantasyProsProvider` is REQUIRED — it's the
  authoritative raw-stat source for tomorrow's build. `RotoWireProvider`,
  `CBSProjectionProvider`, and any `OtherProvider` are OPTIONAL and only wired in if
  it's clean and takes under ~30-45 min; don't burn hours chasing a fake ensemble.
  Each provider implements the same interface (per-player per-stat raw projections),
  so adding one later never touches the scoring/optimizer layers.
- **Ensemble by source count N** (don't winsorize tiny samples — Q10/Q90 isn't
  meaningful with 2-3 points):
  ```
  N = 1: use the source value directly (FantasyPros alone is expected for V1)
  N = 2: weighted mean (FantasyPros 0.40, other 0.60 — or equal if quality unknown)
  N = 3: weighted median/mean across sources — NO winsorization
  N >= 4: optional winsorization to [Q10,Q90], then weighted aggregate
  ```
  Store on every player: `projection_source_count`, `projection_disagreement`
  (spread across sources when N>=2, else null), `source_timestamp`. This gives
  uncertainty a factual basis instead of an invented one.
- **Weekly distribution:** `weekly_mean = season_proj / games`;
  `weekly_sd = weekly_mean * CV`. Approximate each positive stat with Gamma/lognormal.
  Initial CVs (priors, replace with empirical if time):
  ```yaml
  QB: {pass_yards: 0.25, pass_td: 0.65, rush_yards: 0.80, rush_td: 1.80}
  RB: {rush_yards: 0.50, receptions: 0.65, rec_yards: 0.80, total_td: 1.35}
  WR: {receptions: 0.55, rec_yards: 0.65, total_td: 1.50}
  TE: {receptions: 0.60, rec_yards: 0.70, total_td: 1.55}
  ```
- **Within-player stat coherence (do this in V1 if time allows; it's the #1 math
  enhancement — ahead of nflverse/RL):** because scoring is nonlinear, treating a
  player's stats as independent distorts value at the thresholds. Introduce a shared
  weekly latent volume so related stats move together:
  ```
  VolumeFactor ~ LogNormal(mu=0, sigma_pos)   # one draw per player-week
  receptions_mean_wk = base_receptions * VolumeFactor
  rec_yards_mean_wk  = base_rec_yards  * VolumeFactor
  td_lambda_wk       = base_td_lambda  * f(VolumeFactor)
  # QB: pass_yards & pass_TD share the latent; RB: rush volume & rec involvement share it
  ```
  This yields far more realistic P(7/10 receptions), P(100/150/200 yds), and multi-TD
  games — which is exactly what your thresholds reward. If time is too short, keep the
  independent-CV model but mark this as the first enhancement to add post-draft.
- **Monte Carlo (offline):** N=2000 weekly draws/player, score each with Alg 1,
  store: mean/median weekly FP, p10/p25/p75/p90, sd, prob_20+/25+/30+. Store in
  players.json. **Live never resimulates.**

## Season value
```
ExpectedSeasonPoints = ExpectedWeeklyPoints * ExpectedGames
RiskAdjusted = ExpectedSeasonPoints - injury_penalty
injury_penalty = ExpectedSeasonPoints * P(miss_material_time) * 0.25
```
If no calibrated injury prob available, omit the penalty (don't invent one).

## Alg 3 — Dynamic replacement value (VORP) + flex-aware roster gain
Starter demand (12 teams): QB12, RB24, WR24, TE12, RWT12(dynamic across RB/WR/TE),
K12, DST12. For each position, sort AVAILABLE players by league-adjusted value;
replacement = value at the expected-remaining-starter-demand index.
`VORP(p) = Value(p) - ReplacementValue(pos)`.

Flex-aware gain: add p to your roster, solve best legal starting lineup
(assignment over QB/RB×2/WR×2/TE/RWT/K/DST), compare to lineup value without p:
```
CurrentRosterGain(p) = BestLineup(roster+p) - BestLineup(roster)
RosterGain(p) = w_vorp*VORP(p) + w_fit*CurrentRosterGain(p)
```
Weights shift by round:
```yaml
rounds_1_4:  {vorp: 0.75, fit: 0.25}
rounds_5_9:  {vorp: 0.55, fit: 0.45}
rounds_10_14:{vorp: 0.35, fit: 0.65}
```

## Roster penalties (fragility, not hardcoded sequences)
`RosterPenalty = overfill + starter_hole + low_ceiling_bench`.
When `remaining_picks < remaining_required_starters + 2`, heavily penalize
candidates that don't fill a required legal starter.
K/DST: model both under exact Family Affair scoring (K: attempts, accuracy, team
scoring environment, long-FG attempts/makes if available; DST: sacks, INTs, forced/
recovered fumbles, points-allowed expectation, defensive/ST TD expectation) — then
shrink heavily toward replacement, since year-to-year K/DST predictability is weak.
Never fabricate FG-distance or DST sub-components absent from the source data; if
distance splits aren't available, use the generic projection + a small long-leg/
team-environment adjustment. Apply guardrails by default, but make them
**overridable when league-adjusted VORP is exceptional** — an early K/DST pick
should only ever surface if the model has real conviction, not routine noise:
```yaml
rounds_1_8:  {K: -5.0, DST: -4.0}   # z-score units, applied unless override fires
rounds_9_11: {K: -2.0, DST: -1.5}
rounds_12_plus: {K: 0, DST: 0}
guardrail_override:
  # guardrail is skipped only if VORP(K/DST) clears this z-score bar
  exceptional_vorp_z: 1.5
```

## Alg 4 — Market model + survival
- **Base expected pick:** weighted ADP: CBS_ADP 0.50, FantasyPros_ADP 0.30,
  OtherMarketADP 0.20 (renormalize over what exists). ECR informs quality, ADP is
  the acquisition-cost signal.
- **Family Affair position bias** (from history, recency-weighted; see docs/05):
  cap the pick adjustment to [-5, +5]. Never let thin history swing 15 picks.
- **Manager affinity** (for managers picking before your next turn), Beta-shrunk:
  `smoothed = (mgr_count + k*league_rate)/(mgr_total + k)`, `k=8`. V1: affects the
  probability a position/tier is taken, not per-player choice.
- **Live updates each pick:** position run over last 6 (`RunShock = observed −
  expected`, cap [-3,+3]); tier depletion `TierUrgency = 1 − remaining/initial`.
- **Survival** (most important live number):
  ```python
  # gap = selections before your next pick; DraftPick ~ Normal(mu, sigma), mu=ExpectedPick
  def survival_prob(mu, sigma, current_pick, next_pick):
      F_cur = normal_cdf(current_pick, mu, sigma)
      F_next = normal_cdf(next_pick, mu, sigma)
      return max(0, min(1, (1 - F_next) / max(1e-9, 1 - F_cur)))  # conditional on still available
  ```
  Sigma if ADP uncertainty unknown: top_24:5, 25–60:8, 61–100:12, 101+:18. Increase
  for rookies / injured / fast-changing news. Then correct with the room:
  ```
  survival_logit = logit(base) - 0.70*manager_pressure - 0.60*run_shock(pos) - 0.80*tier_urgency(pos)
  AdjustedSurvival = sigmoid(survival_logit)   # cap each correction
  ```

## Alg 5 — Sequential pick optimizer (survival-aware lookahead) — HIGH VALUE
This is one of the largest sources of edge in the whole system. The question is not
"who has the highest score?" but **"which player should I take NOW given what I'm
likely to lose before my next turn and what I'm likely to be able to get then?"**
Do not weaken this.

For each of the **top 8 shortlist candidates**, simulate opponents to your next pick,
take your best available response there, and average its value across rollouts using
**common random numbers** (the SAME opponent-behavior random draws across all
candidates, so differences reflect the candidate choice, not RNG noise):
```
LookaheadValue(p) = mean over rollouts of [ best-available-response-value at your next pick,
                                            given you took p now and opponents then picked ]
FinalScore(p) = ImmediateScore(p) + 0.55 * z(LookaheadValue(p))
```

### Rollout budget — adaptive, CRN (restore the strong design)
```
Primary:            500 common-random-number rollouts per candidate
Adaptive fallback:  500 → 250 → 100 → deterministic expected lookahead
Latency budget:     target < 1.0s   |   hard ceiling 1.5s
```
8 candidates × 500 lightweight opponent rollouts ≈ 4,000 tiny simulations with NO
season simulation (just opponent pick draws over precomputed player data) — trivial in
TypeScript if implemented efficiently (flat typed arrays, preallocated buffers, shared
CRN stream). Step the budget down only if you exceed the latency budget for that draft
state; **never drop below deterministic survival-aware lookahead** — the sequential
term must always be present in some form.

### Precompute while you wait
Whenever the user is **2–3 picks away**, precompute the recommendation states in the
background so the answer is already on screen the instant it's their turn (60s clock).
Persist the result + inputs in the audit snapshot (§Audit).

Opponent policy for rollouts (simple, not claimed calibrated):
```
PositionScore(pos) = 0.45*market_best_at_pos + 0.25*roster_need
                   + 0.20*manager_affinity + 0.10*run_pressure
choose pos via softmax(T=0.8); then top-3 market players at pos: 70/20/10.
```

## Rank separation — never blend fundamental value with market consensus
Every player carries two DISTINCT ranks, computed independently and never merged
before the optimizer runs:
- **FundamentalRank** — pure Family Affair value (from Alg 1-3: scoring + VORP +
  roster fit). This is "how good is this player under our exact rules."
- **LeagueMarketRank / ExpectedPick** — from Alg 4 (ADP + Family Affair history +
  manager affinity + live run/tier signals). This is "when will the room take them."
A player can legitimately be #7 FundamentalRank but #22 LeagueMarketRank — that gap
IS the edge (a falling player). Keeping the ranks separate (rather than pre-blending
market into value) lets Draft Edge deliberately exploit that gap instead of
accidentally treating consensus as truth. Surface both ranks + VORP + P_survive_next
in the UI and audit snapshot (§Audit, §UI).

## DO_NOT_REACH — model-risk sanity bound, not a hard ADP rule
This does not prevent contrarian picks; it protects against a data bug, ID
mismatch, broken projection, or malformed scoring input silently driving a reach.
If the recommended player's LeagueMarketRank is ~30+ picks ahead of every
meaningful market source relative to the current pick, require at least one of
`SCORING_EDGE`, `POSITION_CLIFF`, or `WONT_SURVIVE` to exceed a configured
threshold to justify it. If none clear the bar, don't suppress the pick — instead
flag it `MODEL DISAGREEMENT — REVIEW` in the UI and show the runner-up alongside it
so the human makes the final call in the moment.

## Confidence (from separation, not fake %)
`gap = Score1 − Score2`; `separation = gap / score_sd`.
`<0.10 CLOSE CALL · 0.10–0.25 LOW · 0.25–0.50 MODERATE · 0.50–0.90 HIGH · >0.90 VERY HIGH`.

## Reason codes (max 3, template-filled, no LLM)
`VALUE_GAP · WONT_SURVIVE · POSITION_CLIFF · LEAGUE_DISCOUNT · SCORING_EDGE ·
ROSTER_NEED · UPSIDE · TIER_DEPTH · MODEL_DISAGREEMENT`. Examples:
- WONT_SURVIVE: "Only {survival_pct}% chance to reach your next pick."
- POSITION_CLIFF: "Next comparable {pos} projects {delta} pts lower."
- LEAGUE_DISCOUNT: "Family Affair drafts this position later than its value."

## Audit — persist a decision snapshot for every recommendation (high value, low code)
Every time the recommendation changes, persist a snapshot (to KV `draft:audit` list
and/or append-only `audit.jsonl`). This makes the engine reproducible, lets us
diagnose a weird pick instantly, and later lets us evaluate whether Draft Edge made
GOOD decisions (not just whether a player happened to work out).
```json
{
  "pick": 28,
  "state_hash": "sha256 of canonical draft state",
  "model_version": "1.0.0",
  "recommended_player": "player-id",
  "fundamental_rank": 7,
  "league_market_rank": 22,
  "expected_pick": 34,
  "final_score": 1.84,
  "runner_up": "player-id",
  "score_gap": 0.31,
  "survival_next": 0.14,
  "do_not_reach_flag": false,
  "projection_source_count": 1,
  "projection_disagreement": null,
  "data_freshness": "GREEN",
  "roster_gain": 1.22,
  "urgency": 0.81,
  "market": 0.18,
  "upside": 0.42,
  "lookahead_value": 0.67,
  "rollouts": 500,
  "seed_bundle": "CRN seed set id (so the exact rollouts can be replayed)",
  "standardization": {"method": "median_mad", "center": {}, "scale": {}},
  "stage_weights": {"roster": 0.30, "urgency": 0.20, "market": 0.05, "upside": 0.35, "penalty": 0.20, "uncertainty": -0.05},
  "reasons": ["WONT_SURVIVE", "POSITION_CLIFF", "VALUE_GAP"]
}
```
Record the frozen standardization params and stage weights so a snapshot fully
reproduces the decision. `seed_bundle` lets the CRN rollouts be replayed exactly.
