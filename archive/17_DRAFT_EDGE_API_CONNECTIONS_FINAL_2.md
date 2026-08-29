# 17 — Draft Edge API Connections — FINAL
## FantasyPros + CBS Fantasy Sports + Required Fallbacks
**Date:** 2026-08-29  
**Purpose:** Governing integration specification for Claude for the 2026 Family Affair draft.

> **Temporary security decision:** The FantasyPros API key is intentionally included below at the user's explicit request for immediate implementation. Rotate/revoke it after setup and replace it with the new key in local `.env`. Never commit this file or the key to a public repository.

---

# 1. Production Objective

Draft Edge needs two things:

1. **Player intelligence** — projections, ECR/rankings, ADP/market signal, injuries/news, player IDs.
2. **Live Family Affair draft state** — exactly who was selected, by whom, at what pick, and who remains available.

Production architecture:

```text
FantasyPros API ───────────────┐
                               │
CBS live draft state ──────────┼──> Canonical Player + Draft State
                               │              ↓
Family Affair history ─────────┘       Draft Edge Optimizer
                                              ↓
                                      BEST NEXT PICK
```

The numerical recommendation engine must continue operating if either external provider temporarily fails.

---

# 2. FantasyPros — READY TO IMPLEMENT

## Official documentation

https://api.fantasypros.com/public/v2/docs/

## Base URL

```text
https://api.fantasypros.com/public/v2/json
```

## API key — TEMPORARY

```text
REDACTED_SEE_README_ROTATE_THIS
```

## Authentication

Send:

```http
x-api-key: REDACTED_SEE_README_ROTATE_THIS
```

## Local environment

Claude should immediately create a local `.env`:

```env
FANTASYPROS_API_KEY=REDACTED_SEE_README_ROTATE_THIS
CBS_LEAGUE_ID=
CBS_ACCESS_TOKEN=
```

And `.gitignore` must contain:

```text
.env
.env.*
```

**Do not hard-code the key into application source code.**

---

# 3. FantasyPros — First Connectivity Test

Claude should run:

```bash
curl "https://api.fantasypros.com/public/v2/json/nfl/players?ecr=included&show=pos_rank&external_ids=cbs" \
  -H "x-api-key: $FANTASYPROS_API_KEY"
```

Success criteria:

```text
HTTP 200
sport = NFL
players array exists
FantasyPros player IDs exist
CBS external IDs are returned where available
```

This is the first integration gate.

---

# 4. FantasyPros Data to Ingest

Implement only endpoints documented by FantasyPros.

Priority:

```text
/nfl/players
/nfl/{season}/rankings
/nfl/{season}/consensus-rankings
/nfl/{season}/projections
/nfl/injuries
/nfl/news
/nfl/{season}/player-points
```

The official public v2 documentation currently confirms players, rankings, consensus rankings, projections, news/injuries and player-points resources.

For 2026 use:

```text
season = 2026
week = 0
```

for preseason/draft data where supported.

---

# 5. FantasyPros Player Identity — CRITICAL

The official `/nfl/players` endpoint supports:

```text
external_ids=cbs
```

It also supports multiple external IDs.

Use FantasyPros to build:

```text
DraftEdge internal UUID
        ↕
FantasyPros player_id
        ↕
CBS player ID
        ↕
GSIS / nflverse ID
        ↕
optional other platform IDs
```

**Never use player name as the primary join key.**

Fallback:

```text
normalized name + NFL team + position
```

with:
- match confidence;
- provenance;
- human confirmation for ambiguity.

---

# 6. FantasyPros Live Information

FantasyPros Draft Assistant w/ Sync supports CBS drafts and automatically tracks drafted players in its product.

This is important evidence that live CBS draft-state synchronization is technically possible.

However:

**Do not assume the public FantasyPros v2 API exposes the user's Draft Assistant live draft state unless the official API documentation actually shows such an endpoint.**

