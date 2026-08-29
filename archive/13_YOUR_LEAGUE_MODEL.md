# 13 --- Family Affair League: Rules, Draft Structure & Quantitative Implications

**Source:** CBS Sports Fantasy screenshots supplied August 29, 2026\
**League:** Family Affair\
**Draft:** Sunday, August 30, 2026 --- 5:00 PM ET / 4:00 PM CT\
**Purpose:** Convert the observed league configuration into explicit
requirements for the Draft Edge quantitative model.

> **Evidence standard:** This file distinguishes settings directly
> visible in the supplied screenshots from assumptions or information
> that remains unobserved. Claude must not silently fill missing rules
> with CBS defaults.

------------------------------------------------------------------------

## 1. Confirmed Draft Structure

  -----------------------------------------------------------------------
  Setting                             Confirmed value
  ----------------------------------- -----------------------------------
  Draft format                        Online Standard Draft

  Rounds                              14

  Order                               Snake

  Draft order                         Custom

  Time per pick                       No Limit

  User draft slot                     **4**

  User team                           **Mama There Goes That Man**

  Visible league size                 At least 12 teams; draft-order
                                      screenshot shows positions 1--11
                                      fully and position 12 partially

  Scheduled draft                     Sun, Aug. 30, 5:00 PM ET
  -----------------------------------------------------------------------

### User's early snake selections

If the league has exactly 12 teams, slot 4 implies the following overall
selections:

`4, 21, 28, 45, 52, 69, 76, 93, 100, 117, 124, 141, 148, 165`

**Important:** Do not hard-code these overall pick numbers until the
12-team count is explicitly verified from CBS.

The engine should derive all future pick positions from:

``` text
number_of_teams
draft_slot
round
snake_direction
```

rather than storing a static pick list.

------------------------------------------------------------------------

## 2. Visible Draft Order

1.  Gladiators --- Alton Campbell
2.  Domination --- Devin O'Hara
3.  Mac Diesel --- Bryan McWilliams
4.  **Mama There Goes That Man --- Stan Pheteau**
5.  Outlaws --- David Rosario
6.  Pack Attack --- Sean Campbell
7.  Jaguars --- Wesley Landry
8.  Comets --- George Mathews
9.  Harlem Knights --- John Rosario
10. Suicide squad 84 --- Tynell Kirk
11. Black and Blue Warhorses --- Tony Duval
12. Team name/manager not fully visible in supplied screenshot

### Quant requirement

The opponent model must identify managers by a stable league/franchise
identifier when available, not display name.

Historical draft behavior should be attached to that stable
manager/franchise key so renamed teams do not lose their history.

------------------------------------------------------------------------

# 3. Confirmed Active Roster

  Slot                   Min     Max   Starter count
  ------------------ ------- ------- ---------------
  QB                       1       1               1
  RB                       2       2               2
  WR                       2       2               2
  TE                       1       1               1
  RWT (RB/WR/TE)           1       1               1
  K                        1       1               1
  DST                      1       1               1
  **Total Active**     **9**   **9**           **9**

Additional visible status limits:

  Status              Min   Max
  ----------------- ----- -----
  Active                9     9
  Reserve               0     5
  Injured Reserve       0     3
  Practice Squad        0     5
  Total                 9    22

CBS notes visible in the screenshots: - Injured Reserve players do not
count against position limits. - Practice Squad players do not count
against position limits.

### Draft-roster implication

A 14-round draft combined with 9 active slots implies **14 drafted
players if every round is used**, i.e. nine starters plus five
additional players. This matches the visible five-reserve maximum, but
Claude should still verify CBS's draft-specific position limits before
enforcing positional caps.

The supplied screenshots do **not** show the separate `Position Limits`
tab. Therefore maximum QB/RB/WR/TE/K/DST ownership during the draft
remains unconfirmed.

------------------------------------------------------------------------

# 4. Confirmed Offensive Scoring

## 4.1 Passing

  Statistic                                 Scoring
  ---------------------------- --------------------
  Passing 2-point conversion                     +2
  Passing interception                       **-1**
  Passing TD                                 **+6**
  Passing yards                  **1 per 20 yards**
  Passing TD 30--39 yards                  +1 bonus
  Passing TD 40--49 yards                  +2 bonus
  Passing TD 50+ yards                     +3 bonus
  250+ passing yards                       +1 bonus
  300+ passing yards                       +3 bonus
  400+ passing yards                       +5 bonus

### Critical interpretation

