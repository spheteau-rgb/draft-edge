# Data and Integration Architecture

## 1. Architecture Principle

All external systems must be adapters behind stable internal interfaces.

```text
CBS / FantasyPros / nflverse / manual input
               ↓
        ingestion adapters
               ↓
         canonical events
               ↓
      player identity service
               ↓
      state + feature stores
               ↓
      model / optimizer layer
```

No model should know how CBS HTML or FantasyPros JSON is structured.

---

# 2. FantasyPros Integration

Current public API documentation supports:
- NFL players;
- external IDs, including `cbs`;
- rankings;
- player comparisons;
- projections;
- news;
- injuries;
- player points.

Authentication:
- `x-api-key` header.

Build:

```python
class FantasyProsProvider:
    get_players()
    get_rankings()
    get_projections()
    get_injuries()
    get_news()
    get_expert_comparisons()
```

Requirements:
- configurable rate limits;
- exponential backoff;
- ETag/conditional requests if supported;
- response caching;
- schema validation;
- freshness timestamps;
- explicit entitlement errors.

Never hardcode a user key in frontend code.

---

# 3. CBS Sports Integration

CBS should be treated as the source of truth for:
- league settings;
- draft order;
- draft picks;
- rosters;
- league team names;
- potentially historical transaction data.

However, do not assume a public CBS developer API exists.

Create:

```python
class DraftStateProvider(Protocol):
    def get_league_config(self) -> LeagueConfig: ...
    def get_draft_state(self) -> DraftState: ...
    def stream_or_poll_events(self) -> Iterable[DraftEvent]: ...
```

Possible implementations:

1. `CBSAuthorizedProvider`
   - use only if CBS exposes or grants an authorized integration path.

2. `CBSBrowserCompanionProvider`
   - local browser extension observes the authenticated user's draft page;
   - extracts only information visible to the user;
   - sends structured draft events to localhost/backend;
   - must be reviewed against CBS terms before production use.

3. `FantasyProsLeagueSyncBridge`
   - only if an authorized FantasyPros API/product path exposes league state to the user;
   - do not reverse engineer proprietary endpoints.

4. `ManualDraftProvider`
   - always supported;
   - extremely fast player search;
   - undo/reconcile capability.

Important current evidence:
FantasyPros Draft Assistant supports CBS Sports sync, including automatically crossing off taken players and 30-second auto-sync. This proves the technical feasibility of sync but does not itself grant access to FantasyPros private sync interfaces.

---

# 4. Browser Companion Design

If used, the browser extension should be thin.

Responsibilities:
- detect draft events;
- read visible pick rows;
- read current pick / clock if accessible;
- map visible CBS player ID or name;
- send canonical events.

It should not:
- automate clicking;
- submit picks unless explicitly allowed and separately reviewed;
- scrape unrelated content;
- store CBS credentials;
- bypass access controls;
- expose session cookies.

Event:

```json
{
  "event_type": "draft_pick",
  "source": "cbs_browser",
  "source_event_id": "stable-if-available",
  "league_id": "local-alias",
  "pick_number": 24,
  "round": 2,
  "manager_slot": 1,
  "player_source_id": "12345",
  "player_name": "Example Player",
  "position": "WR",
  "nfl_team": "DET",
  "observed_at": "2026-08-29T14:32:11Z"
}
```

Implement deduplication by:
- source event ID; else
- `(pick_number, player_id)`.

---

# 5. Manual Fallback

Manual mode must be first-class, not an afterthought.

UI:
- keyboard-focused search;
- type 2–3 letters;
- arrow/select;
- Enter;
- undo last pick;
- edit owner;
- reconcile full board.

Target:
< 2 seconds per manual update.

Reason:
a live draft cannot depend on one third-party connector.

---

# 6. nflverse / ffverse

Use nflverse for:
- play-by-play;
- weekly stats;
- schedules;
- roster/player data;
- participation where available.

Use ffopportunity:
- expected fantasy points;
- opportunity features;
- benchmark model.

Use ffsimulator:
- design patterns and benchmark outputs;
- not necessarily production runtime.

Production may reimplement critical pieces in Python for latency and maintainability.

Respect open-source licenses:
- ffsimulator: MIT;
- nflverse R code generally MIT but underlying NFL data has its own terms;
- ffopportunity code: GPL-3.0 and expected-points data/models CC BY-SA 4.0.

Claude must perform a license review before copying code into a closed-source application. Prefer clean-room reimplementation of published methodology when license compatibility is uncertain.

---

# 7. Canonical Player Identity

Create stable internal UUID:

```text
player_uuid
```

Mappings:
- FantasyPros player ID;
- CBS ID;
- nflverse/GSIS ID;
- Sleeper ID if useful;
- ESPN/Yahoo IDs if useful.

FantasyPros API currently supports returning external IDs including CBS, making it a strong identity crosswalk source.

Never join by name unless resolving an unmatched record.

Name-match fallback:
1. normalize accents/punctuation;
2. canonical first/last;
3. NFL team;
4. position;
5. fuzzy match;
6. human confirmation if ambiguous.

Store mapping provenance and confidence.

---

# 8. League Configuration Schema

```json
{
  "teams": 12,
  "draft_type": "snake",
  "roster_slots": [
    {"slot": "QB", "count": 1, "eligible": ["QB"]},
    {"slot": "RB", "count": 2, "eligible": ["RB"]},
    {"slot": "WR", "count": 3, "eligible": ["WR"]},
    {"slot": "FLEX", "count": 2, "eligible": ["RB","WR","TE"]}
  ],
  "bench": 6,
  "ir": 2,
  "playoff_teams": 6,
  "playoff_weeks": [15,16,17],
  "waiver_type": "FAAB",
  "faab_budget": 100,
  "scoring": {}
}
```

The parser should support import and manual correction.

---

# 9. State Stores

## Immutable event log

Store every draft event.

Benefits:
- replay;
- debugging;
- deterministic recovery;
- audit trail.

## Current materialized state

Maintain:
- available players;
- rosters;
- current pick;
- manager posterior parameters;
- league demand;
- candidate values.

Use event sourcing principles.

---

# 10. Freshness and Provenance

Every external datum must store:

```text
source
source_timestamp
ingested_at
version
confidence
license/usage category
```

Recommendation explanations should know whether inputs are stale.

Example:
- CBS state: 3 sec old;
- FantasyPros ECR: 2 hr old;
- injury data: 20 min old.

---

# 11. Failure Modes

FantasyPros unavailable:
- continue with cached projections/ECR;
- show degraded-data indicator.

CBS sync unavailable:
- switch to manual without model reset.

Player unmatched:
- pause only that event;
- offer nearest identities.

Model service unavailable:
- fall back to deterministic league-adjusted ranking + survival heuristic.

Simulation timeout:
- return best cached policy result;
- never leave recommendation blank.

---

# 12. Security

- Store API keys server-side or local secure keychain.
- Never log auth tokens.
- Least privilege.
- Validate extension messages.
- Bind local extension bridge to localhost only unless authenticated.
- Sanitize all third-party strings.
- Avoid arbitrary HTML injection.
- Encrypt persisted secrets.