FantasyPros public API = player intelligence.

CBS/direct draft-state provider = preferred live draft state.

FantasyPros live sync may be used as an independent corroboration source only through a legitimate supported access path.

---

# 7. CBS Fantasy Sports — What We Know

CBS historically operated a real Fantasy Platform API.

Historical host:

```text
https://api.cbssports.com
```

Historical API version:

```text
3.0
```

CBS later deprecated/removed the public developer documentation, but surviving official material and open-source implementations establish concrete API resources.

The API historically used an:

```text
access_token
```

rather than a FantasyPros-style developer API key.

Therefore CBS setup is:

```text
CBS account / authorized league
        ↓
CBS access token
        ↓
CBS Fantasy API
        ↓
Family Affair league state
```

---

# 8. Known CBS Endpoint Family

These are historically evidenced CBS Fantasy endpoints and should be tested as **read-only candidates** against the current service.

## Draft order

```text
GET https://api.cbssports.com/fantasy/league/draft/order
```

Historically returns draft-order/pick/team information.

## Rosters

```text
GET https://api.cbssports.com/fantasy/league/rosters
```

Historical parameters include:

```text
version=3.0
team_id=all
response_format=JSON
access_token=<TOKEN>
```

## Teams

```text
GET https://api.cbssports.com/fantasy/league/teams
```

## Players

```text
GET https://api.cbssports.com/fantasy/players/list
```

## Player updates

```text
GET https://api.cbssports.com/fantasy/players/updates
```

## Sports

```text
GET https://api.cbssports.com/fantasy/sports
```

---

# 9. CBS Draft Results

Historical CBS documentation included a draft-history resource family including:

```text
history/draft-results
history/draft-stats
history/results
history/rosters
```

Claude should specifically investigate whether the current API still supports a resource equivalent to:

```text
/fantasy/league/history/draft-results
```

or another current draft-results route.

**Do not invent the exact live endpoint. Validate it.**

Important distinction:

```text
draft/order   = who is scheduled to pick
draft/results = who was actually picked
```

Draft Edge ultimately needs the second.

---

# 10. CBS Authentication — Make This Simple for the User

Unlike FantasyPros, no current public CBS page has been established that simply issues a developer API key.

Claude should therefore own the CBS setup flow.

Desired user experience:

```text
CONNECT CBS
    ↓
User authenticates locally with CBS
    ↓
Application identifies Family Affair
    ↓
Application obtains/uses authorized league access
    ↓
CONNECTED
```

The user should not have to discover API endpoints manually.

Never send CBS credentials to an LLM.

Never print:
- password;
- cookies;
- access token;
- authorization header.

Store sensitive values locally only.

---

# 11. CBS API Investigation Order

Claude must use a bounded investigation, not open-ended research.

## Gate 1 — API host

Test known harmless/read endpoints.

## Gate 2 — Authentication

Determine whether the historical access-token flow remains usable for the user's authorized CBS account/league.

## Gate 3 — League resources

Validate:

```text
league/teams
league/rosters
league/draft/order
```

## Gate 4 — Draft results

Search/test historically documented draft-result resources using only the authorized API surface.

## Gate 5 — Live behavior

Determine which resource changes immediately after a draft selection.

Stop when a reliable live source is found.

---

# 12. Roster-Diff Method — Important Fallback

A dedicated live draft-results endpoint is **not strictly required** if CBS rosters update immediately.

At state `t0`:

```text
Team 7 roster:
A
B
C
```

After pick:

```text
Team 7 roster:
A
B
C
PLAYER X
```

Then:

```text
new_player = roster(t1) - roster(t0)
```

Because Draft Edge already knows:
- draft order;
- current pick;
- team on the clock;

it can infer:

```text
Pick 18
Team 7
selected PLAYER X
```

Then remove PLAYER X from the available pool and recompute.

This is a legitimate production strategy if the roster endpoint updates fast enough.

