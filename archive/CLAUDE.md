# Draft Edge — Claude Code Project Rules

Read `00_README_AND_MASTER_INDEX.md` first. Detailed architecture is in docs `01`–`12`.

## Non-Negotiable Rules

- Never assume standard PPR or standard roster construction.
- Never invent external API endpoints.
- Never put an LLM in the numerical live recommendation path.
- Never display simulation precision not supported by uncertainty estimates.
- Never join players by display name when a stable ID exists.
- Never merge a model change without replaying baselines and checking calibration.
- Never make CBS connectivity a single point of failure.
- Never expose API keys in browser or frontend code.

## Required Commands

Use the repository's standard commands once implemented:

```text
make test
make lint
make replay
make benchmark
make release-check
make draft
```

## Architecture

- Python/FastAPI quantitative backend.
- React/TypeScript live UI.
- Thin browser extension for permitted CBS live-state observation.
- FantasyPros/nflverse behind adapters.
- Append-only draft event log.
- Fast live policy separate from offline oracle simulator.

## Coding

- Typed interfaces.
- Deterministic tests.
- Property tests for scoring and state transitions.
- Document model assumptions.
- Prefer measurable simplicity over speculative complexity.

## Before Major Changes

Use the relevant project Skill and request independent review:
- quant/model changes → Quant Reviewer;
- integration changes → Integration Reviewer;
- UI changes → UX Reviewer;
- release → Test/Reliability + Security reviewers.