CBS documentation confirms that scoring bonuses are cumulative when
multiple thresholds are reached. Therefore, unless this league has a
position-specific override not shown:

-   a 300-yard passing game receives the 250+ and 300+ bonuses;
-   a 400-yard game receives the 250+, 300+, and 400+ bonuses.

CBS also states that scoring ranges are not cumulative while scoring
bonuses are cumulative.

This must be encoded and unit-tested rather than approximated as a
single tier.

------------------------------------------------------------------------

## 4.2 Rushing

  Statistic                             Scoring
  ---------------------------- ----------------
  Rushing 2-point conversion                 +2
  Rushing TD                                 +6
  Rushing TD 30--39 yards              +1 bonus
  Rushing TD 40--49 yards              +2 bonus
  Rushing TD 50+ yards                 +3 bonus
  Rushing yards                  1 per 10 yards
  100+ rushing yards                   +1 bonus
  150+ rushing yards                   +3 bonus
  200+ rushing yards                   +5 bonus

Again, yardage bonuses should be modeled as cumulative CBS bonuses
unless league configuration evidence establishes otherwise.

------------------------------------------------------------------------

## 4.3 Receiving

  Statistic                               Scoring
  ------------------------------ ----------------
  Receiving 2-point conversion                 +2
  Receiving TD                                 +6
  Receiving TD 30--39 yards              +1 bonus
  Receiving TD 40--49 yards              +2 bonus
  Receiving TD 50+ yards                 +3 bonus
  Receiving yards                  1 per 10 yards
  100+ receiving yards                   +1 bonus
  150+ receiving yards                   +3 bonus
  200+ receiving yards                   +5 bonus

### Reception milestone scoring

The screenshot shows:

  Receptions in a game     Bonus
  ---------------------- -------
  1--3                         0
  4--6                        +1
  7--9                        +3
  10+                         +5

This is **not conventional per-reception PPR**.

The engine must represent this as the exact CBS category/range behavior
rather than converting it to `0.5 PPR`, `1 PPR`, or another linear
approximation.

Before final implementation, verify whether CBS treats this particular
reception configuration as mutually exclusive scoring ranges or as
bonuses. The visual presentation suggests a ranged category, but the
rule compiler should confirm this from the web league
settings/test-scoring page.

------------------------------------------------------------------------

## 4.4 Place Kicking

  Statistic            Scoring
  ----------------- ----------
  Field goal                +3
  FG 30--39 yards     +1 bonus
  FG 40--49 yards     +2 bonus
  FG 50+ yards        +3 bonus
  Extra point               +1

### Potential kicker implication

If the displayed field-goal bonuses are additive to the base field
goal: - 30--39 yard FG = 4 points; - 40--49 yard FG = 5 points; - 50+
yard FG = 6 points.

The rule compiler must validate this using CBS scoring semantics/test
scoring.

Do not assume conventional kicker scoring.

------------------------------------------------------------------------

## 4.5 Miscellaneous Offense

  Statistic                           Scoring
  --------------------------------- ---------
  Fumble lost, including ST plays      **-1**
  Individual kick-return TD                +6
  Individual punt-return TD                +6

Return-TD eligibility therefore has small but real tail value for
offensive players who handle returns.

Do not give return-yard value unless a separate return-yard category is
verified.

------------------------------------------------------------------------

# 5. Confirmed DST Scoring

  Statistic                              Scoring
  ------------------------------------ ---------
  D/ST fumble recovered                       +2
  Total defensive & special-teams TD          +6
  Forced fumble                           **+1**
  Interception                                +2
  Sack                                        +1
  Safety                                      +2

## Points Allowed

  Points allowed     Fantasy points
  ---------------- ----------------
  0--1                       **15**
  2--6                       **12**
  7--10                      **10**
  11--14                      **8**
  15--19                      **6**
  20--25                      **4**
  26--30                      **2**

The supplied image ends after Safety and shows the beginning of a
`Special Teams` section below it. Those additional
defensive/special-teams categories are **not captured** and must be
obtained before declaring the DST scoring model complete.

### DST implication

This is materially richer DST scoring than many generic
projection/ranking systems.

Draft Edge must therefore: 1. project DST under this exact scoring; 2.
calculate replacement value using the league's actual DST demand; 3.
compare DST marginal value against the opportunity cost of using a
roster spot on RB/WR/TE upside; 4. avoid blindly applying the generic
heuristic "always take DST last."

