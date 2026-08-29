# Execution Stack and Runtime Architecture

## 1. Executive Recommendation

Use **Claude Code as the principal software-engineering agent**, but do not make Claude or any LLM part of the critical live recommendation path.

Claude Code should:
- create the repository;
- implement the quantitative models;
- implement connectors;
- write tests;
- run backtests;
- inspect failures;
- produce the browser extension and UI;
- maintain documentation;
- execute release gates.

On draft night, the recommendation should come from deterministic code running locally.

The most reliable V1 architecture for one user is **local-first**, not cloud-first.

Reasons:
- lowest latency;
- fewer network dependencies;
- CBS session remains in the user's browser;
- FantasyPros API secrets remain local/server-side;
- easier manual fallback;
- no need to scale to thousands of users;
- draft continues even if a hosted service is unavailable.

---

# 2. Recommended Stack

## Developer Environment

Required:
- Git
- GitHub repository
- Claude Code
- Python 3.12+
- Node.js current LTS
- pnpm
- Docker Desktop optional but useful
- VS Code or preferred editor
- Chrome or Edge for extension testing

Recommended package management:
- Python: `uv`
- JavaScript: `pnpm`

---

# 3. Backend

Use:

- Python 3.12+
- FastAPI
- Uvicorn
- Pydantic v2
- NumPy
- Polars
- SciPy
- scikit-learn
- LightGBM and/or XGBoost
- OR-Tools
- DuckDB
- SQLModel/SQLAlchemy only if relational persistence becomes necessary

Optional:
- PyMC or NumPyro for offline hierarchical model fitting;
- Numba for identified simulation hotspots;
- joblib for offline parallelism.

Do not introduce a distributed queue or microservices in V1.

The backend should be one process with clearly separated internal modules.

---

# 4. Frontend

Use:
- React
- TypeScript
- Vite
- TanStack Query
- native WebSocket or SSE client
- Tailwind CSS or a small controlled design system
- Zod for runtime payload validation

Testing:
- Vitest
- React Testing Library
- Playwright

The UI is a decision surface, not an analytics dashboard.

---

# 5. Browser Extension

Use:
- Manifest V3
- TypeScript
- content script
- background service worker only when necessary
- local bridge communication to `127.0.0.1`

The extension must be thin.

Its job:
1. observe permitted visible draft-state changes;
2. normalize them into simple draft events;
3. send them to the local backend;
4. report health.

The extension must NOT contain:
- model logic;
- FantasyPros API secrets;
- raw player projections;
- automated drafting;
- hidden credentials.

Before production use, verify the CBS terms and the actual page-access method.

---

# 6. Local Runtime Topology

```text
┌─────────────────────────────┐
│ CBS Draft Tab               │
│ authenticated user session  │
└──────────────┬──────────────┘
               │ visible draft events
               ▼
┌─────────────────────────────┐
│ Browser Extension           │
│ thin local collector        │
└──────────────┬──────────────┘
               │ localhost
               ▼
┌────────────────────────────────────────────┐
│ FastAPI Backend                            │
│                                            │
│ Draft State                               │
│ Projection Engine                         │
│ Market Model                              │
│ Opponent Model                            │
│ Survival Model                            │
│ Fast Rollout Optimizer                    │
│ Recommendation Service                    │
└──────────────┬─────────────────────────────┘
               │ WebSocket/SSE
               ▼
┌─────────────────────────────┐
│ Local React Draft UI        │
│ Recommendation screen       │
└─────────────────────────────┘
```

Separate asynchronous ingestion path:

```text
FantasyPros API ─┐
nflverse data ───┼──> cache / feature build ──> backend
manual imports ──┘
```

---

# 7. Persistence

V1:
- DuckDB for analytical data and historical features;
- SQLite or DuckDB for draft event persistence;
- in-memory cache for current live state;
- append-only JSONL event backup during draft.

Why append-only backup:
if the app crashes, the draft can be reconstructed exactly.

Every live event should be flushed immediately.

---

# 8. Realtime Transport

For a local system:
- prefer WebSocket or Server-Sent Events directly from FastAPI;
- do not add Supabase merely to move events between two processes on one laptop.

If the product later becomes hosted or multi-device:
- Supabase Realtime is a reasonable option;
- use Broadcast for custom high-frequency state updates rather than relying blindly on Postgres Changes.

Cloud realtime should be Phase 2, not V1.

---

# 9. External Data

## FantasyPros

Preferred authorized source for:
- ECR;
- projections;
- external IDs;
- injuries;
- news;
- consensus rankings.

Cache before draft.

Do not make every recommendation depend on an API call.

## nflverse

Pre-download required datasets before draft day.

Create reproducible snapshots:
- dataset;
- season;
- timestamp;
- source commit/version where available.

## News/injuries

Update periodically before draft.
Do not block pick computation waiting for news.

---

# 10. LLM Placement

