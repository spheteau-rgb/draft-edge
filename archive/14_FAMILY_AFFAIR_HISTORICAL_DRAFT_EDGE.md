# Family Affair --- Historical Draft Behavior & Algorithmic Edge

## 2019--2025 Round 1 Analysis + 2026 Model Requirements

**Purpose:** Convert seven seasons of actual Family Affair draft
behavior and championship history into league-specific priors for the
2026 draft optimizer.

**Evidence supplied:** CBS Sports screenshots for Round 1 of the
2019--2025 drafts and league champion cards for 2019--2025.

> **Data-quality rule:** The 2025 screenshot visibly exposes picks
> 1--11; pick 12 is obscured. The model must treat that pick as missing
> rather than infer it. Historical conclusions below are therefore
> directional priors, not deterministic rules.

------------------------------------------------------------------------

# 1. Executive Findings

This league has a distinct draft market. It should **not** be modeled as
a generic 12-team room.

The strongest historical signals are:

1.  **The room has historically paid a substantial Round-1 premium for
    RBs.**
2.  **That RB premium has weakened sharply in the last three drafts.**
3.  **Elite QBs have historically been drafted materially earlier than
    ordinary 1-QB market heuristics would suggest**, consistent with
    this league's unusually favorable QB scoring.
4.  **TE almost never enters Round 1**, even when an elite positional
    outlier exists.
5.  **The room is changing.** 2019--2022 behavior is useful as a manager
    prior, but 2023--2025 should receive substantially more weight when
    predicting 2026.
6.  **Individual manager tendencies persist enough to model**, but
    manager identity should be separated from draft slot because draft
    order changes annually.
7.  **The optimizer's edge is not simply "draft differently from the
    league."** It is to estimate when this room will create a positional
    discount, whether the discounted player is genuinely valuable under
    Family Affair scoring, and whether that player will survive to the
    user's next selection.
8.  **Historical champion data should be joined to full historical
    rosters/drafts before being used causally.** A champion's Round-1
    pick alone does not establish that the Round-1 strategy caused the
    title.

The 2026 decision engine should therefore maintain two different values
for every player:

-   **Fundamental League Value** --- expected value under Family Affair
    scoring and roster rules.
-   **Family Affair Market Value** --- expected acquisition cost based
    on this room's actual behavior.

The exploitable quantity is the gap between them.

------------------------------------------------------------------------

# 2. Historical Round-1 Dataset

## 2019

    Pick Player                 Pos  Team
  ------ --------------------- ----- --------------------------
       1 Saquon Barkley         RB   D.Omination
       2 Alvin Kamara           RB   Suicide squad 84
       3 Patrick Mahomes        QB   Milwaukee Champions
       4 Christian McCaffrey    RB   Mama There Goes That Man
       5 Ezekiel Elliott        RB   Jaguars
       6 Julio Jones            WR   Harlem Knights
       7 Todd Gurley            RB   Mac Diesel
       8 James Conner           RB   Gladiators
       9 Nick Chubb             RB   Comets
      10 DeAndre Hopkins        WR   Black and Blue Warhorses
      11 Ben Roethlisberger     QB   Outlaws
      12 Le'Veon Bell           RB   Pack Attack

**Position mix:** RB 8 / WR 2 / QB 2 / TE 0

## 2020

    Pick Player                   Pos  Team
  ------ ----------------------- ----- --------------------------
       1 Christian McCaffrey      RB   Gladiators
       2 Saquon Barkley           RB   The Dan Clan
       3 Ezekiel Elliott          RB   Pack Attack
       4 Patrick Mahomes          QB   D.Omination
       5 Derrick Henry            RB   Mac Diesel
       6 Alvin Kamara             RB   Jaguars
       7 Clyde Edwards-Helaire    RB   Comets
       8 Dalvin Cook              RB   Outlaws
       9 Michael Thomas           WR   Black and Blue Warhorses
      10 Josh Jacobs              RB   Mama There Goes That Man
      11 Nick Chubb               RB   Suicide squad 84
      12 Lamar Jackson            QB   Harlem Knights

**Position mix:** RB 9 / WR 1 / QB 2 / TE 0

