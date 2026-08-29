# 01 — Architecture (Vercel + GitHub + usable anywhere, iPad/MacBook-primary)

## Decisions locked
| Fact | Consequence |
|---|---|
| **Real public website on Vercel; usable from ANY device/network** | Not localhost. Primary clients: iPad + MacBook (beside the CBS & FantasyPros apps). Server-side state means iPad, Mac, phone all see one live draft and can be swapped mid-draft. |
| **MacBook + Claude Code** | The BUILD machine: runs Python precompute, commits, deploys. Also a draft-day client. |
| **60-second pick clock** | Latency matters. Rec must be instant on your turn; opponent picks must reach the app in a few seconds. Manual entry is the anchor if live sync fails. |
| **Draft <24h out** | Ruthless scope. Manual-first hosted app ASAP; CBS automation is a bonus. |
| **Non-standard scoring** | Custom scoring engine mandatory (done, verified). |
| **Round-1 history only** | Opponent/manager models use Round-1 priors only; keep modest. |

## Roles
```
 MacBook (Claude Code)         GitHub                Vercel                  Phone
 ---------------------         ------                ------                  -----
 Python precompute      -push-> repo   -deploy hook-> Next.js app     <-open  mobile
 (scoring + Monte Carlo)                             + serverless fns        browser
 emits players.json                                  + KV/Postgres state
 commits data                                        + on-demand CBS roster-diff
```

## Two layers, two languages
**Precompute (Python, build-time on Mac)** - the only place core/scoring.py runs:
```
FantasyPros API + raw sources
   -> projection ensemble (weighted median, winsorize)
   -> weekly distribution (CV priors) -> Monte Carlo N=2000, scored by Family Affair rules
   -> per-player: mean/median wk FP, p10/25/75/90, sd, prob_20/25/30+, VORP inputs
   -> data/players.json + data/priors.json   (committed / uploaded to Blob or KV)
```
**Runtime (TypeScript, Vercel serverless)** - light, fast, LLM-free:
```
draft state (KV/Postgres) + players.json (cached in memory / Blob)
   -> remove drafted -> VORP + flex lineup + market + survival + 1-turn lookahead
   -> recommendation JSON (PICK + 3 alternatives + reasons + survival)
```

## Why the split
The math in docs/03 is language-agnostic. Scoring + Monte Carlo want numpy -> Python,
and run offline only, so they never need porting. The *live* optimizer must run in
Vercel functions -> TypeScript. Clean boundary: Python produces data, TS consumes it.

## State store
Vercel KV (Upstash Redis) is simplest for one draft: keys for draft:state,
draft:log (append-only for undo/replay), providers:health. Postgres (Neon/Supabase)
is fine too. State is server-side so the phone and the CBS poller share one truth.

## Provider abstraction (all inputs normalize identically)
```ts
interface DraftStateProvider {
  health(): Promise<ProviderHealth>;
  getState(): Promise<DraftState>;
  getEvents(since?: string): Promise<DraftEvent[]>;
}
```
Priority: CBSPollProvider (client-driven roster-diff, best-effort) -> ManualProvider (anchor,
always on). Browser companion is NOT used on iPad/tablet (kept in archive for a future
laptop setup).

## CBS live on Vercel (best-effort, fast enough for a 60s clock)
While the app is open, the CLIENT polls `GET /api/draft/refresh` every ~3-5s. That
serverless endpoint authenticates to the legacy CBS API with CBS_ACCESS_TOKEN (a
Vercel encrypted env var), pulls rosters, diffs vs draft:state in KV, and writes any
new picks. ~3-5s freshness beats the 60s clock comfortably. A Vercel Cron (1/min,
the platform minimum) runs the same diff as a BACKGROUND BACKUP for when the tab is
closed - it is NOT the primary path (too slow alone). If the legacy CBS API is
dead/unreliable, both no-op and manual entry carries the draft. The token is the
user's own credential stored as a platform secret - never in the client, never logged.

## Access control
The Vercel URL is public, so gate it: a single shared secret (env var) checked by
middleware, or a simple password screen. Enough to keep strangers out for one night.

## Usable anywhere, any device (hard requirement)
- **Public URL:** one stable Vercel domain (e.g. draft-edge-<you>.vercel.app or a
  custom domain). Reachable over cellular and wifi; nothing depends on localhost or
  the Mac being on.
- **Single source of truth:** draft:state in KV. NO draft state in browser memory,
  localStorage, or a single device. Any client is a thin view over server state.
- **Cross-device sync:** every client polls state every 2-3s. A pick entered on the
  phone appears on the Mac (and vice versa) within seconds. Reconciliation is by
  pick_number (docs/04) so two devices can't corrupt state.
- **Multi-device auth:** the shared-secret unlock sets a cookie PER DEVICE, so you
  can unlock the phone and the Mac independently and both stay logged in.
- **PWA:** web manifest + service worker so you can add it to the phone home screen
  and it opens fullscreen like a native app.
- **Resilience:** if a device drops network, it resumes from server state on
  reconnect - no lost picks.

## The live path must be boring
On your turn a serverless call: load players.json (memory/Blob), read state from KV,
run TS optimizer, return JSON. No LLM, no slow network. Target <1s so you have the
full 60s to act. On any component error, fall down the ladder (docs/07) and still return a
pick.

## Not on the critical path
nflverse deep features (precompute only if time), Sleeper metadata, and Phase-2
research (oracle sim, MCMC, RL, policy distillation). See archive/ for the roadmap.
