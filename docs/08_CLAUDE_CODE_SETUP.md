# 08 — The Agent Team & How to Drive It

Draft Edge ships with a full Claude Code subagent team in `.claude/agents/`. Each is
a specialist with a narrow charter so the build stays clean, fast, and correct.
Claude Code auto-discovers them; invoke by name or let the orchestrator delegate.

## Roster
| Agent | Owns | Invoke when |
|---|---|---|
| **orchestrator** | Sequencing, stop-loss, acceptance gates | Start of every session; to plan next step |
| **architect** | Repo scaffold, tech choices, shared types | Scaffolding, adding modules, design questions |
| **data-engineer** | FantasyPros ingest, identity map, Python precompute → players.json | Building/refreshing player data |
| **algorithm-engineer** | TS runtime optimizer (VORP, lineup, market, survival, lookahead, reasons) | Building the decision engine |
| **frontend-engineer** | Responsive (iPad/desktop-primary) Next.js UI + manual entry + auth | Building the client |
| **deployment-engineer** | GitHub + Vercel + KV + secrets + CBS live polling | Repo init, deploy, hosting config |
| **integration-doctor** | FantasyPros + bounded CBS gates + diagnostics | Testing/enabling integrations |
| **scoring-guardian** | Scoring correctness (52 tests) | After ANY scoring/config change |
| **security-officer** | Secrets hygiene, CBS token, auth gate | Before every commit/deploy |
| **qa-engineer** | Tests, acceptance, mock draft, latency | Before each gate and freeze |
| **ai-features** | OPTIONAL off-critical-path AI polish | Only after core + deploy are solid |

## How to drive it (recommended flow)
1. Paste `BUILD_PROMPT.md`. The **orchestrator** reads CLAUDE.md + docs and states
   the next action.
2. Let it delegate in the build order (CLAUDE.md): architect → data-engineer +
   algorithm-engineer → frontend-engineer → deployment-engineer (deploy EARLY so
   the hosted URL works on iPad/MacBook) → integration-doctor → qa-engineer. **scoring-guardian** and
   **security-officer** run continuously as guardrails.
3. After each major step the orchestrator runs the matching gate in docs/07 and
   reports GREEN/RED + next action.
4. **ai-features** is last and optional — and never enters the live pick path.

## Guardrails baked in
- `.claude/hooks/pre-commit.sh` blocks committing `.env`/secrets and fails the commit
  if `core/test_scoring.py` is red.
- Two hard rules every agent honors: (a) no LLM/slow-network in the live pick path;
  (b) manual entry always works, so the app is usable even with zero integrations.

## Escalate to the human for
- The one-time CBS token step (on the Mac).
- The 6 VERIFY scoring items (docs/02) from the CBS settings page.
- Any tradeoff that reduces reliability.
Everything else: proceed.