## 2021

    Pick Player                 Pos  Team
  ------ --------------------- ----- --------------------------
       1 Christian McCaffrey    RB   Black and Blue Warhorses
       2 Derrick Henry          RB   Comets
       3 Dalvin Cook            RB   Mac Diesel
       4 Alvin Kamara           RB   Pack Attack
       5 Patrick Mahomes        QB   The Dan Clan
       6 Davante Adams          WR   Domination
       7 Aaron Jones            RB   Mama There Goes That Man
       8 Ezekiel Elliott        RB   Outlaws
       9 Jonathan Taylor        RB   Suicide squad 84
      10 Nick Chubb             RB   Jaguars
      11 Saquon Barkley         RB   Harlem Knights
      12 Najee Harris           RB   Gladiators

**Position mix:** RB 10 / WR 1 / QB 1 / TE 0

## 2022

    Pick Player                 Pos  Team
  ------ --------------------- ----- --------------------------
       1 Jonathan Taylor        RB   Domination
       2 Christian McCaffrey    RB   Black and Blue Warhorses
       3 Patrick Mahomes        QB   The Dan Clan
       4 Justin Jefferson       WR   Outlaws
       5 Derrick Henry          RB   Mac Diesel
       6 Joe Mixon              RB   Mama There Goes That Man
       7 Austin Ekeler          RB   Pack Attack
       8 Travis Kelce           TE   Harlem Knights
       9 Dalvin Cook            RB   Suicide squad 84
      10 Aaron Jones            RB   Comets
      11 Cooper Kupp            WR   Gladiators
      12 Alvin Kamara           RB   Jaguars

**Position mix:** RB 8 / WR 2 / QB 1 / TE 1

## 2023

    Pick Player                 Pos  Team
  ------ --------------------- ----- --------------------------
       1 Bijan Robinson         RB   Outlaws
       2 Patrick Mahomes        QB   Mac Diesel
       3 Jalen Hurts            QB   The Dan Clan
       4 Christian McCaffrey    RB   Comets
       5 Justin Jefferson       WR   Domination
       6 Ja'Marr Chase          WR   Black and Blue Warhorses
       7 Austin Ekeler          RB   Suicide squad 84
       8 Travis Kelce           TE   Harlem Knights
       9 Derrick Henry          RB   Mama There Goes That Man
      10 Cooper Kupp            WR   Pack Attack
      11 Saquon Barkley         RB   Gladiators
      12 Josh Jacobs            RB   Jaguars

**Position mix:** RB 6 / WR 3 / QB 2 / TE 1

## 2024

    Pick Player                 Pos  Team
  ------ --------------------- ----- --------------------------
       1 Tyreek Hill            WR   Domination
       2 Saquon Barkley         RB   Mac Diesel
       3 Christian McCaffrey    RB   The Dan Clan
       4 Breece Hall            RB   Outlaws
       5 Amon-Ra St. Brown      WR   Mama There Goes That Man
       6 Bijan Robinson         RB   Black and Blue Warhorses
       7 Jonathan Taylor        RB   Jaguars
       8 CeeDee Lamb            WR   Gladiators
       9 Ja'Marr Chase          WR   Suicide squad 84
      10 Justin Jefferson       WR   Harlem Knights
      11 A.J. Brown             WR   Pack Attack
      12 Travis Etienne         RB   Comets

**Position mix:** RB 6 / WR 6 / QB 0 / TE 0

## 2025

    Pick Player                                    Pos  Team
  ------ ---------------------------------------- ----- --------------------------
       1 Bijan Robinson                            RB   Harlem Knights
       2 Ja'Marr Chase                             WR   Gladiators
       3 Saquon Barkley                            RB   The Dan Clan
       4 Jahmyr Gibbs                              RB   Comets
       5 Ashton Jeanty                             RB   Suicide squad 84
       6 Josh Jacobs                               RB   Jaguars
       7 Derrick Henry                             RB   Outlaws
       8 Christian McCaffrey                       RB   Mama There Goes That Man
       9 Justin Jefferson                          WR   Domination
      10 CeeDee Lamb                               WR   Black and Blue Warhorses
      11 Nico Collins                              WR   Pack Attack
      12 **Not visible in supplied screenshot**    ---  ---

**Visible position mix:** RB 7 / WR 4 / QB 0 / TE 0 / missing 1

------------------------------------------------------------------------

# 3. Quantified League-Level Trends

## 3.1 RB concentration

Across the six complete Round-1 samples from 2019--2024:

-   RB: **47 of 72 picks = 65.3%**
-   WR: **15 of 72 = 20.8%**
-   QB: **8 of 72 = 11.1%**
-   TE: **2 of 72 = 2.8%**

Including the 11 visible 2025 picks:

