# Mathematical Model and Algorithms

## 1. Formal Problem

Model the draft as a finite-horizon partially observed stochastic game.

At pick time `t`, define state:

\[
s_t = (A_t, R_t, Q_t, L, M_t, \Theta_t, B_t)
\]

where:

- `A_t`: available players;
- `R_t`: roster state for every fantasy team;
- `Q_t`: draft order / future pick positions;
- `L`: immutable league rules;
- `M_t`: current market state;
- `Θ_t`: posterior parameters describing opponent behavior;
- `B_t`: beliefs about football player outcomes.

Action:

\[
a_t \in A_t
\]

Transition:

\[
s_{t+1} \sim P(s_{t+1}\mid s_t,a_t,\Theta_t,B_t)
\]

The terminal season utility can be represented as:

\[
U = \lambda_C I(\text{Champion})
+ \lambda_P I(\text{Playoffs})
+ \lambda_W W
+ \lambda_F PF
- \lambda_D D
\]

where:
- `W` = regular-season wins;
- `PF` = points for;
- `D` = fragility/downside metric.

For live drafting, championship probability is primary, but use a smoothed composite objective to reduce Monte Carlo instability early in the draft.

Recommended stage-adaptive utility:

\[
U_t =
\alpha_t P(C)
+\beta_t P(P)
+\gamma_t Z(E[PF])
-\delta_t Fragility
+\eta_t OptionValue
\]

As the draft advances, increase `α_t` because roster identity becomes more informative.

---

# 2. Player Projection Distribution

Do not model a player with one number.

For player `i`, NFL stat vector:

\[
X_i = (passYds, passTD, rushYds, rushTD, targets, rec, recYds, recTD,\ldots)
\]

Construct posterior predictive distribution:

\[
p(X_i \mid D)
\]

Then transform through exact league scoring:

\[
Y_i = g_L(X_i)
\]

The output distribution should include:
- expected points;
- median;
- variance;
- P10/P25/P75/P90;
- probability of games missed;
- weekly covariance with teammates/opponents;
- breakout and bust probabilities.

## 2.1 Projection ensemble

For each stat `k`:

\[
\hat{x}_{ik}
=
\sum_j w_{jk}\hat{x}_{ijk}
\]

Use shrinkage-constrained weights:

\[
w_{jk}\ge0,\quad \sum_j w_{jk}=1
\]

Learn with chronological cross-validation.

Recommended default:
- simple or robust ensemble prior;
- modest expert-accuracy adjustment;
- proprietary usage model residual correction.

Do not allow an expert weight to dominate without persistent out-of-sample evidence.

## 2.2 Residual model

Model:

\[
r_{ik} = x_{ik}^{actual}-\hat{x}_{ik}^{consensus}
\]

using features such as:
- age;
- experience;
- draft capital;
- prior efficiency;
- role;
- target/rush share;
- offensive environment;
- injuries;
- depth-chart competition;
- coaching change.

Use gradient boosting, hierarchical Bayesian regression, or an ensemble.

The final projection is:

\[
\hat{x}^{final} = \hat{x}^{consensus} + \hat{r}
\]

This lets consensus absorb broad public information while the proprietary layer searches for repeatable residual edge.

---

# 3. Calibration

For quantiles:

\[
P(Y_i \le Q_i(q)) \approx q
\]

Validate by position, player archetype, week, and projection horizon.

Use:
- isotonic calibration;
- conformal calibration;
- empirical residual bootstrap;
- hierarchical shrinkage when sample sizes are small.

Separate:
1. epistemic uncertainty — model uncertainty;
2. aleatoric uncertainty — inherent game/player variance;
3. availability uncertainty — injury/games played;
4. simulation uncertainty — finite Monte Carlo error.

Never combine these into one opaque "confidence."

---

# 4. League Scoring Engine

Represent scoring rules declaratively.

Example:

