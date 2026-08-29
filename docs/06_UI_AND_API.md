# 06 — UI & API

> **Responsive, iPad/desktop-primary.** This is a hosted web app used mainly on an iPad and/or MacBook, side-by-side with the CBS Sports and FantasyPros apps, and it must also work on a phone. Design a responsive layout: on iPad/desktop show the PICK card, alternatives, roster panel, and league pulse together; on a phone stack them with the PICK card + manual entry above the fold. Large tap targets; no hover-only interactions (iPad is touch).

## API contract (local server)
```
GET  /health              -> providers + freshness + model version
GET  /players             -> current available pool (cached, scored)
GET  /draft/state         -> canonical state (picks, on-the-clock, your next pick)
POST /draft/pick          -> record a pick (manual or provider); body = canonical event
POST /draft/undo          -> revert last pick
POST /draft/event         -> ingest endpoint for the browser companion
GET  /recommendation      -> the pick + alternatives (below)
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
  "reasons": ["WONT_SURVIVE", "VALUE_GAP", "POSITION_CLIFF"],
  "fundamental_rank": 7,
  "league_market_rank": 22,
  "do_not_reach_flag": false,
  "data_freshness": "GREEN",
  "alternatives": [
    {"player_id": "...", "name": "...", "position": "WR", "score": 1.82, "survival_to_next_pick": 0.68}
  ]
}
```

## Data freshness gating (every recommendation, not just CBS live latency)
Track age independently for: FantasyPros pull, CBS draft-state poll, players.json
build time, injury/news refresh, and draft-state event sequence. Roll up to one
badge:
```
GREEN  = all sources current
YELLOW = usable but stale (show it, don't block)
RED    = manual confirmation required (e.g. FantasyPros cache is from yesterday
         morning and a major injury may not be reflected — never use it silently)
```
Show the badge next to the PICK card at all times. RED never suppresses the
recommendation — it demotes confidence and asks the human to sanity-check.

## UI — one glance, no clutter (60s clock; optimize for instant glance-and-confirm)
```
ON THE CLOCK — PICK 4                         CBS LIVE · 1s | FP 12m | MANUAL READY

  PICK:  JAHMYR GIBBS  (RB)
  Confidence: HIGH        Gone before your next pick: 88%

  WHY
  • Best league-adjusted value at the position
  • Only 12% chance to survive to pick 21
  • Next comparable RB projects 9.4 pts/wk lower

  ALTERNATIVES
  ┌───────────────────────────────────────────────────────────────┐
  │ CeeDee Lamb   WR   score 1.82   survives 68%   FA pick ~7  ADP 6 │
  │ Malik Nabers  WR   score 1.74   survives 55%   FA pick ~9  ADP 8 │
  │ Josh Allen    QB   score 1.66   survives 40%   SCORING_EDGE      │
  └───────────────────────────────────────────────────────────────┘

  LEAGUE PULSE     RB +14% aggressive · WR −9% vs market · QB normal

  [ type a drafted player  ______________  ↵ ]   [undo]   [correct]
```


## The recommendation must show the CONSEQUENCE OF WAITING (not just the name)
The single most useful human sanity-check is *why now*. The PICK card must show what
you lose by waiting and what you'd fall back to:
```
PICK:  Jahmyr Gibbs  (RB)
14% chance he reaches your next pick (21)
If you wait, expected alternative:  Kenneth Walker
Edge vs next-best now (CeeDee Lamb): +0.31
```
Fields: recommended player; survival % to your next pick; the expected best
alternative you'd get at your next turn (from the lookahead rollouts); and the score
edge over the runner-up now. This is exactly what makes an intentional disagreement
with FantasyPros trustworthy: when Draft Edge takes someone several spots ahead of
ECR, you immediately see it's because he won't survive and the tier drops sharply.

## UI rules
- The manual-entry box is ALWAYS visible and focused — it's the anchor.
- Show provider freshness honestly: CBS <8s healthy, 8-20s warning, >20s degraded (tight, because of the 60s clock);
  never block the recommendation on staleness — lower confidence instead.
- Show the overall data-freshness badge (GREEN/YELLOW/RED, above) at all times.
- Confidence is a label from score separation (docs/03), not a fake probability.
- Reasons are template-filled (no LLM). Max 3. If `do_not_reach_flag` is true, show
  a distinct `MODEL DISAGREEMENT — REVIEW` badge on the PICK card with the runner-up
  surfaced at equal visual weight, not buried in alternatives.
- "League Pulse" = 3 signals max; manager detail is expandable, not default.
- Your roster + remaining starter needs visible in a side panel.
- FundamentalRank and LeagueMarketRank are both shown (not blended) — e.g.
  "Fundamental #7 · Market #22" — so a falling-player edge is visible at a glance.

## Build the simplest thing that works
Static HTML + vanilla JS (or a tiny React page) polling `/recommendation` and
`/draft/state` every 2–3s is plenty. No SPA framework required. Serve it from the
same local server.
