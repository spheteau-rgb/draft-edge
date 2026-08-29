# Draft Edge — Family Affair 2026

A local, real-time draft assistant that tells you the best next pick under your
league's exact scoring. Built for the **Family Affair** CBS league, draft slot 4,
**Sunday Aug 30, 2026, 5:00 PM ET**.

## What this package is
A complete, reconciled build spec + a verified scoring core, ready to hand to
**Claude Code** on your MacBook. It supersedes the older scattered docs (kept in
`archive/` for reference).

## How to use it (on the MacBook)
1. Unzip this folder somewhere, e.g. `~/draft-edge`.
2. Open it in Claude Code (`cd ~/draft-edge` then start Claude Code, or open the
   folder from the Claude desktop app's Code tab).
3. Paste the contents of **`BUILD_PROMPT.md`** as your first message.
4. Claude Code reads `CLAUDE.md` automatically and follows the build order.
5. First thing it should do: `cd core && python3 test_scoring.py` → expect
   **ALL TESTS PASSED**. That proves the foundation before anything else is built.

## The one-time setup you (the human) must do
- **FantasyPros key:** it's in the archived doc `archive/17_*.md`. Put it in a
  local `.env` (see `.env.example`). **Rotate/revoke it after the draft.**
- **CBS token (only if you want live sync):** Claude Code will walk you through a
  ~10-minute local step in your logged-in browser on the Mac. Your CBS password
  never leaves the machine.

## Reading order for the docs
- `CLAUDE.md` — mission + constraints (Claude Code reads this).
- `docs/01_ARCHITECTURE.md` — how it's built and why (hosted, usable anywhere, 60s clock).
- `docs/02_LEAGUE_AND_SCORING.md` — your exact rules + what still needs verifying.
- `docs/03_ALGORITHMS.md` — the 5 decision algorithms + all coefficients.
- `docs/04_INTEGRATIONS.md` — FantasyPros, CBS live options, manual, failure ladder.
- `docs/05_HISTORICAL_PRIORS.md` — 7 years of your league's Round-1 behavior.
- `docs/06_UI_AND_API.md` — the screen + the API contract.
- `docs/07_TESTS_AND_ACCEPTANCE.md` — build sequence, tests, draft-day runbook.
- `docs/08_CLAUDE_CODE_SETUP.md` — the full AGENT TEAM + how to drive it.
- `docs/09_DEPLOYMENT.md` — GitHub + Vercel + phone + secrets + CBS cron.

## The single most important fact
**There is a 60-second pick clock.** The recommendation is precomputed so it's on
screen the instant it's your turn, and opponents' picks reach the app within a few
seconds via live sync (or a quick tap if you're entering manually). Manual entry is
the reliability anchor; live sync is what keeps you ahead of the clock.

## Draft-day setup (a real website, usable anywhere)
- Build + deploy from the **MacBook** (Claude Code) to **Vercel** via **GitHub**.
- You get a **stable public URL** you can open on your **phone, the Mac, or a
  tablet** - on cellular or wifi, anywhere. State lives on the server, so every
  device shows the same live draft and you can switch devices mid-draft.
- Unlock each device once with your shared secret. Add it to your phone home screen
  for a fullscreen app.
- Draft in the **CBS app** and glance at **Draft Edge** on whichever screen you like;
  picks sync via live polling (every few seconds) or a quick tap. See `docs/07`
  runbook + `docs/09` deploy.