-   RB: **54 of 83 visible picks = 65.1%**
-   WR: **19 of 83 = 22.9%**
-   QB: **8 of 83 = 9.6%**
-   TE: **2 of 83 = 2.4%**

But the aggregate hides a regime change.

### Early era: 2019--2022

RB Round-1 share by season: - 2019: 66.7% - 2020: 75.0% - 2021: 83.3% -
2022: 66.7%

### Recent era: 2023--2025

-   2023: 50.0%
-   2024: 50.0%
-   2025 visible: 63.6%

**Algorithmic implication:** do not estimate 2026 position demand using
a flat seven-year average. Apply recency weighting and manager-level
persistence.

Suggested initial weighting:

``` text
2025 = 1.00
2024 = 0.80
2023 = 0.65
2022 = 0.45
2021 = 0.30
2020 = 0.20
2019 = 0.15
```

These are starting priors only; optimize decay through historical
backtesting.

------------------------------------------------------------------------

# 4. Quarterback Market Is League-Specific

The historical room repeatedly demonstrated willingness to spend Round-1
capital on elite QBs:

-   2019: Mahomes #3; Roethlisberger #11
-   2020: Mahomes #4; Lamar Jackson #12
-   2021: Mahomes #5
-   2022: Mahomes #3
-   2023: Mahomes #2; Hurts #3
-   2024: no Round-1 QB
-   2025 visible: no Round-1 QB

This is highly relevant because Family Affair uses: - 6 points per
passing TD - 1 point / 20 passing yards - only -1 per interception -
passing-yard milestones - long passing-TD bonuses

The model must therefore reject both simplistic rules:

``` text
"QB scores a lot, so draft QB early"          ❌
"1-QB league, so always wait on quarterback" ❌
```

Instead calculate:

``` text
QB Structural Advantage
= League-Scored Projection(QB candidate)
- Replacement-Level QB Projection
```

Then compare that advantage with RB/WR/TE alternatives and the
probability that the next QB tier survives.

**Critical market observation:** the room's QB behavior appears cyclical
rather than stable. 2023 produced two QBs in the first three picks;
2024--2025 produced none in the visible Round 1. The opponent model must
update rapidly if a 2026 QB run begins rather than assuming one from
history.

------------------------------------------------------------------------

# 5. Wide Receiver Regime Change

The clearest structural evolution is WR adoption.

Round-1 WR count:

``` text
2019: 2
2020: 1
2021: 1
2022: 2
2023: 3
2024: 6
2025: 4 through pick 11
```

This is not sufficient evidence to assume WRs are now undervalued or
overvalued. It **is** sufficient evidence that an opponent model trained
equally on 2019 and 2025 would be badly specified.

The live model should therefore estimate:

``` text
P(position selected | manager, draft slot, current roster,
                    remaining tier, current run, recent league behavior)
```

rather than:

``` text
P(position selected | seven-year league frequency)
```

------------------------------------------------------------------------

# 6. Tight End Behavior

Only two supplied first rounds contain a TE: - Travis Kelce #8 in 2022 -
Travis Kelce #8 in 2023

No TE appears in Round 1 in 2019, 2020, 2021, 2024, or the visible 2025
picks.

**Potential edge:** if Family Affair scoring creates a genuine TE
positional outlier but this room remains reluctant to pay
Round-1/early-Round-2 acquisition cost, the optimizer should recognize
the discount.

However, it must calculate the TE's **advantage over replacement**, not
simply his raw projection.

------------------------------------------------------------------------

# 7. Manager-Level Priors

The historical data is valuable because many team identities recur.

Examples that should become explicit model priors:

### The Dan Clan

Repeated early QB behavior: - 2020: Barkley #2 - 2021: Mahomes #5 -
2022: Mahomes #3 - 2023: Hurts #3 - 2024: McCaffrey #3 - 2025: Barkley
#3

This manager has demonstrated substantially greater willingness than a
generic 1-QB drafter to pay premium capital for an elite QB.

### Harlem Knights

-   2022: Kelce #8
-   2023: Kelce #8
-   otherwise mixes WR/RB/QB depending on board.

This is evidence of willingness to pay for an extreme TE positional
advantage when one exists.

### Mama There Goes That Man

Historical Round-1 selections: - 2019: Christian McCaffrey #4 - 2020:
Josh Jacobs #10 - 2021: Aaron Jones #7 - 2022: Joe Mixon #6 - 2023:
Derrick Henry #9 - 2024: Amon-Ra St. Brown #5 - 2025: Christian
McCaffrey #8

