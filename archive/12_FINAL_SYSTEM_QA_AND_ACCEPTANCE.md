# Final System QA and Acceptance

## 1. Quant Architecture Review

PASS only if:

- exact custom league scoring is represented;
- player predictions are distributions;
- calibration is tested;
- replacement value is state-dependent;
- flex/superflex uses assignment optimization;
- opponent model has shrinkage;
- survival model is calibrated;
- sequential option value is present;
- simulation uses variance reduction;
- pairwise decision uncertainty is measured;
- covariance exists where material;
- live and oracle policies are separate.

---

# 2. False-Precision Review

FAIL if UI presents:
- precise championship deltas without error estimation;
- arbitrary confidence;
- exact player ranks from poorly differentiated distributions.

PASS if:
- close calls are identified;
- confidence reflects model + simulation certainty;
- robust intervals are used.

---

# 3. Backtest Integrity Review

PASS only if:
- all historical inputs are timestamp-safe;
- future information cannot leak;
- model selection occurs before final holdout;
- baselines are included;
- ablations are run;
- simulator-policy self-confirmation is tested using alternative outcome models.

---

# 4. Integration Review

PASS only if:
- FantasyPros endpoints exist in official docs;
- API auth is not exposed client-side;
- CBS method is verified before use;
- manual fallback works;
- duplicate pick events are idempotent;
- identity mapping is deterministic or explicitly flagged;
- data freshness is visible.

---

# 5. Runtime Review

PASS only if:
- application runs without Claude;
- recommendation path has no LLM dependency;
- local event log recovers from crash;
- p99 recommendation latency is < 5 seconds;
- last-known-good result remains visible during recomputation;
- network/API loss does not stop drafting.

---

# 6. UX Review

Ask a tester who has not read the model docs:

"You have 20 seconds. Who should you draft?"

PASS if they can answer within 3 seconds from the UI.

They should also be able to answer:
- why;
- who is second;
- whether the recommended player is likely to survive.

No other information is mandatory on the primary screen.

---

# 7. Security Review

PASS only if:
- `.env` ignored;
- no keys in frontend or extension;
- local service bound appropriately;
- extension requests minimal permissions;
- no session-cookie logging;
- dependencies scanned;
- all external inputs validated.

---

# 8. Operational Review

PASS only if:

```bash
make draft
```

produces one clear readiness report.

PASS only if manual mode can complete an entire mock draft without CBS connectivity.

---

# 9. Model Challenge Questions

Before final release, reviewers must answer:

1. Under what league rules does the model disagree most with ECR?
2. Is that disagreement mathematically justified?
3. Which features contribute most to opponent predictions?
4. Does removing manager-specific learning materially hurt out-of-sample results?
5. How well calibrated are player-survival probabilities?
6. How sensitive are pick recommendations to projection variance?
7. How often does candidate rank change when simulation seed changes?
8. Does the fast policy have acceptable regret relative to the oracle?
9. What happens when injury information is stale?
10. What happens when CBS sync fails on the user's pick?

---

# 10. Stop Conditions

Do not ship if:
- custom scoring has unresolved ambiguity;
- CBS connector requires unverified prohibited behavior;
- survival probabilities are poorly calibrated;
- recommendations frequently flip due to simulation noise;
- fast policy is slower than 5 seconds;
- manual fallback is not ready;
- full replay cannot reproduce previous recommendations;
- secrets are exposed.

---

# 11. What "Perfect" Means Here

There is no provably perfect fantasy-football algorithm because:
- future NFL performance is stochastic;
- injuries are partially unpredictable;
- opponents behave imperfectly;
- projection distributions are misspecified;
- league outcomes have substantial noise.

The engineering objective is therefore not perfect prediction.

It is:

> a calibrated, state-aware decision policy with demonstrably lower regret than available baselines and sufficient operational reliability to exploit that edge in real time.

That is the correct quantitative standard.