---

# 13. Browser Companion — Second CBS Path

If the legacy CBS API does not expose sufficiently live draft state, build a local Chrome/Edge extension.

The browser is already authenticated to CBS.

The extension observes the authorized draft page and emits only draft-state events to localhost.

```text
CBS Draft Room
      ↓
Local Browser Companion
      ↓
POST 127.0.0.1:8000/draft/event
      ↓
Draft Edge
```

It must not export:
- cookies;
- passwords;
- session tokens;
- unrelated page data.

Prefer structured JSON/WebSocket/page-state data over brittle DOM scraping when available and permitted.

---

# 14. Canonical Draft Event

Every provider maps into:

```json
{
  "event_type": "draft_pick",
  "source": "cbs_api",
  "source_event_id": "...",
  "pick_number": 24,
  "round": 2,
  "manager_slot": 1,
  "player_source_id": "CBS-ID",
  "player_name": "Example Player",
  "position": "WR",
  "nfl_team": "DET",
  "observed_at": "2026-08-30T..."
}
```

Once normalized, the optimizer does not care where the event originated.

---

# 15. Provider Architecture

Implement:

```python
class DraftStateProvider(Protocol):
    async def health(self) -> ProviderHealth: ...
    async def get_state(self) -> DraftState: ...
    async def get_events(self, since=None) -> list[DraftEvent]: ...
```

Providers:

```text
CBSLegacyApiProvider
CBSBrowserCompanionProvider
FantasyProsObservationProvider
ManualDraftProvider
```

Priority:

```text
verified structured CBS live feed
        ↓
CBS local browser companion
        ↓
legitimate FantasyPros synced observation
        ↓
manual
```

---

# 16. Manual Mode Is Mandatory

Manual input is not a hack.

It is the final reliability layer.

Draft screen should allow:

```text
type player name
ENTER
```

or:

```text
click drafted player
```

Target:

```text
< 2 seconds from observed pick to updated recommendation
```

Support:

```text
undo
correct
reconcile
```

If CBS breaks during the draft, Draft Edge must remain fully usable.

---

# 17. Reconciliation

Primary event key:

```text
pick_number
```

Secondary:

```text
CBS player ID
```

Fallback:

```text
normalized name + position + NFL team
```

Rules:

```text
same pick + same player → merge
same pick + different player → conflict alert
duplicate drafted player → reject
missing pick → provider stale / reconcile
```

Recommendation uses only canonical reconciled state.

---

# 18. Freshness

Provider health:

```json
{
  "provider": "cbs",
  "status": "healthy",
  "last_event_age_seconds": 1.2,
  "consecutive_errors": 0
}
```

UI:

```text
CBS            LIVE · 1s
FantasyPros    CURRENT · 12m
Manual         READY
```

CBS draft state:

```text
<15s = healthy
15–45s = warning
>45s = degraded
```

Never block recommendation.

---

# 19. FantasyPros Cache

Do not make live pick calculation wait for FantasyPros HTTP calls.

Pre-fetch and cache locally.

Suggested refresh:

```yaml
players_and_ids: daily
rankings: 15_minutes
projections: 30_minutes
injuries: 5_minutes
news: 5_minutes
```

During the user's pick:
- calculate from cache immediately;
- refresh network asynchronously.

---

# 20. Integration Failure Ladder

```text
FantasyPros online
    ↓ failure
latest local FantasyPros cache

CBS structured API
    ↓ failure
CBS browser companion
    ↓ failure
FantasyPros synced observation if legitimately accessible
    ↓ failure
manual draft entry
```

**There must always be a recommendation.**

---

# 21. Additional Data Connection — nflverse

Use nflverse for the deeper quantitative layer:

```text
play-by-play
historical player usage
targets
rushing opportunity
red-zone opportunity
team/game context
historical validation
```

This is not required for live draft synchronization.

Precompute these features before the draft.