This team's historical Round-1 profile is strongly RB-oriented, with the
first supplied Round-1 WR selection appearing in 2024.

**Important:** these are priors, not rules. The model should shrink
manager-specific estimates toward league-wide behavior when sample sizes
are small.

------------------------------------------------------------------------

# 8. Champion History

Visible CBS champion cards:

    Season Champion
  -------- --------------------------
      2025 Black and Blue Warhorses
      2024 Mac Diesel
      2023 Comets
      2022 Jaguars
      2021 Jaguars
      2020 Gladiators
      2019 Harlem Knights

### Important interpretation

Do **not** train the model to imitate a champion's first pick.

Fantasy championships are produced by: - full draft construction, -
waiver acquisitions, - trades, - injuries, - weekly lineup decisions, -
schedule variance, - playoff variance, - and player outcomes.

The useful next dataset is therefore:

``` text
season
manager
draft_slot
all_draft_picks
final_roster
waiver_transactions
trades
regular_season_points
regular_season_record
playoff_seed
championship_result
```

Once available, the model can estimate which behaviors correlate with
sustained success rather than merely which player a champion selected in
Round 1.

------------------------------------------------------------------------

# 9. New Algorithm Requirement --- Family Affair Market Model

Add a dedicated `family_affair_market` layer.

For every available player `p`:

``` text
FundamentalValue(p)
    = Family Affair scoring projection
    + positional replacement advantage
    + ceiling/upside value
    - injury/role uncertainty
    + roster construction value

LeagueMarketValue(p)
    = expected Family Affair draft position
    based on:
        current 2026 CBS/market ADP
        historical Family Affair behavior
        manager-specific tendencies
        current draft slot sequence
        current rosters
        observed 2026 reaches/falls
        position runs
        tier scarcity
        live picks

Mispricing(p)
    = FundamentalValue(p) - LeagueMarketValue(p)
```

The final recommendation must **not** simply maximize `Mispricing`.

It should maximize expected championship equity while considering
whether the player can be acquired later.

------------------------------------------------------------------------

# 10. Player Survival Model

This historical dataset should directly inform:

``` text
P(player gone before my next pick)
```

For each player, estimate survival from:

1.  2026 CBS ADP
2.  FantasyPros / multi-market ADP distribution
3.  Family Affair historical positional aggression
4.  managers selecting before the user's next turn
5.  each manager's historical positional preferences
6.  current roster composition
7.  observed 2026 draft behavior
8.  current positional run
9.  remaining tier depth

Example:

``` text
Player A
Fundamental rank: 14
Family Affair expected pick: 21
P(survives to next pick): 72%

Player B
Fundamental rank: 17
Family Affair expected pick: 15
P(survives to next pick): 8%
```

Taking B now can dominate taking A now even though A has slightly
greater standalone value.

This is **sequential acquisition optimization**, not rankings.

------------------------------------------------------------------------

# 11. Recency + Bayesian Updating

Historical tendencies must decay.

Recommended conceptual model:

``` text
Prior(manager, position)
    = weighted historical manager behavior

LeaguePrior(position)
    = weighted Family Affair historical behavior

MarketPrior(player)
    = current 2026 CBS + FantasyPros + other relevant ADP

Posterior(after each live pick)
    ∝ Prior × likelihood(observed 2026 behavior)
```

A live 2026 pick should be more informative than an old 2019 pick.

If a historically RB-heavy manager starts WR-WR in 2026, the model must
update rather than stubbornly retain the historical classification.

------------------------------------------------------------------------

# 12. Detecting Position Runs Correctly

Historical RB aggression means a run is plausible, but the optimizer
should never blindly "join the run."

When several RBs are selected consecutively:

``` text
Step 1: Update RB survival probabilities downward.
Step 2: Recalculate remaining RB tier cliffs.
Step 3: Calculate the value created at WR/QB/TE because competitors passed.
Step 4: Simulate both:
        A) join RB run
        B) exploit value at another position
Step 5: choose the path with higher championship equity.
```

A position run creates **two simultaneous effects**: - scarcity at the
position being drafted; - discounts at positions being ignored.

The system must price both.

------------------------------------------------------------------------

# 13. Draft-Slot Modeling

Draft slot changes the optimal strategy because it changes option value.

For a 12-team snake, each selection should know:

``` text
current_pick
next_user_pick
number_of_opponent_selections_between
manager identities between picks
their roster needs
their position probabilities
```

The algorithm should simulate the actual managers between the user's
turns.