The model may still conclude that late DST is optimal, but that
conclusion must come from league-adjusted marginal value.

------------------------------------------------------------------------

# 6. Why This League Is Quantitatively Unusual

The screenshots confirm several features that make generic rankings
systematically imperfect.

## 6.1 Quarterbacks are materially altered

Relative to common 4-point passing-TD / 25-yards-per-point formats, this
league visibly has:

-   6 points per passing TD;
-   1 point per 20 passing yards;
-   only -1 per interception;
-   passing-yard milestones;
-   long-TD bonuses.

This raises absolute QB scoring substantially.

**But absolute points are not enough.**

The relevant draft question is:

``` text
elite QB production
minus
replacement QB production
minus
opportunity cost at RB/WR/TE
```

With only one starting QB per team, Draft Edge must determine whether
the unusual scoring creates an *elite-QB separation* large enough to
justify earlier QB acquisition, rather than simply observing that all
QBs score more.

------------------------------------------------------------------------

## 6.2 Explosive plays have nonlinear value

30+, 40+, and 50+ TD bonuses create convex upside.

A player capable of long touchdowns has additional expected value that
ordinary season-total yard/TD projections may not represent.

Required features should include, where available: - explosive rush
rate; - deep target share; - air yards; - yards after catch; - long-TD
history with regression; - team explosive-play environment; - QB
deep-ball environment; - player speed/role archetype.

Do not overfit historical long TDs. Treat explosive-TD propensity as a
shrinkage feature.

------------------------------------------------------------------------

## 6.3 Milestone production matters

100/150/200 rushing and receiving milestones and 250/300/400 passing
milestones make the scoring function nonlinear.

Therefore:

``` text
Score(E[stats]) != E[Score(stats)]
```

in general.

This is important.

Draft Edge should apply the scoring function to simulated weekly
statistical outcomes and then average fantasy points.

It should **not** merely apply milestone bonuses to a player's average
projected stat line.

------------------------------------------------------------------------

## 6.4 Receptions have threshold value

The 4/7/10 reception thresholds reward high-volume games without
conventional linear PPR.

Consequences: - target concentration matters; - probability of crossing
a reception threshold matters; - weekly reception variance matters; - a
10-catch ceiling has nonlinear value; - low-volume receptions provide
little/no reception-category benefit.

The model therefore needs a weekly reception distribution, not merely
season receptions.

------------------------------------------------------------------------

## 6.5 Flex increases RB/WR/TE competition

The seventh offensive skill starter is one RWT flex.

The relevant replacement system should solve the entire lineup jointly.

For each simulated roster:

``` text
maximize projected/simulated lineup score
subject to:
  QB = 1
  RB = 2
  WR = 2
  TE = 1
  RWT from {RB, WR, TE} = 1
  K = 1
  DST = 1
```

This should use assignment optimization rather than independent static
replacement ranks.

------------------------------------------------------------------------

# 7. Required Weekly Scoring Function

The scoring engine should be capable of evaluating a weekly stat vector:

``` text
passing_yards
passing_tds
passing_td_lengths[]
interceptions
passing_two_point_conversions

rushing_yards
rushing_tds
rushing_td_lengths[]
rushing_two_point_conversions

receptions
receiving_yards
receiving_tds
receiving_td_lengths[]
receiving_two_point_conversions

fumbles_lost
kick_return_tds
punt_return_tds
```

plus kicker and DST stat vectors.

For nonlinear categories, compute the exact weekly score.

Example pseudocode:

``` python
def cumulative_bonus(value, thresholds):
    return sum(points for threshold, points in thresholds if value >= threshold)

passing_points = (
    floor(passing_yards / 20)
    + 6 * passing_tds
    - interceptions
    + cumulative_bonus(passing_yards, [(250,1), (300,3), (400,5)])
    + sum(long_td_bonus(length) for length in passing_td_lengths)
    + 2 * passing_two_point_conversions
)
```

**Important:** Whether yardage is fractional or integer/range-scored
must be validated against the exact CBS league scoring configuration.
The screenshot text `20 PaYd = 1`, `10 RuYd = 1`, etc. alone does not
prove fractional versus completed-range treatment.

------------------------------------------------------------------------

# 8. Projection Transformation Requirement

Generic FantasyPros projected fantasy points must **not** be the primary
projection input for this league.

Preferred pipeline:

``` text
raw statistical projections
        ↓
weekly/statistical distributions
        ↓
Family Affair scoring function
        ↓
weekly fantasy distribution
        ↓
season / playoff simulations
```

