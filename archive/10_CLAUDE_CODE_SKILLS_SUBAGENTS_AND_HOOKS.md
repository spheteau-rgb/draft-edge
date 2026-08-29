# Claude Code Skills, Subagents, Hooks, and Project Memory

## 1. Why Add Skills

The existing documents tell Claude what the system should be.

Skills teach Claude repeatable procedures for the tasks it will perform many times.

Claude Code currently supports project Skills in:

```text
.claude/skills/<skill-name>/SKILL.md
```

Use focused Skills rather than one giant "fantasy expert" skill.

---

# 2. Required Project Skills

Create these Skills in the repository.

## `league-rule-compiler`

Purpose:
Convert CBS/custom league settings into the canonical league schema and verify mathematical scoring behavior.

Should:
- extract every scoring rule;
- detect nonlinear bonuses;
- detect positional premiums;
- map roster eligibility;
- generate scoring fixtures;
- flag ambiguous rules;
- produce property tests.

Never silently assume standard scoring.

---

## `projection-calibration`

Purpose:
Evaluate player projections and probabilistic distributions.

Should:
- run walk-forward splits;
- compute CRPS, pinball loss, MAE and calibration;
- stratify by position/archetype;
- compare ensemble vs baseline;
- flag overconfident tails.

---

## `draft-policy-evaluator`

Purpose:
Evaluate a proposed draft-policy change before merge.

Should:
- run replay suite;
- compare against ECR, ADP, VORP and current champion model;
- quantify regret;
- run sensitivity tests;
- reject changes that only improve the training simulator.

---

## `opponent-model-auditor`

Purpose:
Review manager-learning logic.

Should test:
- shrinkage;
- cold-start behavior;
- probability calibration;
- overreaction to small samples;
- roster-need features;
- leakage.

---

## `simulation-auditor`

Purpose:
Inspect Monte Carlo correctness.

Should:
- verify common random numbers;
- inspect variance;
- calculate standard errors;
- check covariance model;
- check reproducibility;
- detect impossible states;
- check playoff rules.

---

## `integration-verifier`

Purpose:
Review every external data integration.

Should:
- verify endpoint against official documentation;
- verify authentication;
- verify rate limits where available;
- verify schema;
- verify fallback;
- record terms/license considerations;
- prohibit invented endpoints.

---

## `draft-night-release`

Purpose:
Execute the complete draft-night readiness checklist.

Should:
- build;
- test;
- replay;
- benchmark;
- verify environment;
- validate model artifacts;
- validate league config;
- check FantasyPros cache;
- check CBS bridge;
- test manual fallback;
- generate GO / NO-GO report.

---

## `ui-on-clock-review`

Purpose:
Review the live decision surface as though the user has 30 seconds.

Should enforce:
- one dominant recommendation;
- no unnecessary data;
- one glance answers who/why/wait;
- accessible contrast;
- no core scrolling;
- degraded state visible;
- manual recovery obvious.

---

## `security-review`

Purpose:
Review secrets, extension permissions and local service boundaries.

Should:
- find exposed API keys;
- inspect extension permissions;
- prohibit credential/session-cookie logging;
- inspect localhost binding;
- check dependency vulnerabilities;
- check unsafe subprocess or shell behavior.

---

# 3. Project Subagents

Skills encode workflows.
Subagents provide independent roles and context.

Create project subagents:

## Quant Reviewer

Read-only plus test execution.

Responsibilities:
- challenge objective functions;
- verify formulas;
- inspect calibration;
- challenge simulation assumptions;
- look for look-ahead bias.

Must not edit production files during review.

## Fantasy Domain Reviewer

Responsibilities:
- challenge roster assumptions;
- identify unusual scoring implications;
- validate positional logic;
- identify football features missing from models.

## Integration Reviewer

Responsibilities:
- inspect CBS/FantasyPros/nflverse adapters;
- validate official docs;
- review retry/fallback behavior;
- check external IDs.

## Test and Reliability Reviewer

