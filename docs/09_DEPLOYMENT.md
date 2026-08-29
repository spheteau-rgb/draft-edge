# 09 — Deployment (GitHub + Vercel + phone)

Goal: a real hosted web app used primarily on an iPad and/or MacBook (beside the CBS
Sports and FantasyPros apps), and usable from any device/network, with state that
persists server-side and updates from manual entry (and CBS live polling).

## Repo & framework
- **Next.js** (App Router, TypeScript). One app: UI + serverless API routes.
- Monorepo-lite layout:
  ```
  /app            Next.js UI (responsive) + /app/api/* route handlers (runtime optimizer)
  /lib            TS optimizer: vorp.ts, lineup.ts, market.ts, survival.ts, lookahead.ts, reasons.ts
  /precompute     Python: ingest_fantasypros.py, build_players.py (uses ../core/scoring.py)
  /core           scoring.py, league_config.yaml, test_scoring.py  (Python, verified)
  /data           players.json, priors.json (generated), family_affair_history.json (given)
  /scripts        diagnose_integrations.py, cbs_token_setup.py
  ```

## GitHub
1. `git init`, commit, push to a **private** repo.
2. Confirm `.gitignore` excludes `.env*` (except `.env.example`), generated data if
   large, `node_modules`, `.venv`. Install the pre-commit hook (`.claude/hooks`).
3. Never commit secrets — the hook blocks it; also run `git grep -iE 'api[_-]?key'`.

## Vercel
1. Import the GitHub repo in Vercel → framework auto-detected (Next.js).
2. **Environment variables (Vercel dashboard → Settings → Environment Variables):**
   ```
   FANTASYPROS_API_KEY   (server only; used only by precompute/diagnostics, not client)
   CBS_LEAGUE_ID
   CBS_ACCESS_TOKEN      (encrypted; used by the CBS roster-diff: client refresh + cron backup)
   KV_REST_API_URL / KV_REST_API_TOKEN   (from Vercel KV integration)
   APP_SHARED_SECRET     (gate for the public URL)
   ANTHROPIC_API_KEY     (optional; only for off-critical-path AI features)
   ```
   Mark all as server-side. **Nothing secret may appear in the client bundle**
   (no `NEXT_PUBLIC_` secrets).
3. Add the **Vercel KV** integration (Upstash) → auto-populates KV env vars.
4. Deploy. Every `git push` to main redeploys.

## Player data on Vercel
- Simplest: commit `data/players.json` to the repo (it's small enough) → available
  at build. Refresh = re-run precompute on the Mac, commit, push (auto-redeploy).
- Alternative: upload to **Vercel Blob** and fetch+cache at cold start.
- Runtime reads it once and caches in module scope; never refetches per request.

## Draft state (server-side)
- Keys in KV: `draft:state` (JSON), `draft:log` (list, append-only for undo),
  `providers:health`.
- `POST /api/draft/pick` (manual or provider) → validate → append to log → update
  state. `POST /api/draft/undo` → pop log → rebuild state. `GET /api/recommendation`
  → compute from state + players.json.

## CBS live sync (best-effort, fast enough for a 60s clock)
**There is a 60-second pick clock**, so freshness must be a few seconds, not a
minute. Vercel Cron's finest granularity is 1/min - too slow to be the primary path.

**Primary = client-driven polling.** While the app is open, the client calls
`GET /api/draft/refresh` every ~3-5s. That serverless handler: auth to CBS with
`CBS_ACCESS_TOKEN`, pull rosters, diff vs `draft:state`, write new picks to KV,
return updated state. ~3-5s latency beats the clock comfortably. **Protect this
endpoint:** it triggers CBS API calls using your secret token, so require an
authenticated app session (the APP_SHARED_SECRET cookie) AND server-side rate limiting
(e.g. token-bucket in KV, ~1 call / 2s / session, hard cap per minute). Reject
unauthenticated or over-limit requests before touching CBS. Wrap in try/catch;
on failure return last-known state and set `providers:health.cbs=degraded`. Be gentle
on the CBS API (cache, exponential backoff on errors). Cost is trivial (~1-2k calls
over a 2h draft).

**Backup = Vercel Cron (1/min).** `vercel.json`:
```json
{ "crons": [ { "path": "/api/cron/cbs-poll", "schedule": "* * * * *" } ] }
```
Runs the SAME roster-diff so picks are still captured if the tab is closed/backgrounded.
It is a safety net, not the live mechanism.

**One-time token step** (`scripts/cbs_token_setup.py`, run on the Mac): guides the
user to obtain the CBS access token from their logged-in session; prints ONLY
"token acquired, add it to Vercel env as CBS_ACCESS_TOKEN" - never the token itself.
If the legacy flow is dead, report it and fall back to manual.

**If CBS live is unreliable:** with a 60s clock you can still tap in each opponent
pick as it happens (one name per 60s is easy) - but pursue client-polling first, it
removes that burden. Keep manual entry one-tap fast either way.

## Usable anywhere, any device (must verify, not assume)
- **Stable public domain:** use the Vercel-assigned domain or attach a custom one.
  Confirm it loads over CELLULAR (turn wifi off on the phone), not just home wifi.
- **All state server-side (KV).** No draft state in localStorage or device memory,
  so any device is a live view and devices can be swapped mid-draft.
- **Cross-device test is an acceptance gate (docs/07):** open the URL on the phone
  AND the Mac, enter a pick on one, confirm it appears on the other within ~3s.
- **Auth per device:** /unlock sets an httpOnly cookie on each device independently.
- **PWA install:** add a web manifest + a minimal service worker (offline shell +
  cache the app shell; NEVER cache draft state - always fetch that live). Then
  'Add to Home Screen' gives a fullscreen app on the phone.
- **Keep-awake:** during the draft, the open tab drives live polling; add a wake
  lock / gentle heartbeat so a backgrounded phone still catches picks (cron backup
  covers the rest).

## Phone access
- Responsive UI (docs/06), iPad/desktop-primary. Test on the iPad AND MacBook (and a
  phone) before draft day.
- Gate with `APP_SHARED_SECRET`: middleware checks a cookie set after entering the
  secret on a `/unlock` page. Keep it trivial; this is one night, one user.
- Add to Home Screen on iPad/phone (PWA: manifest + service worker) so it opens
  fullscreen; on the Mac just keep the tab open beside CBS/FantasyPros.

## Rollback safety
- Tag a known-good deploy before draft day. If a last-minute change breaks it,
  Vercel → Deployments → promote the previous good build in seconds.

## Draft-day note
There's a 60s clock, so keep the app OPEN and polling during the draft (that's the
live path). The rec is precomputed, so it's on screen instantly on your turn -
glance and confirm. If Vercel cold-starts or CBS lags, the worst case is you tap the
pick in; live client-polling is what keeps you ahead of the clock.
