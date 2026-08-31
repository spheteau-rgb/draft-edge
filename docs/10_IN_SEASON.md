# 10 — In-Season Mode (Draft Edge → Season Edge)

Draft is complete. This doc is the plan for the in-season half of the product.
Read after docs/01–09. Everything here obeys the same non-negotiables in
CLAUDE.md, with one relaxation noted in §9.

---

## 0. The reframe

The draft engine answered **one question, 14 times**: *who do I pick?*

The in-season engine answers **one question, continuously**:

```
Δ = Value(my roster AFTER a mutation) − Value(my roster NOW)
```

where `Value` = the probability-weighted output of my **best legal starting
lineup**, over the **remaining weeks**, under **exact Family Affair scoring**.

Every in-season decision is the same computation with a different mutation:

| Decision | Mutation | Priced in |
|---|---|---|
| Start / sit | lineup assignment only | P(beat this week's opponent) |
| Waiver claim | add X, drop Y | FAAB dollars |
| Free-agent add | add X, drop Y | $0 (Wed→kickoff window) |
| Trade | multi-player swap | Δ for both sides |
| Drop / stash | remove X | roster-spot opportunity cost |

This is why the pivot is cheaper than it looks: `lib/lineup.ts:bestLineup()`
already solves the flex-aware optimal lineup, and `precompute/build_players.py`
already runs a Monte Carlo over `core/scoring.py`. We are re-scoping existing
machinery from "season totals" to "per-week distributions," not rebuilding.

---

## 1. League mechanics that drive the design

From the commissioner's waiver email + `core/league_config.yaml`:

- **FAAB auction, $100/team/season.** Bids open once the player's NFL team has
  started play. Bids close **Tuesday 11:00 PM CT**. Awards announced
  **Wednesday morning**.
- **Hard lockout:** a team that exhausts its budget cannot bid *at all* for the
  rest of the auction period.
- **Unrestricted free agency** from after the draft until Week 1 kickoff, and
  again **every week from Wednesday 8:00 AM CT onward** — first come, first
  served, no bid required, right up until a player's game starts.
- Starters: QB1 / RB2 / WR2 / TE1 / RWT-flex1 / K1 / DST1 = 9 active.
  14 roster spots. `reserve_max: 5`, `practice_squad_max: 5`, `IR: 3` — **all
  three are UNVERIFIED; see §11.**

### Three structural edges this league hands us

**(a) The Wednesday window.** Any player who clears waivers unclaimed is *free*
on Wednesday. Therefore: **never spend FAAB on a player nobody else wants.**
FAAB is only for genuinely contested adds. Streamers, bye fillers and deep
stashes should cost $0 every single time.

**(b) The Wednesday 8:00–10:00 AM CT drop harvest.** Teams that *won* claims
must drop someone to make room. For two hours every week a batch of useful
players hits an open, unrestricted pool. Nobody watches this systematically.

**(c) Sunday inactive sniping.** Official inactives drop ~90 minutes before
kickoff (≈11:30 AM ET early slate, ≈2:30 PM ET late). Because our FA window is
unrestricted rather than continuous-waivers, we can add the backup of a
surprise-inactive starter **and start him that day**. This is the highest-EV
free action available in this league and no bid can buy it.

These three are worth more than any projection improvement. Build them.

---

## 2. Manual input protocol — LOCKED

**Decision: there will be no CBS API sync.** All league state arrives by
copy-paste. This is a hard constraint, not a fallback, and the whole design is
built around it. `CBS_LEAGUE_ID` / `CBS_ACCESS_TOKEN` stay empty; delete the
CBS-sync slice from the plan.

Two principles follow, and both are load-bearing:

### 2.1 Snapshots replace state. Never append.

The draft store was an **append-only event log** and it drifted +4 picks by the
end (see §12). Every incremental-update design accumulates drift silently, and
drift is invisible until it has already corrupted a decision.

So the in-season store inverts it: **a paste is a declarative snapshot that
REPLACES the slice of state it describes.** Paste your roster → that *is* your
roster, whatever we thought before. Paste the available list → that *is* the FA
pool. Each paste is idempotent; pasting the same thing twice is a no-op; a
missed week self-heals on the next paste rather than compounding.

The app shows a **reconciliation diff** on every paste ("+2 added, −1 dropped,
3 unresolved") so a bad paste is visible immediately instead of silently
poisoning state. **The parser must never silently drop a line** —
`lib/bulkParse.ts` already returns an `unresolved` bucket; surface it loudly.

### 2.2 Every input is optional. The app degrades, never blocks.

Same posture as draft day: there is always an answer.

| What you paste | What you get |
|---|---|
| My roster + available players + opponent | Full: win-probability lineup, calibrated FAAB bids, drop advice |
| My roster + available players | FAAB bids + lineup by expected points (no win-prob) |
| My roster only | Lineup only |
| Nothing | Last known state, flagged stale via the existing freshness badge |

### 2.3 The input is **screenshots**, not pasted text

Confirmed from the user's own Week 1 samples: league state lives in the **CBS
Sports mobile app**, where rows are rendered views with no selectable text.
There is nothing to copy. The unit of input is a **phone screenshot**.

This kills the text-parser design (see 2.4) and replaces it with a far cheaper
one — but it also hands us better data than the paste plan assumed, because
CBS's own screens are denser than its text exports.

**The three screens, ranked by value:**

**① Matchup (`Matchup` tab) — the single highest-value screen.**
Scroll-captures both teams head-to-head and yields, in one artifact:
- my full 9-slot starting lineup *with slot labels* (QB/RB/RB/WR/WR/TE/RWT/K/DST)
- my 5 reserves
- **the opponent's** starters and reserves
- **CBS per-week point projections for every player on both sides**
- both projected totals and the live win%

That is items ①-roster and ②-opponent from the old plan, plus a weekly
projection column the paste plan did not have. **Two screenshots covers it**
(top of the list, then scrolled to the bottom).

**② Add Player → Free Agents (`+ Player`).** Set the sort filter to
`2026 Proj` and the position filter as needed (`All Offense`, then `K`, then
`DST`). Each row: name, position, team, injury tag, opponent, and season
`FPTS`. Two to three screenshots per filter gets the top ~20, which is all the
waiver math needs — the tail is worth $0 by construction (§1a).

**Every position must be captured, including K and DST.** This is the one input
requirement the engine cannot degrade around: an empty starter slot is priced at
the best free agent at that position (§1a), so a position with no captured free
agent is priced at zero, which inflates the marginal value of everyone you
already roster there and can manufacture a hold. Observed in the Week 1 run —
with a QB-filtered capture, the lone K and DST scored 136 and 213 marginal ROS
against a true value near a streamer's. The brief now names the missing
positions rather than quietly using the bad number.

**③ Transaction log, with winning bid amounts** *(weekly, after Wednesday
awards)*. Still the highest-value optional input: there is no public dataset of
FAAB clearing prices, so **this league's own history is the only training data
that exists** for §3.2. Screenshot it the same way.

**Cadence:** ① on Sunday morning (and again Tuesday if the roster changed),
② on Tuesday before the 11 PM CT deadline and again Wednesday morning, ③ after
awards. Total ~6-8 screenshots a week, zero typing.

### 2.4 Ingest: transcription, not parsing

`lib/bulkParse.ts` stays where it is — it is a *draft-day text* parser and there
is no longer any text to feed it. Do not generalize it to four shapes; that work
is now dead.

Instead, ingest is a **vision transcription step that runs off the live path**:
screenshots → structured snapshot JSON → committed to `data/season/`. The app
itself never does OCR; it reads validated snapshots. This keeps CLAUDE.md
non-negotiable #1 intact by construction — no model call sits between the user
and a recommendation, because transcription happens weekly and offline, not per
request.

Two implementations, in order:
1. **Now (zero build):** the user drops screenshots into a Claude Code session;
   Claude transcribes them into the snapshot file. Works today, no code.
2. **Later (only if the manual step chafes):** an upload endpoint that calls the
   Anthropic vision API and writes the same JSON, with the same validator. The
   schema is the contract, so this swap is invisible to every downstream module.

The snapshot schema and validator are the real Slice 0 deliverable. Invariants:
- **Snapshot-replace** (§2.1) — a new snapshot for a week overwrites that week.
- **Every transcribed row resolves to a `player_id` or lands in `unresolved`.**
  Never silently drop, and never guess across an ambiguous abbreviated name.
- **Slot labels are recorded as observed**, so "what CBS has me starting" and
  "what the optimizer wants" are separable — the diff between them *is* the
  start/sit brief.
- CBS's own projection is stored as `cbs_proj_week`, **advisory only**. It never
  enters the math; it exists so we can show where our model disagrees with the
  room's default view (same posture as `community_note` on draft day).

> ⚠️ **The player universe must still expand.** `data/players.json` holds 598
> players — the draft-relevant top. Waiver breakouts are frequently outside it,
> so transcribed free agents will land in `unresolved` until the weekly build
> ingests every player with a projection.

### What the app will NOT do

It will not execute transactions. Submitting a claim, a trade offer, or a lineup
is an irreversible action on a shared system, and CBS offers no sanctioned write
API. The deliverable is a **decision brief with exact actions** — "bid $23 on
Player X, drop Player Y" — that the user executes in two taps. This boundary is
deliberate, not a limitation to be engineered around.

---

## 3. The three algorithms that make this good, not generic

### 3.1 Win-probability start/sit (not points-maximizing)

Head-to-head is not "maximize expected points," it is **"maximize P(outscore
this specific opponent)."** We already produce per-player weekly Monte Carlo
distributions, so we can simulate my lineup total against the opponent's
lineup total and choose the lineup that maximizes P(win).

The favorite/underdog variance lever falls out of the math automatically:
- Comfortable favorite → the optimizer picks the **high-floor** player, because
  reducing variance raises P(win) when the mean margin is already positive.
- Big underdog → it picks the **high-ceiling** player, because floor is
  worthless when losing ends the week.

Same-team correlation is a first-class input (a QB+WR stack raises lineup
variance — good when trailing, bad when leading). Reference implementation of
this approach: Nathan Braun's Fantasy Math.

*This is the single most valuable differentiator, and we are one of the few
setups that can do it — because we have exact Family Affair scoring, not
generic PPR, feeding the distributions.*

### 3.2 FAAB reservation price from a dynamic program (not a heuristic table)

The lockout rule ("broke = cannot bid") makes the last dollar strictly more
valuable than any linear model implies — it carries an **option premium** on
future league-winners.

Model it properly:

```
state:   (week w, my budget b, rivals' remaining budgets B)
fit:     distribution of "best available add ΔROS" per future week
solve:   backward induction → reservation curve R(w, b)
bid:     up to the point where the marginal dollar's value ≥ the expected
         future value of holding that dollar
```

Two refinements that matter:
- **Never bid to $0.** Hold a floor of ~$5–10 so we retain the ability to win
  uncontested $1–2 claims all season.
- **Rival budgets are public information.** A team at $3 cannot outbid us. The
  required bid is a function of the *live* budget distribution, not the
  season-start one. Track every team's spend from the transaction log.

Sanity-band the DP output against published consensus so it can never produce
something absurd:

| Archetype | Band (% of $100) |
|---|---|
| True league-winner (backup RB inherits full 3-down role) | 35–60% |
| New every-week starter (real target share / committee lead) | 15–30% |
| Speculative flex upside | 5–12% |
| Bye-week filler | $0–3 |
| Streaming DST / K | **$0–2, no exceptions** |

Bid in **odd, non-round numbers** ($11, $26, $51) — the room anchors on
$10/$25/$50.

### 3.3 Opportunity signals that lead the projection

FantasyPros will not reprice a breakout until *after* the box score, which is
one week too late. The waiver edge is buying the **role change**, not the
result. Ranked signal strength:

1. **Snap-share week-over-week delta** (50% → 80% is the classic tell)
2. **Route participation** — see the data caveat in §4
3. **Target share** (20%+ in a game = immediate add trigger; best single
   predictor of future receiving production)
4. **Red-zone / inside-20 opportunity share**
5. **Air yards / aDOT** (combine with #3 for a WOPR-style composite)
6. **Depth-chart and backfield-committee deltas**

These feed an `OPPORTUNITY_SPIKE` adjustment that can lift a free agent's ROS
projection **above** the FantasyPros consensus — the only way to be early.

### 3.4 MARKET_BLIND_SPOT — the Fannin play, in-season

The best pick of the draft was Harold Fannin Jr. at #76 (+7.84 vs pick average,
TE grade A). It worked because FundamentalRank and LeagueMarketRank were
computed **separately** and never blended before the optimizer ran — our exact
Family Affair scoring liked him, the room hadn't caught up, and we paid market
price for above-market value.

The in-season analogue is exact, and it is the core FAAB bargain detector:

```
our ΔROS (exact Family Affair scoring)   = high
room's perceived demand                  = low
  ⇒ MARKET_BLIND_SPOT — bid low, likely uncontested, or take him free Wednesday
```

Demand proxies, none requiring user input: Sleeper trending-adds volume,
FantasyPros ECR vs. our own rank, and — best of all once we have a few weeks of
③ transaction pastes — **what this specific room actually paid** for comparable
archetypes. Keep the two ranks separated end-to-end, exactly as docs/03 does for
the draft. Never blend before pricing.

### 3.5 The one computation everything reduces to

```
ROSValue(roster) = Σ  bestLineup( playersAvailable(roster, w) ).totalValue
                  w = current_week .. 18

playersAvailable(roster, w) = roster minus (on bye in w) minus (OUT/IR in w)
```

```
Δ(add f, drop d) = ROSValue(roster − d + f) − ROSValue(roster)
```

This single formula is doing almost all of the strategic work, and it is worth
being explicit about *why*, because each of these is a distinct way naive
waiver tools go wrong:

- **Bench players only count when they would actually start.** A WR6 in a
  start-2-plus-flex league contributes ~0 to `ROSValue` — the engine cannot
  talk itself into hoarding a position. This is structurally the same fix as
  §12.1; the draft's WR-quota bug is inexpressible here.
- **Bye coverage is priced automatically**, because a player on bye in week `w`
  is simply absent from week `w`'s lineup. The Darnold trap (a QB2 whose bye
  collides with your QB1's) shows up as a near-zero Δ without any special case.
- **Cross-position raw points never get compared.** A 384-point QB and a
  99-point WR are only ever compared through their effect on a legal lineup.
- **This week is not privileged.** Summing to week 18 means a bye or a one-week
  injury cannot make a good player look droppable.

### 3.6 Retention and add-quality guards

The Δ above is mean-based. That is the right default, but it is blind in three
specific ways, and each blindness maps to a classic, expensive waiver mistake.
The guards exist to cover exactly those gaps — they are not a second opinion on
the math, they are the parts the math structurally cannot see.

**Drop guards** — block or downgrade a proposed drop:

| Guard | Fires when | The mistake it prevents |
|---|---|---|
| `IN_OPTIMAL_LINEUP` | the player starts in the ROS-optimal lineup | dropping a starter for a bench body |
| `INJURED_STUD` | currently OUT/IR but ROS value is top-N on the roster | **the single most expensive waiver error** — dumping a hurt stud for a streamer with a good week. Benches exist to absorb this |
| `BYE_CRITICAL` | removing them leaves a future week with an unfillable slot | trading a known future zero for a marginal present gain |
| `LAST_AT_POSITION` | roster would fall below starter requirement at QB/TE/K/DST | self-explanatory, and easy to do accidentally at TE |
| `UPSIDE_STASH` | high `p90`-to-mean ratio | dropping the league-winner archetype for a flat streamer with a better mean. **Δ uses means and cannot see tails** |
| `TRADE_CURRENCY` | positional surplus with real trade value | dropping an asset that should be sold instead (the current RB surplus) |

`IN_OPTIMAL_LINEUP`, `BYE_CRITICAL` and `LAST_AT_POSITION` are hard blocks — Δ
would already price them, and if it somehow does not, the guard caught a bug.
`INJURED_STUD`, `UPSIDE_STASH` and `TRADE_CURRENCY` are genuine overrides of the
mean-based Δ and must be surfaced as reasons, never applied silently.

**Add guards** — block a pickup that looks good and is not:

| Guard | Fires when | The mistake it prevents |
|---|---|---|
| `NO_LINEUP_PATH` | the add never enters the optimal lineup in any remaining week | the whole class of "best player available by projection" errors |
| `BYE_COLLISION` | the add's bye matches the starter they exist to cover | the Darnold trap, named explicitly so the reason is legible |
| `MARGINAL_CHURN` | Δ below `min_ros_gain` for the current window | churn. Every add forfeits the dropped player's tail and burns a roster spot |
| `STREAMER_NOT_ASSET` | Δ concentrated in ≤2 weeks | paying a roster spot all season for a matchup play. Take him free that Wednesday instead |

**The threshold is window-dependent**, and this matters more than it sounds. In
the Wednesday unrestricted window an add costs only the dropped player's tail,
so the bar is low. Under FAAB it also costs dollars *and* the hard-lockout
option value from §3.2, so the bar is materially higher. One config knob per
window, never a hardcoded constant.

Every recommendation must state the **runner-up it beat** and any guard that
fired, so a bad call is auditable after the fact rather than mysterious.

---

## 4. Data plan

| Need | Source | Auth | Notes |
|---|---|---|---|
| **Weekly raw stat projections** | FantasyPros `/nfl/2026/projections?week=N` | existing key | ✅ verified live: returns raw stat lines (`rush_att`, `rec_rec`, …) so `core/scoring.py` applies directly. **This is the backbone.** |
| Injuries / news | FantasyPros `/nfl/injuries`; ESPN team-injuries endpoint; Sleeper `injury_status` | key / none | ✅ verified live. nflverse `load_injuries()` is **broken for 2025+** — do not use |
| Snap counts | nflverse `load_snap_counts()` | none | PFR-sourced, updates 4×/day in season |
| Target share, air yards, RZ usage | computed from nflfastR play-by-play | none | pbp ~15 min post-game |
| Depth charts / rosters | nflverse `load_depth_charts()` | none | daily 07:00 UTC |
| Routes run | ⚠️ **not available free in-season** — nflverse participation is FTN-supplied and post-season only | — | Proxy: pass-snaps from snap counts → targets per pass-snap |
| Contested-bid demand proxy | Sleeper `/v1/players/nfl/trending/add` | none | predicts which adds will be contested → drives §3.2 |
| Implied team totals | The Odds API | free key | 500 credits/mo; a weekly NFL pull is ~1 credit. Implied total = (O/U ± spread)/2. **Dominant predictor for K** (27+ implied ≈ 2× the rate of 10-pt games) and for DST |
| Wind / weather | Open-Meteo + a stadium lat/lon + roof table | none | <12 mph ≈ no effect; 15–20 pressures passing/K; 25+ materially suppresses passing |
| League state | **manual paste** | — | see §2. No CBS API |

Worth mining rather than reinventing: **ffopportunity** (xgboost Expected
Fantasy Points on nflfastR pbp — exactly the "opportunity not results" metric),
**ffanalytics** (multi-source projection aggregation, maps onto our docs/03
N-based ensemble rule), **ffscrapr** (league-state normalization reference).

> **Cost risk:** the FantasyPros API is credit-priced and returns 429 on
> overage. Naively pulling 6 positions × 15 remaining weeks every week is ~90
> calls/week. Mitigation: pull week W weekly, refresh the far-future weeks only
> monthly, and cache aggressively (the `_write_cache`/`_read_cache` pattern in
> `precompute/ingest_fantasypros.py` already exists). **Measure actual credit
> burn in Slice 1 before committing to a cadence.**

---

## 5. Vertical slices

Each slice is independently useful and independently verifiable.

**The product is one artifact: the weekly brief.** Screenshots in, brief out.
It answers exactly two questions — *who do I start* and *who do I add/drop* —
and nothing else competes for space. Slices 0–2b build that end to end; every
later slice makes it smarter without changing the interaction.

**Slice 0 — Snapshot pipeline.** ✅ **DONE.** `lib/season/snapshot.ts`: schema,
snapshot-replace read/write, and a resolver that routes ambiguous rows to
`unresolved` rather than guessing. Transcription is the ingest step (§2.4).
*Verified:* Week 1 transcribed and cross-checked against four of CBS's own
section totals (105.0 / 114.6 / 1841.1 / 605.0, all exact); 45/45 rows resolve
uniquely against `players.json`.

**Slice 2a — The engine.** `lib/season/value.ts` (§3.5 `ROSValue`, weekly
availability), `lib/season/startsit.ts` (win-probability lineup, §3.1), and
`lib/season/moves.ts` (Δ over every legal add/drop pair, plus the §3.6 guards).
*Done when:* the guard suite is green — a hurt stud survives a streamer with a
better single week, a bye-colliding QB2 is rejected in favour of a lower-
projected one, and a WR6 add is rejected for `NO_LINEUP_PATH`.
✅ **DONE.** `scripts/test_season_guards.ts`, 10 assertions green.
One design correction fell out of it: `STREAMER_NOT_ASSET` originally hard-
blocked any add that started in ≤2 weeks, which also blocked the one case where
a short-duration add is correct — a bye-week fill at a position with no
streamable replacement. It is now gated on `guards.streamer_override_ros`, so it
rejects small short-duration value and lets large irreplaceable value through.
The draft path is unaffected: `core/test_scoring.py` (52) and
`scripts/test_lookahead_equiv.ts` (6 cases, Δ≤1e-9) both still pass after the
`lib/lineup.ts` changes.

**Slice 2b — The brief.** `lib/season/brief.ts` assembles one object; a route
and a mobile-first page render it. Shows the moves, the runner-up each beat,
the guards that fired, and an explicit **holds-considered-and-rejected** list so
inaction is visible as a decision rather than an omission.
*Done when:* the Week 1 snapshot produces the brief with no manual steps.
✅ **DONE.** `GET /api/brief?season&week&window` + `/week`, verified rendering
the Week 1 brief end to end at mobile width.

**Slice 1 — Weekly value engine.** `precompute/build_week.py`: FantasyPros
weekly projections for weeks W…18 → `core/scoring.py` → Monte Carlo (N=2000,
seeded) → `data/weeks/2026-wNN.json` carrying per-player weekly distribution +
an ROS aggregate. Reuses `build_players.py`'s MC nearly wholesale.
*Done when:* same seed → byte-identical output; three players' scoring
reproduced by hand; `core/test_scoring.py` still green.

**Slice 2 — In-season league state.** Generalize `lib/store.ts`: the event log
gains `add`, `drop`, `trade`, `lineup_set`, `faab_spend`. Seed from the completed
draft log. `LeagueState` = 12 rosters + derived FA pool + FAAB balances +
schedule + current week.
*Done when:* replaying the draft plus 5 synthetic transactions yields correct
rosters and budgets.

**Slice 3 — Win-probability start/sit.** `lib/winprob.ts` (§3.1). Enumerate legal
lineups, simulate vs. the opponent's projected lineup, argmax P(win).
*Done when:* a synthetic underdog scenario correctly flips to the
higher-variance player and a favorite scenario correctly flips to the floor.

**Slice 4 — Waiver / FA engine + FAAB pricing.** ΔROS for every (add, drop) pair
over the FA pool; DP reservation price (§3.2); rival-budget aware. Output splits
into **"BID $N"** vs **"FREE — grab Wednesday."**
*Done when:* K/DST never price above $2, and a synthetic league-winner prices
inside the 35–60% band.

**Slice 5 — Opportunity signals (nflverse).** §3.3 → `OPPORTUNITY_SPIKE`.
*Done when:* backtested on 2025 — the flag fires *before* the consensus reprices.

**Slice 6 — Game environment.** Implied totals + wind, applied specifically to
K / DST / QB streaming decisions.

**Slice 7 — In-season UI.** `/lineup`, `/waivers`, `/league`. Same design
language as the draft screen. **Mobile-first** — the Sunday inactive check
happens on a phone at 11:30 AM.

**Slice 8 — Trade evaluator.** Δ starting-lineup ROS for both sides, ~20%
discount applied to the two-player side of a 2-for-1 (consolidation premium is
real: you only start 9), plus a "would they accept?" read from the counterparty's
roster holes.

**Slice 9 — Scheduled briefs.** See §6.

**Slice 10 — Sunday inactives sniper.** §1(c). Poll inactives ~90 min pre-kickoff,
cross-reference my starters against the best FA at that position, push an alert.

### Sequencing against the calendar

Week 1 kickoff is roughly ten days out, and **the unrestricted FA window is open
right now** — so there is an immediate, actionable deliverable before any of
this ships.

- **Immediate:** Slices 0 → 1 → 2, then a one-off **pre-Week-1 FA sweep** while
  adds are still unrestricted and free. Two specific targets, both from §12:
  drop the WR4/WR5 dead weight (Pittman 2.92 TPV, Reed 1.98 TPV) and convert
  those spots into a **QB2** — Stafford is a 1-QB punt that worked, but he has a
  bye and bad matchups, and the fix is a $0 Wednesday-window stream, never a
  FAAB bid — plus one high-upside stash. The RB surplus (Taylor, Love, Jacobs,
  Henderson, Hubbard — five backs for two-plus-flex) is trade currency, not
  something to drop.
- **By first waiver Tuesday:** Slice 4.
- **By Week 3:** Slices 3, 5, 6, 7, 10.
- **After:** Slices 8, 9.

---

## 6. Operating cadence

| When | Brief | Contents |
|---|---|---|
| **Tue 6:00 PM CT** | Waiver Board | Ranked claims with exact $ bids, paired drops, and the "don't bid — free Wednesday" list. 5 hours before the 11 PM close |
| **Wed 8:05 AM CT** | FA Sweep | Post-waiver drop harvest (§1b) + uncontested targets |
| **Thu 4:00 PM ET** | TNF lock | Only if a TNF player is involved |
| **Sun 11:15 AM ET** | Inactives + final lock | Snipe alerts (§1c) + final lineup |
| **Sun 7:00 PM ET** | Live leverage | If trailing into MNF, which ceiling play maximizes P(win) |
| **Tue AM** | Recap | What usage actually changed; buy-low / sell-high board |

Implemented with the scheduled-task runner. Trade windows to surface
proactively: **Weeks 3–6** (managers overreact to small samples while usage data
is already informative) and the **2–3 weeks before the deadline**.

---

## 7. What we already have that carries over

- `core/scoring.py` + 52 passing tests — untouched, still the ground truth
- `precompute/build_players.py` Monte Carlo — re-scoped per-week
- `lib/lineup.ts:bestLineup()` — becomes the start/sit *and* trade *and* waiver
  evaluator
- `lib/vorp.ts` dynamic replacement — becomes the FAAB reservation baseline
- `lib/store.ts` event-log-as-source-of-truth — generalizes to transactions
- `lib/bulkParse.ts` — promoted from draft-day fallback to **the** input path
- `data/family_affair_history_full.json` — 5 drafts of manager tendencies;
  in-season we start accumulating *transaction* history, which is better

---

## 8. Risks / pre-mortem

| Risk | Mitigation |
|---|---|
| **Paste fatigue** — the user stops pasting by Week 6 and the tool dies | Ruthlessly minimize: 3 pastes/week, each scoped to one decision, each optional (§2.2). If a paste is skipped, still produce an answer and say what it's missing |
| **State drift from manual input** (the draft's +4 bug, §12) | Snapshot-replace semantics + reconciliation diff + loud `unresolved` reporting (§2.1). Structural, not a patch |
| Waiver targets missing from the 598-player pool | Expand the universe to every projected player (§2.4) |
| FantasyPros credit exhaustion (429) | Measure burn in Slice 1; cache hard; consider `ffanalytics`-style multi-source scraping as backstop |
| FantasyPros key was flagged TEMPORARY and due for rotation | It is now a **season-long** dependency. Rotate to a fresh key stored only in Vercel env + local `.env` |
| Routes-run data is not free in-season | Documented; use the pass-snap proxy and don't pretend otherwise |
| Scope creep — this is larger than the draft app | Slices are independently shippable; cut from the bottom of §5 |
| Over-automation | Explicit boundary in §2: we brief, the user executes |
| Model overconfidence on 2–3 game samples | Shrink toward preseason priors early; the `injury_penalty` / shrinkage patterns from docs/03 already exist |

---

## 9. Relaxed constraint: the LLM

CLAUDE.md non-negotiable #1 bans an LLM on the live recommendation path. That
rule existed because of the **60-second pick clock**. In-season the clock is
*days*, not seconds.

Revised rule: **all numbers stay deterministic and LLM-free** — projections,
lineup, win probability, FAAB price, trade Δ. The LLM is allowed only to write
the *narrative* of a brief and to synthesize news text into structured
`OPPORTUNITY_SPIKE` candidates for the deterministic engine to score. It never
picks a lineup, never sets a bid.

---

## 10. Success criteria

1. A normal week costs the user **under 2 minutes of pasting**, and a skipped
   paste still produces an answer (§2.2).
2. Every brief lands before its deadline with exact, executable actions.
3. Start/sit is chosen by P(win), not by projected points, and the brief says
   which mode it was in and why.
4. FAAB bids are sanity-banded and we are never locked out at $0.
5. We act inside the Wednesday-8AM and Sunday-inactives windows every week.
6. `core/test_scoring.py` stays green. Always.

---

## 11. VERIFY before Week 1 (do not guess)

Carried forward in the spirit of docs/02's scoring VERIFY items — every one
ships ASSUMED, the app runs fine either way, and only a human checking the
league's own settings page flips one to VERIFIED.

1. **Roster limits** — `reserve_max: 5`, `practice_squad_max: 5`,
   `injured_reserve_max: 3`. Practice-squad slots would materially change stash
   strategy. Currently ASSUMED.
2. **Position limits** — `position_limits: UNCONFIRMED` in `league_config.yaml`.
3. **Are FAAB balances visible** to all managers on CBS? §3.2's rival-budget
   modeling depends on it.
4. **Trade deadline week.**
5. **Playoff weeks and playoff team count** — changes how ROS value is weighted
   (Weeks 15–17 matter more than Week 12).
6. **Whether FAAB carries into the playoffs** or resets.
7. **Lineup lock rule** — individual player lock at his kickoff (assumed, and
   required for §1c inactive sniping to work) vs. whole-slate lock.
8. **Tie-break rule for equal FAAB bids** (usually reverse standings or waiver
   priority) — changes optimal bid rounding.

---

## 12. Carry-forward from the draft post-mortem

Final result: **Grade A, 2nd of 12 in projected points, 89% of available value
captured (3rd best) — from the 9th-easiest path.** Below-median value path
converted into a top-2 roster. Four findings carry into in-season.

### 12.1 The WR depth-target bug — and why the in-season engine is immune

`config/model.yaml` set `depth_targets: { WR: 6 }` in a format that starts two
WRs plus a shared RWT flex. The need-boost is proportional to the gap from
target, so the further from 6 the roster got, the harder it pushed — steering
rounds 10–12 into WR4 and WR5. The result: five WRs, 9th in draft capital, 10th
in true point value, with Pittman (#117, 2.92 TPV) and Reed (#141, 1.98 TPV)
buying almost nothing, while Hubbard at #124 returned 6.79.

**The root cause is the failure mode to design out: a positional quota
substituting for marginal value.**

The in-season engine must never use positional depth targets. Bench value is
**option value** — injury insurance against a *specific* starter, plus upside
lottery — computed as Δ(expected lineup value over remaining weeks, across
injury scenarios). Never "you are under target at WR." The §0 Δ-framing is
immune to this by construction; the risk is someone reintroducing a quota as a
convenience heuristic. Don't.

*Immediate consequence:* Pittman and Reed are the two cheapest roster spots on
the team and the first things to convert during the open FA window (§5).

### 12.2 The pick-ledger drift — why §2.1 uses snapshots

The app showed "YOUR NEXT PICK — #169" with a full 14-man roster, in a
12×14 = 168-pick draft where CBS recorded the final pick as #165. The ledger had
drifted **+4**. It cost nothing (the draft was over) but the failure mode is
serious: survival probability is computed against picks-until-your-turn, so an
inflated gap makes everything look less likely to survive and manufactures false
urgency — a plausible contributor to §12.3.

Append-only event logs accumulate drift silently. §2.1's snapshot-replace
semantics eliminate the class, and it matters far more now that *all* input is
manual. Also note `parseBulkPaste` returns an `already_drafted` bucket it treats
as safely ignorable — that assumption is fine for a draft and **wrong** for a
season, where the same player legitimately moves between rosters. Revisit it.

### 12.3 Urgency ran hot in the middle rounds

Jeremiyah Love at #21 was −6.13 vs. pick average and flagged by CBS as taken 8
spots early — exactly what DO_NOT_REACH / MODEL DISAGREEMENT exists to catch;
worth checking whether it fired and was overridden or whether the round-2
threshold is too loose. Broader pattern: every mid-round pick except Wilson and
Fannin came in slightly negative (Jacobs −5.26, Henderson −4.31, Sutton −0.53).
Rounds 4–7 the model was consistently a hair ahead of the room — POSITION_CLIFF
/ urgency running a touch hot. Individually forgivable, collectively a few
points.

**In-season analogue: manufactured scarcity inflating FAAB bids.** Guard with
the §3.2 sanity bands *and* the contested-ness check — if the room isn't bidding,
Wednesday is free, so scarcity urgency should push toward *waiting*, not
toward *paying*.

### 12.4 The QB punt was correct — don't undo it with FAAB

12th of 12 in QB true point value (Stafford, #100, 11.77 TPV), and still 2nd
overall in projected points. In a 1-QB league that is the punt working. CBS's
positional grade is vanity. Do **not** panic-buy a QB with FAAB; upgrade through
the free Wednesday window and matchup streaming (§3, research §3), which projects
near 20 FPG at zero budget cost.

### 12.5 Deferred to next preseason (not in-season work)

- `config/model.yaml` `depth_targets.WR: 6` → 4–5, and make the boost decay to
  zero past the flex-covering count instead of staying linear.
- Pick-ledger dedupe / round-2 DO_NOT_REACH threshold review.

Both are draft-engine calibration. The draft is over; they cost nothing to fix
later and should not consume in-season build time. Logged here so they aren't
lost.