Generic ADP-based simulations are insufficient once Family Affair
history is available.

------------------------------------------------------------------------

# 14. Historical Backtest Requirement

This dataset creates an opportunity to test whether the algorithm would
have made intelligent decisions historically.

For each historical season:

1.  Use only information available immediately before that season's
    draft.
2.  Load that year's projections/ADP.
3.  Apply Family Affair scoring.
4.  Reveal actual opponent selections sequentially.
5.  At each historical user pick, ask what the algorithm would have
    recommended.
6.  Continue the counterfactual draft using simulated opponent
    responses.
7.  Score the resulting roster using actual season outcomes.
8.  Repeat many simulations.
9.  Compare against:
    -   actual roster
    -   ADP-only strategy
    -   ECR-only strategy
    -   static VBD
    -   dynamic league-aware optimizer

Never leak end-of-season outcomes into the recommendation model.

Metrics:

``` text
expected regular-season points
expected starter points
playoff probability
championship probability
value captured vs acquisition cost
injury-adjusted result
position-level VORP
decision regret at each pick
```

------------------------------------------------------------------------

# 15. 2026 Live-Draft Features to Add

The app should surface the historical league model without making the UI
complicated.

## Main recommendation

``` text
ON THE CLOCK — PICK X

PICK: PLAYER NAME
Confidence: 82%
Championship Equity: +2.7%

WHY
Best league-adjusted value and unlikely to survive your next turn.
Family Affair is currently drafting RB 14% earlier than the outside market.
```

## Alternative cards

For each alternative:

``` text
PLAYER
Position
Championship equity delta
P(gone before next pick)
Family Affair expected pick
Outside-market ADP
League-specific value rank
```

## League pulse

Only three concise signals:

``` text
RB: +14% aggressive
WR: -9% vs outside market
QB: normal
```

Manager-level detail remains expandable.

------------------------------------------------------------------------

# 16. Model Features Created by This Dataset

Add the following features:

``` yaml
family_affair_features:
  league:
    historical_position_share_round1:
      rb: true
      wr: true
      qb: true
      te: true
    recency_weighted_position_share: true
    position_run_frequency: true
    first_player_by_position_pick: true
    position_tier_exhaustion_rate: true

  manager:
    historical_first_position: true
    round_by_position_distribution: true
    qb_aggression: true
    rb_aggression: true
    wr_aggression: true
    te_aggression: true
    reach_vs_market: true
    adp_adherence: true
    run_following_behavior: true
    roster_balance_preference: true
    recency_weighted: true

  player_market:
    family_affair_expected_pick: true
    family_affair_pick_sd: true
    outside_market_adp: true
    league_market_delta: true
    probability_gone_next_pick: true
    probability_gone_two_picks_ahead: true
```

------------------------------------------------------------------------

# 17. Data We Should Obtain Next

Highest-value additional historical information, in order:

1.  **Complete drafts for 2023--2025**
2.  Complete drafts for 2019--2022
3.  Historical final standings / total points
4.  Historical playoff brackets
5.  Waiver transactions
6.  Trades
7.  Final rosters
8.  Current 2026 manager/team mapping
9.  Missing 2025 pick #12

Full drafts are especially valuable because Round 1 tells us risk
preference and premium-position behavior, but Rounds 2--8 reveal: -
positional runs, - QB timing, - TE timing, - how quickly managers fill
starters, - willingness to draft bench upside, - whether managers reach
for K/DST, - and which positions this room systematically allows to
fall.

------------------------------------------------------------------------

# 18. Key Strategic Conclusion

The historical information materially improves the system.

The optimizer should no longer ask:

> **"Who is the best available player?"**

It should ask:

> **"Given Family Affair's scoring, the exact managers drafting between
> my turns, what they historically pay for each position, what they are
> doing tonight, and the probability each player survives, which
> sequence of picks maximizes my championship probability?"**

That is the edge this dataset enables.

------------------------------------------------------------------------

# 19. Implementation Priority

Claude should incorporate this file into the existing build
specification as a **league-specific empirical prior**, with this
hierarchy:

``` text
1. Exact Family Affair scoring + roster rules
2. Current player projections / distributions
3. Current 2026 market information
4. Recent Family Affair draft behavior
5. Manager-specific Family Affair behavior
6. Older Family Affair history
7. Live 2026 selections (highest weight once draft begins)
```

Historical behavior predicts **acquisition cost and opponent behavior**.

It should **not override player fundamentals**.

That distinction is critical.
