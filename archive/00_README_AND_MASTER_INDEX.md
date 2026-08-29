# Draft Edge — Quantitative Fantasy Football Decision System
## Master Index and Claude Build Package

### Mission

Build a real-time fantasy football draft and season decision engine whose purpose is not to reproduce expert rankings, ADP, or conventional draft strategies, but to maximize the user's probability of winning an individual fantasy league with non-standard scoring and roster rules.

The system must:
1. understand the exact league rules mathematically;
2. estimate player outcome distributions rather than point estimates;
3. infer the live market created by the actual league;
4. learn opponent drafting behavior online;
5. estimate the probability that players survive to future user picks;
6. optimize sequences of selections rather than isolated picks;
7. compare choices using calibrated season and championship-equity simulations;
8. operate under live draft latency constraints;
9. integrate permitted CBS Sports and FantasyPros data paths;
10. present one simple recommendation under the draft clock.

### Core Design Principle

Treat the fantasy draft as a sequential stochastic decision problem under partial information.

At draft state `s_t`, the user chooses action `a_t` from available players. The state transitions after every selection by every manager. The objective is:

\[
\pi^* = \arg\max_{\pi} \mathbb{E}[U(\text{season outcome}) \mid s_0,\pi]
\]

where the preferred terminal utility is championship success, but the live system must use robust estimates rather than noisy raw Monte Carlo probabilities.

The central question is:

> Where is this league currently mispricing future championship value, and which available selection creates the strongest sequence of future choices?

### Documents

1. `01_RESEARCH_AND_DESIGN_PRINCIPLES.md`
   - Empirical foundation
   - What existing open-source systems do well
   - What not to copy blindly
   - Modeling principles

2. `02_MATHEMATICAL_MODEL_AND_ALGORITHMS.md`
   - Formal state/action model
   - Projection ensemble
   - uncertainty calibration
   - league-adjusted scoring
   - replacement levels
   - draft survival model
   - opponent Bayesian learning
   - dynamic programming / rollout approximation
   - Monte Carlo architecture
   - utility function
   - waiver/trade/lineup extensions

3. `03_DATA_AND_INTEGRATION_ARCHITECTURE.md`
   - CBS integration strategy
   - FantasyPros API
   - nflverse / ffverse
   - canonical player identity
   - event schemas
   - adapters
   - resilience and fallback paths
   - security and terms-of-service constraints

4. `04_REAL_TIME_DRAFT_ENGINE_AND_UI.md`
   - Live latency architecture
   - fast policy vs oracle simulator
   - candidate generation
   - recommendation explanation
   - UI specification
   - failure states
   - interaction design

5. `05_BACKTESTING_VALIDATION_AND_QA.md`
   - walk-forward testing
   - no-lookahead protocol
   - calibration
   - simulation validation
   - ablation tests
   - baselines
   - acceptance criteria
   - model monitoring

6. `06_IMPLEMENTATION_PLAN.md`
   - recommended stack
   - modules
   - data models
   - phases
   - tests
   - deployment
   - performance targets

7. `07_CLAUDE_MASTER_BUILD_PROMPT.md`
   - complete prompt to give Claude
   - explicitly instructs Claude to read all documents first
   - implementation discipline and acceptance criteria

8. `08_SOURCE_REGISTER.md`
   - source URLs and what each source supports

### Non-Negotiable Requirements

- The system must parse the user's exact CBS league scoring before computing rankings.
- It must not assume standard PPR, half-PPR, conventional flex, or conventional positional scarcity.
- Consensus rankings are inputs, not truth.
- ADP is acquisition-price information, not intrinsic value.
- The live league draft is an online market and must update model beliefs.
- Player value must be conditional on roster, future availability, and league behavior.
- The system must distinguish predictive uncertainty from simulation noise.
- Any displayed championship-equity delta must include uncertainty or confidence.
- The optimizer must never claim false precision.
- CBS ingestion must be isolated behind an adapter and use permitted/authorized access methods.
- A manual draft-state fallback must always exist.
- The primary UI must give one pick recommendation immediately.

### Recommended Repository Structure

```text
draft-edge/
├── apps/
│   ├── web/
│   └── browser-extension/
├── src/
│   ├── domain/
│   ├── scoring/
│   ├── projections/
│   ├── market/
│   ├── opponents/
│   ├── simulator/
│   ├── optimizer/
│   ├── integrations/
│   ├── recommendation/
│   └── monitoring/
├── research/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── replay/
│   └── property/
├── data/
│   ├── raw/
│   ├── canonical/
│   └── features/
├── configs/
└── docs/
```

### Final Product Behavior

On every draft event:

1. Receive the pick.
2. Reconcile player identity.
3. Update all rosters.
4. Update league demand and opponent beliefs.
5. Update survival probabilities.
6. Generate a small set of candidate user picks.
7. Run fast targeted future rollouts.
8. Estimate robust incremental utility.
9. Return one recommendation and 3–4 alternatives.
10. Explain the recommendation in no more than two sentences by default.

The user should not need to understand the mathematics while drafting.
---

# V2 Execution Addendum

The V2 package adds the operational layer needed to turn the quantitative specification into a reliable draft-night system.

Additional documents:

9. `09_EXECUTION_STACK_AND_RUNTIME_ARCHITECTURE.md`
   - complete local-first production stack;
   - what Claude Code builds;
   - what runs on draft night;
   - deployment options;
   - exact developer tooling;
   - service boundaries.

10. `10_CLAUDE_CODE_SKILLS_SUBAGENTS_AND_HOOKS.md`
    - project Skills Claude should create;
    - project subagents;
    - hooks and automated guardrails;
    - CLAUDE.md strategy;
    - division of labor among agents.

11. `11_DRAFT_NIGHT_RUNBOOK.md`
    - setup procedure;
    - connectivity checks;
    - pre-draft calibration;
    - live operation;
    - fallback modes;
    - incident recovery.

12. `12_FINAL_SYSTEM_QA_AND_ACCEPTANCE.md`
    - final architecture challenge;
    - quant, integration, UX, reliability and security gates;
    - go/no-go checklist.

13. `CLAUDE.md`
    - concise persistent project rules Claude Code should automatically load.

### V2 Runtime Decision

For a single-user live fantasy draft, prefer a **local-first architecture**.

The primary live path should be:

```text
CBS Draft Page
      ↓
Thin Browser Extension / permitted local collector
      ↓
localhost event bridge
      ↓
Python FastAPI quantitative engine
      ↓
in-memory + DuckDB/SQLite state/cache
      ↓
WebSocket/SSE
      ↓
React/Vite draft UI in local browser
```

External APIs such as FantasyPros and nflverse should be ingested asynchronously into the local backend and cached before the draft.

The core recommendation path must NOT call an LLM.

Claude Code builds, tests, reviews and improves the system. It does not need to be online for recommendations once the application is running.