Raw projection fields should include at minimum:

QB: - attempts/completions if useful; - passing yards; - passing TD; -
INT; - rushing yards; - rushing TD.

RB/WR/TE: - rush attempts; - rushing yards; - rushing TD; - targets; -
receptions; - receiving yards; - receiving TD.

Additional models estimate: - milestone probabilities; - long-TD
probability; - weekly variance.

------------------------------------------------------------------------

# 9. Draft-Slot-Specific Option Value

The user drafts from slot 4.

The live optimizer must not answer:

> "Who is the best available player?"

It must answer:

> "Which player should be selected now, given the probability that every
> alternative survives until the user's next selection?"

For candidate `p`:

``` text
NowValue(p)
+ FutureRosterValue(after selecting p)
- OpportunityCost(p)
+ ScarcityUrgency(p)
+ LeagueSpecificEdge(p)
```

The snake-turn geometry is important.

Near the 4/21, 28/45, etc. gaps, player-survival probabilities should be
conditioned on: - which managers pick between the user's turns; - their
current rosters; - their historical tendencies; - current draft
behavior; - national ADP; - FantasyPros ECR; - positional runs.

------------------------------------------------------------------------

# 10. Historical League Behavior: Data Model

The screenshots establish current league rules and manager/draft-order
context but do **not** contain historical draft results.

Historical behavior should be ingested separately if CBS league history
can export it.

For every historical selection store:

``` text
season
round
overall_pick
manager_id
franchise_id
player_id
position
ADP_at_draft
ECR_at_draft
league_adjusted_rank_at_draft
manager_roster_before_pick
```

Then estimate manager tendencies such as: - positional timing; - ADP
reach tendency; - QB aggression; - TE aggression; - RB/WR preference; -
rookie preference; - favorite-team bias only if statistically
supported; - reaction to positional runs; - bench construction; - K/DST
timing.

Use hierarchical shrinkage.

Historical manager behavior is evidence, not destiny.

Current-draft behavior should update those priors in real time.

------------------------------------------------------------------------

# 11. New Model Features Required by These Rules

Add to the existing Draft Edge model:

### Player-level

-   `prob_100_rush`
-   `prob_150_rush`
-   `prob_200_rush`
-   `prob_100_rec`
-   `prob_150_rec`
-   `prob_200_rec`
-   `prob_250_pass`
-   `prob_300_pass`
-   `prob_400_pass`
-   `prob_4_receptions`
-   `prob_7_receptions`
-   `prob_10_receptions`
-   `expected_long_td_bonus`
-   `return_td_expected_value`

### League-level

-   exact scoring-rule version;
-   bonus semantics;
-   scoring-range semantics;
-   position-specific overrides;
-   position limits;
-   roster status rules.

### Draft-level

-   user slot;
-   exact snake sequence;
-   next-user-pick;
-   picks until next user selection;
-   manager-specific survival probability.

------------------------------------------------------------------------

# 12. High-Priority Hypotheses to Backtest

Do **not** hard-code these as strategy. Test them.

### H1 --- Elite QB premium

The combination of 6-point passing TDs, 20 passing yards/point, low INT
penalty and bonuses may increase elite-QB VORP.

### H2 --- Dual-threat QB premium

Rushing retains full 1/10 and 6-point rushing TD value while passing is
also rich. Dual-threat elite QBs may have especially valuable weekly
ceilings.

### H3 --- Explosive WR premium

Long-TD and yardage milestones may increase the value of true
deep/explosive WR profiles relative to possession profiles at equal
conventional projection.

### H4 --- High-volume receiver premium

Reception thresholds may favor target monopolists whose weekly catch
distributions frequently cross 7 and 10.

### H5 --- Bell-cow RB premium

100/150/200 rushing bonuses plus full receiving-yard scoring and
reception thresholds may create unusually valuable true three-down
backs.

### H6 --- Elite TE question

Only one TE is mandatory, but an elite TE also competes for the RWT
slot. Test elite-TE separation against replacement and flex opportunity
cost.

### H7 --- DST may be less replaceable

The aggressive points-allowed schedule plus forced-fumble scoring may
widen DST distributions enough to affect draft timing.

### H8 --- Kicker distance matters

If field-goal bonuses are additive, long-distance kickers may have more
differentiation than generic rankings imply.

Each hypothesis must be evaluated with historical weekly stats scored
under these exact rules.

------------------------------------------------------------------------

# 13. Information Still Needed