Do not perform large nflverse processing while the user is on the clock.

---

# 22. Optional Sleeper API

Sleeper can be used as a secondary source for:

```text
player metadata
trending adds/drops
identity sanity checks
```

It is not a priority for the Family Affair CBS draft.

Do not delay CBS/FantasyPros work for Sleeper.

---

# 23. Diagnostic Tool

Claude must create:

```text
scripts/diagnose_integrations.py
```

Output:

```text
DRAFT EDGE INTEGRATION CHECK

FantasyPros API auth........ PASS
FantasyPros players......... PASS
FantasyPros CBS IDs......... PASS
FantasyPros rankings........ PASS
FantasyPros projections..... PASS
FantasyPros injuries........ PASS

CBS league.................. SET
CBS authentication.......... PASS/FAIL
CBS teams................... PASS/FAIL
CBS rosters................. PASS/FAIL
CBS draft order............. PASS/FAIL
CBS draft results........... PASS/UNKNOWN
CBS live latency............ 1.4s / UNKNOWN

Browser companion........... READY/NOT BUILT
Manual provider............. PASS

OVERALL..................... READY / DEGRADED / BLOCKED
```

Never print secrets.

---

# 24. Claude Implementation Order

## 1 — FantasyPros

Do this immediately.

```text
API auth
→ players
→ CBS external IDs
→ rankings
→ projections
→ injuries/news
→ local cache
```

## 2 — CBS

```text
auth
→ league identification
→ teams
→ draft order
→ rosters
→ draft-results investigation
→ live update test
```

## 3 — Browser companion

Only if direct CBS live state is not reliable enough.

## 4 — Manual mode

Must be production ready regardless.

## 5 — Reconciliation

Run multiple providers simultaneously when possible.

---

# 25. Security / Operational Rules

For the temporary FantasyPros key:

- use now;
- keep local;
- do not commit;
- rotate after setup.

For CBS:

- use only the user's authorized account/league;
- read-only integration for draft V1;
- do not brute-force endpoints;
- do not bypass authentication/access controls;
- do not automate picks;
- do not store plaintext CBS passwords;
- do not log access tokens.

---

# 26. Source Register

## FantasyPros official API

```text
https://api.fantasypros.com/public/v2/docs/
```

The official current docs establish:
- base URL;
- `x-api-key` authentication;
- NFL players;
- `external_ids=cbs`;
- rankings;
- consensus rankings;
- projections;
- news/injuries;
- player points.

## FantasyPros API key request

```text
https://secure.fantasypros.com/api-keys/request/
```

## CBS historical Fantasy Platform

```text
https://www.cbssports.com/info/aboutus/press/2012/fope12
```

## CBS historical API evidence

```text
https://patents.justia.com/patent/8732278
```

## CBS open-source integration research

```text
https://github.com/geoffharcourt/cbs_fantasy_sports_api_token_fetcher
https://github.com/uberfastman/fantasy-football-metrics-weekly-report
```

Treat deprecated CBS resources as integration candidates that must be runtime-tested, not as guaranteed 2026 contracts.

---

# 27. Final Claude Instruction

> Treat this document as the governing Draft Edge integration specification. FantasyPros is ready for immediate implementation using the included temporary API key; move the key into local `.env` and never commit or log it. Validate the official FantasyPros v2 endpoints and CBS external player IDs first. Then independently establish authorized read-only CBS league access and test the historically evidenced v3 league resources, specifically teams, rosters, draft order and draft-history/results resources. The objective is a reliable live stream of actual Family Affair selections. If a dedicated draft-results endpoint is unavailable but rosters update immediately, implement roster-diff synchronization. If direct CBS access is not reliable, use the local authenticated browser companion. Manual entry remains a mandatory production fallback. Do not let CBS research block the optimizer. The numerical recommendation path must always have current canonical draft state and must never depend on an LLM or a network request while the user is on the clock.
