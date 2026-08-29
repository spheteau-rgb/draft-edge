# Real-Time Draft Engine and UI

## 1. User Experience Objective

The user is under a draft clock.

The default UI should answer exactly four questions:

1. Who should I pick?
2. How strong is the recommendation?
3. Why now rather than later?
4. What are my best alternatives?

Everything else is secondary.

---

# 2. Live Recommendation Pipeline

On draft event:

```text
Pick observed
  ↓
Identity resolution
  ↓
Roster + availability update
  ↓
Opponent posterior update
  ↓
League market update
  ↓
Survival model refresh
  ↓
Candidate shortlist
  ↓
Fast rollouts
  ↓
Robust ranking
  ↓
Recommendation explanation
  ↓
UI update
```

Performance targets:
- event ingestion: < 250 ms;
- state update: < 100 ms;
- survival refresh: < 500 ms;
- candidate evaluation: < 1500 ms preferred;
- total recommendation refresh: < 2.5 s preferred, < 5 s hard target.

---

# 3. Candidate Shortlist

Do not simulate every available player.

Construct candidate set from union of:
- top 5 marginal roster value;
- top 3 survival urgency;
- top 3 market mispricing;
- top 3 positional cliff;
- top 3 upside / structural candidates.

Deduplicate.

Usually 8–15 players.

---

# 4. Fast Decision Score

Before rollout, compute:

\[
H_i =
z(MRV_i)
+ a z(Cliff_i)
+ b z(Mispricing_i)
+ c z(Urgency_i)
+ d z(Upside_i)
+ e z(Flexibility_i)
\]

This is a candidate-generation heuristic, not the final decision.

Then targeted rollout estimates `Q(s,i)`.

---

# 5. Recommendation Output

Primary card:

```text
YOU'RE ON THE CLOCK — PICK 24

PICK
Garrett Wilson — WR

Confidence: 87%
Robust Edge vs #2: +0.74

Why:
Your scoring makes Wilson substantially more valuable than the market price,
and the model estimates only a 13% chance a comparable WR reaches your next pick.

Gone before next pick: 87%
League-adjusted rank: #11
FantasyPros ECR: #19
Current overall pick: #24
```

Secondary cards, max four:

```text
2. Player B    +0.61 utility    61% gone
3. Player C    +0.55 utility    72% gone
4. Player D    +0.48 utility    31% gone
5. Player E    +0.41 utility    18% gone
```

---

# 6. Next-Pick Outlook

Show expected inventory, not only candidate ranks.

Example:

```text
NEXT PICK OUTLOOK

Position     Comparable options likely left
RB           4.3
WR           0.9
TE           2.1
QB           5.8
```

This is intuitive evidence for option value.

---

# 7. Market Pulse

Small visual only:

```text
LEAGUE MARKET
RB  +18% aggressive
WR  -11% discounted
QB   normal
TE   +6% aggressive
```

Use posterior estimates, not raw counts.

---

# 8. Confidence UX

Three bands:
- HIGH;
- MEDIUM;
- CLOSE CALL.

If candidates are statistically indistinguishable, say so.

Example:

```text
CLOSE CALL
Player A and Player B are effectively tied.
A has more ceiling; B is less likely to survive.
```

Never show fake 92% confidence simply because one Monte Carlo mean is highest.

---

# 9. Explainability

Generate explanations from structured reason codes.

Examples:
- `VALUE_GAP`;
- `SURVIVAL_URGENCY`;
- `POSITION_CLIFF`;
- `LEAGUE_DISCOUNT`;
- `ROSTER_STRUCTURE`;
- `OPTION_VALUE`;
- `UPSIDE`;
- `SCORING_QUIRK`.

Do not ask an LLM to invent the numeric rationale.

LLM is allowed only to verbalize validated structured facts.

---

# 10. Interaction Modes

Default:
- Recommendation

Optional tabs:
- Alternatives
- Draft Board
- My Roster
- Market
- Deep Analytics

The Recommendation screen must remain usable without opening any other tab.

---

# 11. On-Clock Behavior

When user is not on clock:
- precompute likely states;
- cache candidate rollouts;
- monitor next 5–10 probable picks.

When 1–2 picks away:
- increase simulation budget around likely states.

When on clock:
- use warm cache;
- immediately show provisional recommendation;
- refine if additional simulation changes result.

Never blank the UI while refining.

---

# 12. Emergency Mode

If live state has uncertainty:

```text
SYNC DEGRADED
Last confirmed pick: 52
Recommendation uses cached state.
```

Offer:
- Reconcile Draft
- Add Pick Manually

If user is on the clock, cached recommendation remains visible.

---

# 13. Visual Design

Design language:
- neutral;
- high contrast;
- one dominant recommendation;
- large player name;
- no decorative charts;
- no scrolling required for the core recommendation on laptop;
- color cannot be the only encoding.

Use numerical precision only where meaningful:
- championship probability: one decimal point at most;
- survival probability: integer percent;
- model edge: two decimals only if calibrated.

---

# 14. Draft Pick Action

Initially, do not automate CBS pick submission.

The app recommends; the user drafts in CBS.

This reduces:
- integration risk;
- accidental picks;
- terms-of-service risk.

Automated pick submission can be evaluated later if an authorized API explicitly supports it.
