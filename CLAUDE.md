# CLAUDE.md — Draft Edge (read this first, every session)

You are building **Draft Edge**, a real-time draft assistant for the **Family
Affair** CBS fantasy football league. Draft: **Sunday Aug 30, 2026, 5:00 PM ET**.
Ship a working system before then. Correctness and reliability beat scope/elegance.

## Mission (one sentence)
Given the live state of the draft, tell the user (slot 4, team "Mama There Goes
That Man") exactly who to pick next, under **exact Family Affair scoring**, with a
clear reason and a survival-to-next-pick estimate — usable on the user's primary draft-day devices — an iPad and/or MacBook — and from any device/network, fast enough for a 60-second pick clock.

## Deployment target (locked by the user)
- **GitHub** for version control. **Vercel** for hosting. It must be a REAL, always-
  available public website, fully usable from ANY device (phone, Mac, tablet) and
  ANY network (cellular or wifi), anywhere - not a localhost app. The user must be
  able to draft from their phone or the Mac interchangeably, even switching devices
  mid-draft, and see the same live state on each.
- The **MacBook + Claude Code** is the BUILD machine (runs the Python precompute,
  commits, deploys). Draft-day CLIENTS are primarily the **iPad and/or MacBook**, used
  side-by-side with the CBS Sports and FantasyPros apps. Any device (incl. phone) works.

## Two-language, two-layer design (important)
- **Precompute (Python, on the Mac, at build/refresh time):** FantasyPros/raw
  projections → exact Family Affair scoring (`core/scoring.py`) → weekly Monte
  Carlo (N=2000) → per-player value + distribution. Emit static `data/players.json`
  and `data/priors.json`, committed to the repo (or uploaded to Vercel Blob/KV).
  **This is the ONLY place scoring.py runs.**
- **Runtime (TypeScript, on Vercel serverless):** reads the precomputed data +
  current draft state from the store, runs the LIGHT optimizer (VORP, flex lineup,
  market, survival, 1-turn lookahead, reason codes) in <1s, returns a
  recommendation. Written in TS because it runs in Vercel functions.
- **State store:** Vercel KV (Upstash Redis) or Postgres (Neon/Supabase). Draft
  state lives SERVER-SIDE (never in device memory) so every device sees one shared
  live draft. All clients poll the same state every 2-3s, so a pick entered on any
  device appears on all others within seconds. Switching devices mid-draft just
  works.
- **Client:** Next.js, responsive (iPad/desktop-primary, also phone). One-glance rec +
  always-visible manual entry.

## Non-negotiable constraints
1. **The live recommendation path never calls an LLM and never blocks on a slow
   network call.** Heavy math is precomputed. Runtime = cached data + light TS math.
2. **Manual pick entry is the anchor.** There is a 60-second pick clock, so speed matters: the recommendation must be
   ready instantly on your turn, and opponents' picks must reach the app within a
   few seconds. Manual entry stays the anchor if live sync fails. The app must work with zero live integrations.
3. **CBS live sync is best-effort**, via CLIENT-SIDE polling (every ~3-5s while the
   app is open) of an on-demand roster-diff endpoint using CBS_ACCESS_TOKEN. Vercel
   cron (1/min max) is too slow for a 60s clock and is only a background backup. If unreliable,
   ship manual-first. (Browser companion is unavailable on iPad/tablet — skip it.)
4. **Security:** secrets live in Vercel env vars / local `.env`, never in the client
   bundle, never printed/logged/committed. FantasyPros key is TEMPORARY — user
   rotates after setup. CBS token is the user's; store as encrypted Vercel secret.
   Add a simple shared-secret/password gate so the public URL isn't open to all.
5. **Never break the scoring engine.** `core/test_scoring.py` (52 cases) must stay
   green. Run it before/after any scoring change.

## Build order (stop-loss: cut CBS automation before the engine)
1. Verify scoring tests green.  2. FantasyPros ingest + identity map + cache.
3. Python precompute → players.json.  4. TS: VORP + flex lineup + base ranking.
5. TS: market + survival + historical priors.  6. TS: final score + lookahead +
reasons.  7. Next.js mobile UI + manual entry + state store. **<-- usable here.**
8. GitHub + Vercel deploy + phone access + auth.  9. CBS live polling (client-driven, time-boxed).
10. Mock draft, latency, acceptance gates, freeze.
If short on time cut: CBS automation → cosmetic UI/PWA extras → manager-specific
refinements → reduce rollout count (500→250→100, keeping ≥ deterministic
survival-aware lookahead). Never cut scoring, VORP, manual entry, the sequential
lookahead entirely, or the deploy.

## Already done for you (core/)
`scoring.py` (verified), `league_config.yaml`, `test_scoring.py` (52 passing).

## VERIFY from CBS web settings before draft (don't guess)
See docs/02 `SCORING_VERIFICATION_STATUS` for the full, numbered list (8 items —
always say "scoring/league VERIFY items," never a fixed count like "six," in any
doc or UI copy). Every item ships `ASSUMED` by default and the app must run fine
that way; diagnostics shows a yellow banner listing every ASSUMED item. Only a
human confirming against the league's own test-scoring page flips an item to
`VERIFIED` — never silently promote it.

## Post-review additions (locked decisions, don't re-litigate)
- **Projections:** FantasyPros is the REQUIRED source for V1. Additional
  `ProjectionProvider`s (RotoWire, CBS, etc.) are OPTIONAL — only add one if it's
  genuinely quick; never delay the build to fake an ensemble. See docs/03 Alg 2 for
  the N-based aggregation rule (N=1 direct, N=2 weighted mean, N=3 weighted
  median/mean no winsorization, N>=4 optional winsorization).
- **K/DST:** model under exact league scoring, shrink heavily toward replacement,
  keep the early-round guardrail but let it be overridden only when league-adjusted
  VORP is exceptional (docs/03). Never fabricate FG-distance or DST sub-components
  that aren't in the source data.
- **Keepers:** clean 14-round redraft, no carryover. `keeper_mode: false` /
  `keepers: []` in `core/league_config.yaml` so the assumption is a config flip, not
  a redesign.
- **Rank separation:** FundamentalRank (pure Family Affair value) and
  LeagueMarketRank/ExpectedPick (when the room takes them) are computed and shown
  separately — never blended before the optimizer runs (docs/03).
- **DO_NOT_REACH:** a model-risk sanity bound, not a hard ADP rule — flag
  `MODEL DISAGREEMENT — REVIEW` (with the runner-up shown) instead of silently
  trusting a ~30+ pick reach that isn't backed by SCORING_EDGE, POSITION_CLIFF, or
  WONT_SURVIVE (docs/03).
- **Data freshness:** every recommendation carries a GREEN/YELLOW/RED freshness
  badge across FantasyPros, CBS state, players.json build time, and injury/news age
  — RED demotes confidence, never suppresses the pick (docs/06).
- **Final QA:** before freeze, run the deterministic full-draft shadow simulation
  (same seed -> identical result; 100-seed sweep) described in docs/07 — this is
  the highest-value pre-draft QA step.

## The agent team (.claude/agents/)
Use them. `00-orchestrator` conducts; specialists own their layers. See
docs/08 for the roster and how to drive them.

## Style
Config over hardcoding. Interpretable over clever. Test the math. Keep the live
path boring, fast, and LLM-free.
