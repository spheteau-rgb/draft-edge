# 04 — Integrations

> **Hosting note (primary clients: iPad/MacBook):** The browser-companion path below is UNAVAILABLE when drafting from a phone (no desktop browser). On Vercel, CBS live sync = CLIENT-SIDE polling (every ~3-5s) of an on-demand
roster-diff endpoint using CBS_ACCESS_TOKEN (Vercel encrypted env var; see docs/09).
Vercel cron maxes at 1/min - too slow for the 60s clock - so it's only a backup. If it's unreliable, manual entry from the phone carries the draft. Keep the companion section only for a future laptop-based setup.

Two jobs: (A) player intelligence (FantasyPros + optional others), (B) live
Family Affair draft state (CBS best-effort, manual anchor). The optimizer must run
if either external provider fails.

## A. FantasyPros — do this first
- Docs: `https://api.fantasypros.com/public/v2/docs/`
- Base: `https://api.fantasypros.com/public/v2/json`
- Auth header: `x-api-key: <KEY>` (key is in archive/17; move to `.env`, ROTATE after).
- Connectivity gate (run in diagnose_integrations.py):
  ```bash
  curl "https://api.fantasypros.com/public/v2/json/nfl/players?ecr=included&show=pos_rank&external_ids=cbs" \
    -H "x-api-key: $FANTASYPROS_API_KEY"
  ```
  Pass = HTTP 200, sport=NFL, players array, FantasyPros IDs present, CBS external
  IDs present where available.
- Ingest (only documented endpoints): `/nfl/players`, `/nfl/{season}/rankings`,
  `/nfl/{season}/consensus-rankings`, `/nfl/{season}/projections`, `/nfl/injuries`,
  `/nfl/news`, `/nfl/{season}/player-points`. Use `season=2026`, `week=0` for
  preseason where supported.
- **Cache locally; never let a live pick wait on HTTP.** Refresh cadence:
  players/ids daily, rankings 15m, projections 30m, injuries/news 5m. During your
  pick: compute from cache immediately, refresh async.

## Projection providers — FantasyPros required, others optional
See docs/03 Alg 2 for the full N-based ensemble rule. `FantasyProsProvider` is
REQUIRED for V1 — it is the authoritative raw-stat source, passed through the exact
Family Affair scoring function. `RotoWireProvider` / `CBSProjectionProvider` /
`OtherProvider` are OPTIONAL and only added if genuinely quick (<30-45 min); do not
spend hours scraping multiple sites just to claim an "ensemble." Ship
FantasyPros-only if that's what fits.

## Player identity (critical — never join on name)
Build a crosswalk: DraftEdge UUID ↔ FantasyPros id ↔ CBS id ↔ GSIS/nflverse ↔
(optional others). Use FantasyPros `external_ids=cbs`. Fallback match:
`normalized_name + NFL_team + position` with match confidence + provenance +
human confirm for ambiguity.

## B. CBS live draft state — best-effort, time-boxed
No current public CBS page issues a dev key; the legacy platform used an
`access_token`. Investigate in a BOUNDED order, stop when a reliable live source
is found; never brute-force, never bypass auth, read-only, never automate picks.

**One-time human setup (on the Mac, browser logged into CBS):** Claude Code guides
the user to obtain the CBS access token locally (see the token-fetcher approach in
archive/17 §26). The token/cookies stay on the machine, go in `.env`, are never
printed or sent to the LLM.

Gates:
1. **Host** — test known read endpoints respond.
2. **Auth** — does the historical access-token flow still work for the user's league?
3. **League resources** — `league/teams`, `league/rosters`, `league/draft/order`.
4. **Draft results** — look for a current equivalent of `league/history/draft-results`.
   (draft/order = who is scheduled; draft/results = who was actually picked.)
5. **Live behavior** — which resource changes immediately after a selection?

Legacy endpoint family (test as candidates, don't assume they're live in 2026):
```
GET https://api.cbssports.com/fantasy/league/draft/order
GET https://api.cbssports.com/fantasy/league/rosters   (version=3.0&team_id=all&response_format=JSON&access_token=…)
GET https://api.cbssports.com/fantasy/league/teams
GET https://api.cbssports.com/fantasy/players/list
```

### Roster-diff method (works even without a draft-results endpoint)
If rosters update immediately: `new_player = roster(t1) − roster(t0)`. Since we know
draft order + current pick + team on the clock, infer (pick, team, player), remove
from pool, recompute. Legitimate if the roster endpoint refreshes fast enough.

### Browser companion (second CBS path — needs the Mac's desktop browser)
Local Chrome/Edge MV3 extension observes the authorized draft page and POSTs only
draft-state events to `127.0.0.1:8000/draft/event`. Never exports cookies,
passwords, tokens, or unrelated page data. Prefer structured page-state/WebSocket
data over brittle DOM scraping. (Not possible from a phone — hence the Mac.)

## C. Manual entry — the anchor (always on)
UI: type player name + Enter, or click the drafted player. Target <2s observed->updated. With a 60s clock this is important, not optional. Support undo / correct / reconcile. If CBS breaks
mid-draft, Draft Edge stays fully usable.

## Canonical draft event (every provider maps to this)
```json
{"event_type":"draft_pick","source":"cbs_api|browser|manual","source_event_id":"…",
 "pick_number":24,"round":2,"manager_slot":1,"player_source_id":"CBS-ID",
 "player_name":"…","position":"WR","nfl_team":"DET","observed_at":"2026-08-30T…"}
```

## Reconciliation
Primary key `pick_number`; secondary CBS player id; fallback normalized
name+pos+team. Rules: same pick+same player → merge; same pick+different player →
conflict alert; duplicate player → reject; missing pick → provider stale/reconcile.
Recommendation uses only canonical reconciled state.

## Failure ladder (there must ALWAYS be a recommendation)
```
FantasyPros online → else latest local FantasyPros cache
CBS structured API → else CBS browser companion → else manual entry
Optimizer full → else immediate-score → else RosterGain+market+upside
→ else FA-scored raw projection → else league-adjusted VORP
```

## Optional / not for tomorrow
- **nflverse** (play-by-play, usage, air yards, red-zone) — precompute deeper
  features before the draft only if time allows; never process live.
- **Sleeper** — secondary metadata / trending only; don't delay CBS/FantasyPros.

## Diagnostic tool (scripts/diagnose_integrations.py) — must exist, never prints secrets
```
FantasyPros auth / players / CBS IDs / rankings / projections / injuries : PASS
CBS league / auth / teams / rosters / draft order / draft results / latency : PASS|FAIL|UNKNOWN
Browser companion : READY|NOT BUILT   Manual : PASS   OVERALL : READY|DEGRADED|BLOCKED
```