The current screenshots are enough to materially improve the model, but
not enough to declare the league schema complete.

Obtain/verify:

1.  Exact number of teams.
2.  Full 12th (and any later) draft-order entries.
3.  `Position Limits` tab.
4.  Remaining defensive `Special Teams` scoring below the supplied
    screenshot.
5.  Any additional offensive categories below the visible area.
6.  Any position-specific scoring overrides.
7.  Scoring policies / matchup format and tiebreakers.
8.  Playoff structure: teams, weeks, reseeding, byes, championship
    format.
9.  Waiver system / FAAB.
10. Trade rules/deadline.
11. Keeper/dynasty rules if any.
12. Historical drafts and standings, ideally 3--5 seasons.
13. Historical weekly scoring if exportable.

These should become a machine-readable `league_config.yaml` after
verification.

------------------------------------------------------------------------

# 14. Machine-Readable Draft Configuration --- Preliminary

``` yaml
league:
  name: Family Affair
  provider: CBS Sports Fantasy
  season: 2026
  teams: UNVERIFIED_AT_LEAST_12

draft:
  type: snake
  rounds: 14
  order_type: custom
  time_per_pick: no_limit
  user_slot: 4

roster:
  active: 9
  reserve_max: 5
  injured_reserve_max: 3
  practice_squad_max: 5
  starters:
    QB: 1
    RB: 2
    WR: 2
    TE: 1
    RWT: 1
    K: 1
    DST: 1

scoring:
  passing:
    yards_per_point: 20
    touchdown: 6
    interception: -1
    two_point_conversion: 2
    yardage_bonuses:
      250: 1
      300: 3
      400: 5
    td_length_bonuses:
      "30-39": 1
      "40-49": 2
      "50+": 3

  rushing:
    yards_per_point: 10
    touchdown: 6
    two_point_conversion: 2
    yardage_bonuses:
      100: 1
      150: 3
      200: 5
    td_length_bonuses:
      "30-39": 1
      "40-49": 2
      "50+": 3

  receiving:
    yards_per_point: 10
    touchdown: 6
    two_point_conversion: 2
    yardage_bonuses:
      100: 1
      150: 3
      200: 5
    td_length_bonuses:
      "30-39": 1
      "40-49": 2
      "50+": 3
    receptions:
      "1-3": 0
      "4-6": 1
      "7-9": 3
      "10+": 5
      semantics: VERIFY_RANGE_VS_BONUS

  misc_offense:
    fumble_lost_including_st: -1
    individual_kick_return_td: 6
    individual_punt_return_td: 6

  kicking:
    field_goal_base: 3
    field_goal_length_bonus:
      "30-39": 1
      "40-49": 2
      "50+": 3
    extra_point: 1

  dst:
    fumble_recovered: 2
    forced_fumble: 1
    interception: 2
    touchdown: 6
    sack: 1
    safety: 2
    points_allowed:
      "0-1": 15
      "2-6": 12
      "7-10": 10
      "11-14": 8
      "15-19": 6
      "20-25": 4
      "26-30": 2
    remaining_special_teams_rules: UNOBSERVED
```

------------------------------------------------------------------------

# 15. Implementation Instruction for Claude

Before building the ranking engine:

1.  Implement the league schema.
2.  Encode every confirmed rule above.
3.  Mark every unconfirmed field explicitly.
4.  Create scoring fixtures for threshold boundaries.
5.  Validate cumulative CBS bonus behavior.
6.  Validate range/fractional yardage behavior.
7.  Validate reception-range behavior.
8.  Re-score historical NFL weekly statistics under Family Affair rules.
9.  Calculate positional distributions and replacement curves.
10. Only then compare league-adjusted values with FantasyPros ECR/ADP.

The algorithm must learn **where the market is mispricing this league**,
not merely reskin consensus rankings.

------------------------------------------------------------------------

# 16. Strategic Bottom Line

This league is sufficiently non-standard that the custom scoring engine
is not optional.

The clearest potential sources of edge are:

-   richer QB scoring;
-   nonlinear yardage milestones;
-   long-touchdown bonuses;
-   threshold-based reception scoring;
-   unusual DST scoring;
-   potentially stronger long-FG scoring;
-   flex-aware replacement value;
-   opponent-specific behavior from a stable recurring league.

The central quantitative task is to determine which of those rules
create **relative scarcity and replacement-value differences**, rather
than simply identifying positions that score more raw points.

That distinction should govern every Draft Edge recommendation.