Responsibilities:
- inspect failure paths;
- property tests;
- replay determinism;
- latency;
- crash recovery.

## UX Reviewer

Responsibilities:
- test live flow with Playwright;
- challenge cognitive load;
- enforce on-clock simplicity.

## Security Reviewer

Read-only.
Responsibilities:
- secrets;
- browser extension;
- local bridge;
- dependencies;
- permissions.

---

# 4. How Claude Should Use Subagents

For any major model change:

1. Primary Claude implements on a feature branch.
2. Quant Reviewer evaluates.
3. Test/Reliability Reviewer evaluates.
4. If integration changed, Integration Reviewer evaluates.
5. Primary Claude addresses findings.
6. CI runs.
7. Draft-policy-evaluator Skill runs.
8. Merge only after gates pass.

Avoid "agent voting."

Reviewers should provide evidence, not a majority opinion.

---

# 5. CLAUDE.md

Keep root `CLAUDE.md` short.

It should contain:
- architecture invariants;
- mandatory commands;
- prohibited behavior;
- paths to detailed specs.

Do not paste the entire design into CLAUDE.md.

Claude Code automatically loads the project CLAUDE.md, so this is the right place for persistent high-authority rules.

---

# 6. Hooks

Use hooks for deterministic enforcement.

Recommended hooks:

## After Python edit
Run:
- `ruff format`;
- targeted `ruff check`.

Do not run the entire backtest suite after every file write.

## Before git commit
Run:
- unit tests for changed packages;
- type checks;
- secret scan.

## Before touching scoring code
Inject reminder:
- scoring behavior requires property tests;
- no default PPR assumptions.

## After model code change
Mark:
- replay benchmark required before merge.

## Before release
Block release if:
- tests fail;
- model artifact stale;
- league config unvalidated;
- manual fallback untested.

Hooks should enforce simple invariants.
Do not use an LLM hook for rules that a shell command can enforce.

---

# 7. Commands

Create repository commands:

```text
make setup
make test
make lint
make replay
make benchmark
make ingest
make models
make draft
make release-check
```

Claude should use these instead of improvising new command sequences.

---

# 8. Recommended Skills vs MCP

Use Skills for:
- procedures;
- review checklists;
- quantitative validation routines.

Use MCP/connectors for:
- external services;
- GitHub;
- databases;
- browser automation/testing if appropriate.

Do not encode credentials or remote endpoints directly in a Skill.

---

# 9. GitHub Integration

Strongly recommended.

Claude Code can work directly in the repository and GitHub Actions should independently verify its work.

Desired process:

```text
issue
 ↓
Claude plan
 ↓
feature branch
 ↓
implementation
 ↓
tests
 ↓
independent subagent reviews
 ↓
pull request
 ↓
GitHub Actions
 ↓
merge
```

Never treat "Claude says tests passed" as sufficient.
CI is authoritative.

---

# 10. Skill Creation Quality Standard

Each Skill should include:

```yaml
---
name: ...
description: ...
---
```

Then:
- when to use;
- required inputs;
- exact steps;
- required outputs;
- failure conditions;
- examples;
- what it must never do.

Avoid generic instructions like:
"Think carefully about the math."

Encode observable procedures instead.

---

# 11. Best Additional Knowledge Skills

Beyond coding Skills, the project benefits from internal reference modules on:

1. probability calibration;
2. Bayesian hierarchical modeling;
3. approximate dynamic programming;
4. Monte Carlo variance reduction;
5. discrete choice / Plackett-Luce models;
6. assignment optimization;
7. fantasy football opportunity metrics;
8. browser-extension security;
9. time-safe sports backtesting;
10. experiment design / ablation testing.

These do not need to be separate Skills unless Claude repeatedly performs the same workflow.

---

# 12. Most Important New Capability

The most valuable addition is not another generic fantasy-football Skill.

It is the combination of:

**simulation-auditor + draft-policy-evaluator + integration-verifier**

These prevent a sophisticated-looking model from:
- overfitting;
- hallucinating APIs;
- producing noisy "edges";
- failing live.
