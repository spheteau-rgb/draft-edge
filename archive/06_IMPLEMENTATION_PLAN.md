# Implementation Plan

## 1. Recommended Stack

### Backend
Python 3.12+

Libraries:
- FastAPI
- Pydantic
- Polars or pandas
- NumPy
- SciPy
- scikit-learn
- LightGBM/XGBoost
- PyMC or NumPyro only where hierarchical Bayesian models justify cost
- OR-Tools for assignment/optimization
- DuckDB
- PostgreSQL optional for persistent hosted deployment
- Redis optional for live cache

### Frontend
- React / Next.js or Vite
- TypeScript
- TanStack Query
- WebSocket/SSE for live updates

### Browser Companion
- Chrome/Edge extension, Manifest V3
- TypeScript
- minimal DOM adapter
- localhost WebSocket/HTTP bridge

### Research
R may remain available for:
- nflverse/ffverse validation;
- reproducing existing models.

Production should prefer one main runtime unless an R component gives clear measurable benefit.

---

# 2. Core Domain Models

```python
@dataclass(frozen=True)
class Player:
    id: UUID
    name: str
    position: str
    nfl_team: str
    external_ids: dict[str, str]

@dataclass(frozen=True)
class LeagueConfig:
    teams: int
    roster_slots: tuple
    scoring_rules: tuple
    playoff_rules: object
    waiver_rules: object

@dataclass(frozen=True)
class DraftEvent:
    pick_number: int
    manager_id: str
    player_id: UUID
    timestamp: datetime
    source: str

@dataclass
class DraftState:
    current_pick: int
    available: set[UUID]
    rosters: dict[str, list[UUID]]
    opponent_beliefs: dict
    market_state: object
```

---

# 3. Modules

## scoring/
- parser
- rule engine
- fantasy point transformer
- tests

## projections/
- provider normalization
- ensemble
- residual model
- weekly distribution generator
- calibration

## market/
- ADP/ECR
- live league posterior
- positional demand
- tier/cliff model

## opponents/
- priors
- online updater
- pick probability model

## optimizer/
- candidate generator
- assignment value
- survival model
- rollout engine
- robust scorer

## simulator/
- correlated weekly outcomes
- lineups
- schedule
- playoffs
- oracle simulation

## integrations/
- fantasypros
- nflverse
- cbs
- manual

## recommendation/
- structured reason codes
- confidence
- UI payload

---

# 4. Development Phases

## Phase 0 — League rule capture

Deliver:
- complete league-config schema;
- exact custom scoring;
- sample player scoring validation.

No algorithm work should proceed until this is correct.

## Phase 1 — Canonical player model + data

Deliver:
- player registry;
- FantasyPros crosswalk;
- nflverse crosswalk;
- projections;
- ECR/ADP;
- injury/news.

## Phase 2 — Baseline league-adjusted rankings

Deliver:
- exact scoring;
- custom projected points;
- starter assignment;
- dynamic VORP;
- tiers.

This is the first usable fallback.

## Phase 3 — Draft state

Deliver:
- manual draft board;
- immutable events;
- undo/reconcile;
- live roster and availability.

## Phase 4 — Survival + league market

Deliver:
- ADP prior;
- positional demand;
- opponent pick model;
- survival probabilities.

## Phase 5 — Fast optimizer

Deliver:
- candidate generation;
- 2–4 round rollouts;
- option value;
- robust score;
- recommendation API.

## Phase 6 — UI

Deliver:
- one-pick screen;
- alternatives;
- next-pick outlook;
- market pulse;
- degraded sync state.

## Phase 7 — CBS adapter

Only after permitted access method is selected.

Deliver:
- live event ingestion;
- reconnection;
- duplicate handling;
- manual fallback.

## Phase 8 — Oracle simulator

Deliver:
- full draft;
- season;
- playoffs;
- correlated outcomes;
- regret analysis.

## Phase 9 — Policy distillation

Train/fit fast live value function from oracle runs.

## Phase 10 — In-season system

Waivers, trades, weekly lineups, opportunity deltas.

---

# 5. Performance Engineering

Precompute:
- league-scored player distributions;
- pairwise covariance approximations;
- positional replacement curves;
- player tiers;
- base ADP pick probabilities.

Cache:
- future draft states near user's next pick;
- opponent softmax denominators;
- candidate rollout results.

Use:
- vectorized NumPy;
- batched simulation;
- common random number arrays;
- parallel workers only where overhead is justified.

---

# 6. Recommended API

```text
GET  /league
GET  /draft/state
POST /draft/event
POST /draft/undo
POST /draft/reconcile
GET  /recommendation
GET  /recommendation/{player_id}/explain
GET  /market
GET  /players
POST /settings/scoring/validate
```

Recommendation payload:

```json
{
  "pick_number": 24,
  "recommended_player": "...",
  "confidence_band": "HIGH",
  "robust_score": 1.82,
  "survival_to_next_pick": 0.13,
  "league_adjusted_rank": 11,
  "fantasypros_ecr": 19,
  "reason_codes": ["VALUE_GAP","SURVIVAL_URGENCY"],
  "explanation": "...",
  "alternatives": [],
  "data_freshness": {}
}
```

---

# 7. Observability

Log:
- event latency;
- provider freshness;
- recommendation latency;
- candidate score spread;
- simulation SE;
- model version;
- state hash.

Every recommendation should be reproducible from:
- state hash;
- model version;
- random seed bundle.

---

# 8. Claude Coding Discipline

Claude should:
- implement tests before complex optimization;
- avoid one giant notebook;
- produce typed interfaces;
- separate data access from modeling;
- document mathematical assumptions;
- benchmark before optimizing;
- never silently fall back to generic PPR;
- never invent an API endpoint;
- mark speculative integrations as TODO until verified;
- record all data licenses.