```yaml
passing:
  yards:
    points_per: 0.04
  touchdowns:
    points_each: 6
  interceptions:
    points_each: -2
  bonuses:
    - threshold: 300
      points: 3
rushing:
  yards:
    points_per: 0.1
receiving:
  reception:
    WR: 1.0
    RB: 1.0
    TE: 1.5
```

The scoring engine must support:
- thresholds;
- nonlinear bonuses;
- position-specific scoring;
- first downs;
- return yards;
- distance bonuses;
- fractional points;
- negative yardage;
- defensive scoring if needed.

Property-test every rule.

---

# 5. Replacement Value

Static VORP is insufficient.

Define state-dependent replacement value:

\[
RV_{p,t} = E[\max_{j\in A_t,\ pos(j)=p} Y_j \mid future\ acquisition\ policy]
\]

For flex positions use assignment optimization, not independent positional baselines.

At any roster state, solve a maximum-weight bipartite matching / integer program between roster players and eligible starting slots.

Marginal roster value for candidate `i`:

\[
MRV_i = V(R_t \cup i)-V(R_t)
\]

This automatically handles:
- flex;
- superflex;
- multiple QB;
- TE premium;
- unusual starter counts;
- duplicate position eligibility.

---

# 6. Positional Cliffs

For position `p`, sort remaining players by league-adjusted value.

Calculate local marginal gaps:

\[
Cliff_{p,k}=V_{p,k}-V_{p,k+1}
\]

But the relevant cliff is not just the next player. It is the expected quality at the user's next pick:

\[
ExpectedDrop_i
=
V_i -
E[V^*_{same\ role,next\ pick}]
\]

This should be derived from the survival model.

---

# 7. Live League Market Model

Let global expected draft position be:

\[
ADP_i^{global}
\]

Infer league-specific latent valuation:

\[
\mu_{i,t}^{league}
=
ADP_i^{global}
+
\Delta_{position,t}
+
\Delta_{archetype,t}
+
\Delta_{manager,t}
\]

A hierarchical model is preferred because early observations are sparse.

Example positional demand posterior:

\[
\Delta_{RB,t}\sim N(\mu_{RB,t},\sigma^2_{RB,t})
\]

Update after every selection.

Use partial pooling:
- league-wide positional effect;
- manager-specific effect;
- round effect;
- roster-need effect.

---

# 8. Opponent Pick Model

For manager `m`, candidate player `i`:

\[
P(i \mid m,s_t)
=
\frac{\exp(z_{m,i,t})}
{\sum_{j\in A_t}\exp(z_{m,j,t})}
\]

Utility logit:

\[
z_{m,i,t}
=
\beta_1 ECR_i
+\beta_2 ADP_i
+\beta_3 Need_{m,pos(i)}
+\beta_4 TierUrgency_i
+\beta_5 ReachTolerance_m
+\beta_6 PositionPreference_{m,pos(i)}
+\beta_7 StackFit
+\beta_8 NewsRecency
+\epsilon
\]

Use Bayesian hierarchical multinomial logit, Plackett-Luce, or a learned ranking model.

Critical:
- strong shrinkage to global priors;
- update online;
- avoid declaring tendencies from tiny samples.

Manager parameters should decay toward priors across seasons unless historical league data exists and is stable.

---

# 9. Player Survival Probability

For every candidate `i` and next user pick `k`:

\[
S_i(k)=P(i \in A_k \mid s_t)
\]

Estimate by opponent-pick rollout.

Also calculate:

\[
S_i(k+1)
\]

for two user turns ahead.

The decision value of waiting:

\[
OV_i =
S_i(next)\cdot E[Value_i\ at\ next]
+
(1-S_i(next))\cdot E[BestAlternative]
\]

This is the formal option-value term.

---

# 10. Sequential Draft Optimization

Exact dynamic programming is intractable because state space is enormous.

Use approximate dynamic programming.

## 10.1 Candidate generation