LLMs can be used offline for:
- code generation;
- model review;
- explanation wording;
- parsing unusual league scoring into a proposed schema;
- research.

LLMs should NOT be used live for:
- numerical player ranking;
- championship-equity calculation;
- state reconciliation;
- survival probability;
- pick recommendation.

The recommendation endpoint must produce the same numerical output without Claude.

An optional LLM explanation service can translate structured reasons into prose, but the UI must work if it is unavailable.

---

# 11. CI / Developer Quality Stack

Python:
- `pytest`
- `hypothesis`
- `ruff`
- `mypy` or pyright
- coverage.py

TypeScript:
- TypeScript strict mode
- ESLint
- Prettier
- Vitest
- Playwright

Repository:
- pre-commit
- GitHub Actions
- Dependabot/Renovate optional
- CODEOWNERS optional

Security:
- secret scanning
- dependency audit
- `.env` excluded from Git
- GitHub secret scanning where available

---

# 12. GitHub Actions

Required workflows:

## `ci.yml`
On every pull request:
- Python lint;
- Python type check;
- unit tests;
- property tests;
- frontend lint;
- frontend typecheck;
- frontend unit tests;
- build.

## `replay.yml`
On model changes:
- deterministic historical draft replay;
- baseline comparison;
- latency benchmark.

## `release-gate.yml`
Before tagged release:
- full integration tests;
- Playwright smoke test;
- schema compatibility;
- model artifact checksums;
- license inventory;
- no regression beyond accepted tolerance.

---

# 13. Secrets

Local `.env`:

```text
FANTASYPROS_API_KEY=
DRAFT_EDGE_ENV=development
```

No API keys in:
- browser extension bundle;
- React client bundle;
- git history;
- screenshots/logs.

Use a local backend proxy for all authenticated external calls.

---

# 14. Model Artifact Versioning

Every model artifact must have:
- model name;
- training cutoff date;
- input schema version;
- output schema version;
- hyperparameters;
- git commit;
- training data fingerprint;
- calibration metrics.

Example:

```json
{
  "model": "player-survival-v3",
  "trained_through": "2025-12-31",
  "git_sha": "...",
  "feature_schema": "survival-features-v4",
  "calibration_brier": 0.142
}
```

---

# 15. Precomputation

Before draft:
- score every projection under exact league rules;
- estimate player distributions;
- compute global replacement curves;
- compute initial tiers;
- compute ADP survival priors;
- load opponent history if available;
- warm model artifacts.

Live compute should focus only on the state-dependent changes.

---

# 16. Recommended Development Toolchain

Primary builder:
- Claude Code

Source control:
- GitHub

Quant notebooks:
- Jupyter only for research;
- production logic must move into tested modules.

API inspection:
- Bruno, Postman, or curl; Bruno preferred if storing request collections in Git.

Database inspection:
- DuckDB CLI;
- DBeaver optional.

Browser testing:
- Chrome DevTools;
- Playwright.

Profiling:
- Python `cProfile` / `py-spy`;
- `pytest-benchmark`;
- browser performance panel.

---

# 17. Should Other AI Models Be Used?

Yes, but as independent reviewers rather than co-owners of the codebase.

Recommended pattern:

Claude Code:
- primary implementer.

Second strong model:
- architecture/red-team review;
- mathematical critique;
- test-gap detection.

Third model if desired:
- security/integration review.

Do not let multiple agents edit the same branch simultaneously.

Use:
1. Claude implementation branch;
2. independent review;
3. Claude fixes;
4. tests;
5. merge.

The source of truth is the repository and automated tests, not any model's prose.

---

# 18. Minimum Hardware

A modern laptop is sufficient for V1.

Target:
- 16 GB RAM minimum;
- 32 GB preferred for large offline simulation;
- modern Apple Silicon or current x86 CPU.

GPU is not required for the live draft optimizer.

If offline oracle simulations become large, use:
- local multicore;
- temporary cloud CPU compute;
- not GPU by default.

---

# 19. Optional Hosted Architecture Later

Only after local V1 works:

Frontend:
- Vercel

Backend:
- Railway, Fly.io, Render, AWS, or similar persistent Python service

Database/realtime:
- Supabase/Postgres

Artifacts:
- object storage

But hosted deployment adds:
- networking;
- authentication;
- latency;
- secret management;
- additional failure modes.

For one draft, local-first is superior.

---

# 20. Exact Runtime Command Goal

Eventually draft night should be:

```bash
make draft
```

This should:
1. validate environment;
2. load cached model artifacts;
3. start backend;
4. start UI;
5. verify extension bridge;
6. run health checks;
7. open the local draft UI.

The system should produce:

```text
READY
CBS bridge: connected
FantasyPros cache: fresh
Model bundle: valid
League config: validated
Last simulation calibration: PASS
Manual fallback: ready
```

Then the user opens CBS and drafts.
