# Backtesting, Validation, and QA

## 1. Fundamental Rule

No component enters production because it sounds smart.

It must outperform a simpler baseline out of sample.

---

# 2. Time-Safe Evaluation

For historical season `Y`, predictions may use only information available before the evaluated timestamp.

Examples:
- preseason model cannot use Week 1 snap shares;
- Week 4 model cannot use Week 5 injury news;
- opponent model cannot see future draft selections.

All data must be timestamped.

---

# 3. Baselines

Every evaluation must compare against:

1. FantasyPros ECR highest available
2. ADP highest available
3. static VBD
4. league-adjusted projected points
5. league-adjusted VORP
6. heuristic scarcity model
7. fast policy without opponent model
8. full proposed policy

This allows attribution of value.

---

# 4. Projection Metrics

Evaluate:
- MAE;
- RMSE;
- Spearman rank correlation;
- weighted rank error around starter thresholds;
- pinball loss for quantiles;
- CRPS for full distributions;
- calibration curves;
- coverage of 50%, 80%, 90% intervals.

Stratify by:
- position;
- rookie/veteran;
- projection tier;
- week;
- injury status;
- role stability.

---

# 5. Survival Model Metrics

For predictions:

\[
P(player\ survives\ to\ pick\ k)
\]

evaluate:
- Brier score;
- log loss;
- calibration;
- discrimination/AUC where appropriate.

Calibration matters more than ranking alone.

If 100 players are assigned 70% survival, approximately 70 should survive.

---

# 6. Opponent Model Evaluation

Replay historical drafts.

Compare:
- generic ADP model;
- roster-aware global model;
- league-posterior model;
- manager-specific posterior model.

Metrics:
- negative log likelihood of actual pick;
- top-k capture;
- position-selection accuracy;
- player rank percentile;
- calibration of position probabilities.

Require proof that manager-specific modeling improves predictions after regularization.

---

# 7. Draft Policy Evaluation

Replay historical drafts or synthetic draft environments.

Metrics:
- terminal roster projected value;
- simulated playoff probability;
- simulated championship probability;
- regret vs oracle;
- robustness under alternative player-outcome models.

Critical:
evaluate policy under multiple simulation models to avoid self-confirming backtests.

A policy trained and tested on the same simulator can appear artificially optimal.

---

# 8. Simulation Validation

Check that generated weekly and season distributions reproduce:
- positional weekly variance;
- player autocorrelation;
- team/game correlations;
- injury/games-played frequency;
- scoring distribution tails;
- roster weekly totals;
- league standings spread.

Use posterior predictive checks.

---

# 9. Monte Carlo Error

For candidate utility estimate:

\[
SE(\hat{Q}) = \frac{s}{\sqrt{N}}
\]

For pairwise candidate differences with common random numbers:

\[
SE(\hat{Q}_A-\hat{Q}_B)
\]

is the key measure.

The UI's "confidence" must consider this difference uncertainty.

---

# 10. Ablation Tests

Remove each component:

- expert weighting;
- opportunity residual model;
- opponent learning;
- survival probability;
- market mispricing;
- covariance;
- positional cliff;
- full-season equity;
- stage-dependent risk utility.

If removing a component does not hurt out-of-sample performance, simplify the production model.

---

# 11. Sensitivity Tests

Vary:
- projection source weights;
- injury model;
- opponent rationality;
- league manager behavior;
- player correlation assumptions;
- tail thickness;
- replacement-level assumptions.

Recommendations should not flip wildly under modest parameter perturbations unless genuinely close.

---

# 12. Property Tests

Examples:

- drafting a player removes him from availability;
- no roster exceeds legal draft count;
- player cannot appear on two teams;
- scoring transformation is deterministic;
- increasing a positive scoring coefficient cannot reduce points for identical stat vector;
- survival probability is non-increasing as future pick horizon gets later only under clearly defined horizon semantics;
- simulation results reproduce exactly under fixed seed;
- manual undo returns identical previous state.

---

# 13. Integration Tests

FantasyPros:
- valid response;
- rate limit;
- stale cache;
- schema change;
- missing CBS ID.

CBS adapter:
- duplicate event;
- pick correction;
- reconnect;
- partial page load;
- draft paused;
- pick traded if league supports it.

Manual:
- typo;
- ambiguous player;
- undo.

---

# 14. Load / Latency Tests

Test live engine at:
- 250;
- 500;
- 1000 available players.

Target p95:
- update < 2.5 sec;
- hard p99 < 5 sec.

Precompute and cache aggressively.

---

# 15. Acceptance Criteria for V1

V1 is not ready until:

- exact custom scoring passes unit/property tests;
- draft replay is deterministic;
- FantasyPros provider is cache-safe and schema-validated;
- manual draft mode works end to end;
- candidate recommendation returns under 5 sec p99 on target hardware;
- survival predictions are calibrated on held-out mock/historical drafts;
- live policy beats ECR-only and static VBD baselines in out-of-sample simulated leagues;
- recommendations include uncertainty;
- system can recover from connector outage without losing state.

---

# 16. Quality Gates for Model Claims

Do not display:
- "+4.3% championship probability" unless simulation and model uncertainty justify that precision.

Prefer:

```text
Estimated championship lift: +2 to +4 points
```

when uncertainty is material.

Precision should reflect evidence.