At each user pick, generate 8–15 serious candidates using:
- league-adjusted marginal value;
- positional cliff;
- ECR/ADP mispricing;
- survival urgency;
- upside;
- roster fit.

## 10.2 Rollout policy

For candidate action `a`, run:

\[
\hat{Q}(s,a)
=
\frac{1}{N}\sum_{n=1}^{N}
U(\tau_n\mid s,a,\pi_{base})
\]

where `π_base` is a fast future-pick policy.

## 10.3 Common random numbers

Use the same random seeds / future player outcomes when comparing candidate A and B.

This materially lowers variance of:

\[
\hat{Q}(s,A)-\hat{Q}(s,B)
\]

## 10.4 Adaptive simulation allocation

Start each candidate with `N0` simulations.

Allocate more simulations only to close contenders using racing / sequential elimination.

Stop when:
- best candidate's confidence interval is separated;
- latency budget reached;
- marginal uncertainty reduction is small.

## 10.5 Robust score

Do not rank by raw Monte Carlo mean alone.

Recommended:

\[
Score_i =
\hat{Q}_i
-
\kappa SE(\hat{Q}_i)
-
\rho ModelRisk_i
\]

where `ModelRisk` reflects poorly calibrated tails / sparse inputs.

Alternative:
use lower confidence bound on incremental utility.

---

# 11. Fast Policy vs Oracle Simulator

## Fast live policy

Goal: < 2 seconds preferred, < 5 seconds hard target.

Inputs:
- precomputed player distributions;
- cached opponent probabilities;
- current state;
- targeted 2–4 round rollouts;
- approximate downstream value function.

## Oracle simulator

Offline:
- 50k–500k scenarios;
- full draft;
- full season;
- opponent policies;
- waiver approximations;
- playoffs.

Use oracle results to:
- evaluate heuristics;
- train value function;
- discover failure modes;
- benchmark live policy regret.

This separation is essential.

---

# 12. Correlated Player Outcomes

Independent simulations overstate diversification.

Model common shocks:

\[
Y_{i,w} =
\mu_{i,w}
+
\lambda_{team}F_{team,w}
+
\lambda_{game}F_{game,w}
+
\lambda_{QB}F_{QB,w}
+
\epsilon_{i,w}
\]

Examples:
- QB–WR positive covariance;
- pass catcher competition;
- RB and opposing passing game game-script relationships;
- shared team scoring environment.

Estimate covariance empirically with shrinkage.

Do not use raw sample covariance for sparse player pairs.

---

# 13. Draft Utility by Stage

Early draft:
- stronger shrinkage to median projection;
- avoid extreme tail assumptions;
- value structural scarcity and durable workload.

Later draft:
- asymmetric upside matters more;
- replacement cost is low;
- contingent-value backs and breakout receivers often dominate low-ceiling veterans.

Represent with stage-dependent risk utility rather than hardcoding strategy.

---

# 14. In-Season Extensions

## Waivers

For candidate add/drop:

\[
\Delta U = U(R-i+j)-U(R)
\]

FAAB bid should optimize expected acquisition utility:

\[
EV(b)
=
P(win\mid b)\cdot \Delta U
-
ShadowPrice(FAAB,b)
\]

Learn league bid distributions.

## Trades

For package `T`:

\[
\Delta U_{user}(T)>0
\]

and estimate:

\[
P(accept\mid T,opponent)
\]

Search Pareto-improving / perception-asymmetric trades.

## Weekly lineup

Optimize:

\[
P(Score_{user}>Score_{opp})
\]

not merely expected points.

Use covariance and opponent lineup uncertainty.

---

# 15. Recommendation Confidence

Display confidence based on:
- model agreement;
- simulation separation;
- survival-model certainty;
- data freshness;
- connector integrity.

Example:

```text
Confidence: 82%
Reason:
- candidate leads next best by 0.7 robust utility units;
- 95% simulation CI excludes tie;
- CBS state is current;
- projection sources agree moderately.
```

Do not map confidence directly from championship delta.
