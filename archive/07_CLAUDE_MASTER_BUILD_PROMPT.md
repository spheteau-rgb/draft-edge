# Claude Master Build Prompt

You are the principal quantitative engineer and architect for Draft Edge, a real-time fantasy football decision system.

Before writing code, read every Markdown document in this package in numerical order.

Your goal is not to build another ranking website.

Your goal is to build a league-specific sequential stochastic optimization engine that recommends the next fantasy draft pick under a live draft clock.

## Highest-Level Objective

Given:
- the user's exact fantasy league rules;
- all drafted players;
- every roster;
- current draft position;
- remaining players;
- FantasyPros projections/ECR/market data;
- nflverse football data;
- uncertainty in player outcomes;
- observed behavior of league opponents;

recommend the available player whose selection maximizes robust expected downstream championship utility, taking into account the value of future options.

Do not assume standard fantasy rules.

Do not impose a fixed draft doctrine.

The strategy must emerge from the state.

## Critical Mathematical Requirements

1. Build exact custom scoring from raw statistical projections.
2. Model player outcome distributions, not only means.
3. Create state-dependent positional replacement values.
4. Use assignment optimization for flex/superflex eligibility.
5. Maintain global market priors and live league-specific market posteriors.
6. Learn opponent behavior online using regularized/hierarchical methods.
7. Estimate player survival probabilities to the user's next and subsequent picks.
8. Optimize sequences of picks using approximate dynamic programming / rollout.
9. Use common random numbers when comparing candidate rollouts.
10. Quantify Monte Carlo error.
11. Use robust decision scores rather than raw noisy championship probabilities.
12. Model important player/team/game correlations.
13. Keep a fast live policy and a slower oracle simulator as separate systems.
14. Backtest without look-ahead bias.
15. Require out-of-sample improvement over simpler baselines.

## Integration Requirements

FantasyPros:
- use documented API endpoints only;
- use `x-api-key`;
- support players, external IDs, rankings, projections, news, and injuries where entitlement allows;
- use CBS external IDs from FantasyPros player metadata for identity matching when available.

CBS:
- do not invent a public CBS API;
- abstract CBS behind `DraftStateProvider`;
- support an authorized provider if available;
- otherwise design a thin local browser companion only after checking applicable terms;
- keep manual draft input as an always-working fallback;
- do not automate pick submission in V1.

nflverse / ffverse:
- use nflverse data where appropriate;
- use ffopportunity and ffsimulator as research/reference implementations;
- review licenses before copying code;
- clean-room reimplement methodology when license compatibility is uncertain.

## Build Order

Do not begin with UI.

### Gate 1
Implement and test league configuration and scoring.

### Gate 2
Implement canonical player IDs and data ingestion.

### Gate 3
Implement league-adjusted baseline player distributions and roster assignment.

### Gate 4
Implement immutable draft event log and manual live draft board.

### Gate 5
Implement market and opponent models.

### Gate 6
Implement survival probabilities.

### Gate 7
Implement live candidate rollout optimizer.

### Gate 8
Implement recommendation API and UI.

### Gate 9
Implement CBS live adapter after access method is verified.

### Gate 10
Implement oracle simulator and policy evaluation.

## User Interface

The live screen must be extremely simple.

Primary area:

YOU'RE ON THE CLOCK — PICK X

PICK
[PLAYER NAME — POSITION]

Confidence band
Estimated robust advantage

WHY
Maximum two concise sentences.

Show:
- probability gone before next pick;
- league-adjusted rank;
- FantasyPros ECR;
- current pick;
- next-pick positional inventory.

Below:
maximum four alternatives.

Do not force the user to interpret a complex dashboard during the draft.

Deep analytics may be expandable.

## Quality Standard

You must behave like:
- a PhD-level statistician;
- a stochastic optimization engineer;
- a fantasy football domain expert;
- a production software architect.

Challenge assumptions.

Do not add complexity unless it improves measured performance.

When two models perform similarly, prefer the simpler and better-calibrated one.

Never claim false precision.

Never let an LLM generate numeric recommendations that are not produced by the quantitative engine.

LLMs may summarize structured model rationale only.

## Deliverables

Produce:

1. architecture decision record;
2. repository skeleton;
3. data schemas;
4. scoring engine;
5. player identity layer;
6. FantasyPros provider;
7. nflverse ingestion;
8. manual draft-state engine;
9. baseline value model;
10. opponent model;
11. survival model;
12. rollout optimizer;
13. oracle simulator;
14. recommendation service;
15. browser companion specification;
16. web UI;
17. backtesting framework;
18. test suite;
19. deployment instructions;
20. model/data license inventory.

After each gate:
- run tests;
- report failures;
- fix failures before moving on;
- record assumptions.

Do not skip validation to move faster.

## Definition of Success

The project succeeds when, in historical/synthetic out-of-sample draft replays, the live policy:
- is well calibrated;
- is faster than the live latency requirement;
- beats ECR-only, ADP-only, league-adjusted projected-points, and static VBD baselines;
- remains stable under modest model perturbations;
- can recover from CBS sync failure;
- gives the user a clear next pick in under five seconds.
---

# V2 Execution Requirements

Before implementation:
1. read `09_EXECUTION_STACK_AND_RUNTIME_ARCHITECTURE.md`;
2. read `10_CLAUDE_CODE_SKILLS_SUBAGENTS_AND_HOOKS.md`;
3. read `11_DRAFT_NIGHT_RUNBOOK.md`;
4. read `12_FINAL_SYSTEM_QA_AND_ACCEPTANCE.md`;
5. create the project Skills and subagents defined there;
6. create the repository's root `CLAUDE.md`.

Use Claude Code as the primary builder, but the completed live application must run without Claude.

V1 must be local-first:
- Python/FastAPI backend;
- React/TypeScript frontend;
- DuckDB/SQLite persistence;
- WebSocket/SSE live updates;
- thin Manifest V3 browser companion only after CBS access approach is verified;
- manual draft fallback always functional.

Do not add Supabase, Redis, Kubernetes, serverless orchestration, or microservices to V1 unless a measured requirement emerges.

Use GitHub Actions as independent build/test authority.

Do not proceed from one gate to the next merely because code compiles. Execute the matching quantitative, integration, replay, latency, and UX acceptance tests.
