# BUILD_PROMPT — paste this as your first message to Claude Code (on the MacBook)

You are building **Draft Edge** for my Family Affair CBS fantasy draft on
**Sunday Aug 30, 2026, 5:00 PM ET**. Target: a **Vercel-hosted, GitHub-versioned,
responsive** web app I use primarily on my **iPad and/or MacBook** on draft day,
side-by-side with the CBS Sports and FantasyPros apps (and usable from any device). This MacBook is the build
machine.

First: read `CLAUDE.md` (governing spec), then `docs/01`, `docs/03`, `docs/07`,
`docs/08`, `docs/09`. `archive/` is reference only; `docs/` is authoritative.

Use the agent team in `.claude/agents/`. Act as the **orchestrator**: plan in the
build order, delegate to specialists, run the acceptance gate after each step, and
keep a short STATUS (done / in-progress / next / at-risk) at the top of each reply.

Rules (do not violate):
1. Prove the foundation: run `python3 core/test_scoring.py` → "ALL TESTS PASSED"
   before building anything. Don't modify scoring without keeping it green
   (scoring-guardian).
2. The system must be fully usable via MANUAL entry before any CBS automation. No
   pick clock exists — manual is the anchor.
3. The live recommendation path never calls an LLM and never blocks on a slow network
   call. Python precomputes players.json; the TS runtime does light math on cached data.
4. Deploy to Vercel EARLY (deployment-engineer) so the real hosted URL works on the
   iPad/MacBook by mid-build.
5. Secrets only in Vercel env / local `.env`; never in the client bundle or git
   (security-officer). Move the FantasyPros key from my original file 17 into `.env`;
   remind me to rotate it after setup. CBS token via `scripts/cbs_token_setup.py` on
   this Mac, stored as a Vercel env var — never printed.
6. CBS live sync (best-effort, time-boxed): PRIMARY is client-driven polling of
   GET /api/draft/refresh every ~3-5s (fast enough for the 60s clock). A 1/min Vercel
   cron runs the same roster-diff only as a BACKGROUND BACKUP. /api/draft/refresh must
   require an authenticated app session + server-side rate limiting (it triggers CBS
   API calls with your secret token). If CBS is unreliable, make manual entry
   excellent and say so honestly.
7. Config over hardcoding for every coefficient.

Start now:
- Step A: run the scoring tests; show output.
- Step B: architect scaffolds the Next.js repo (docs/09 layout) + shared types;
  deployment-engineer inits GitHub + a first Vercel deploy to a STABLE PUBLIC URL and
  has me open it on my iPad AND MacBook (and a phone over cellular) today to confirm
  it's reachable anywhere - not localhost. State goes in Vercel KV so all devices share
  one live draft.
- Step C: integration-doctor runs the FantasyPros gate; show what the API returns.
- Then proceed through the build order, checking in after each step.

Before freeze: run every acceptance gate in docs/07 (including the deterministic
100-seed shadow draft) and complete one full 14-round mock draft from slot 4 on my
phone. If time is tight, cut CBS automation first — never the decision engine or
the deploy. Ask me only for the CBS token step and the scoring/league VERIFY items
in docs/02. Begin with Step A.
