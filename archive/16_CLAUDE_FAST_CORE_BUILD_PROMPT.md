# Claude Fast-Core Build Prompt

Read all project Markdown files, but for the August 30, 2026 production build treat `15_DRAFT_EDGE_2026_FAST_CORE_ALGORITHMS.md` as the controlling algorithm/scope document.

Do not build the multi-month research roadmap now.

Implement the five production algorithms exactly in this order:
1. Family Affair scoring engine.
2. Projection ensemble / cached player distributions.
3. Dynamic flex-aware VORP and roster value.
4. Family Affair market + survival model.
5. Fast sequential optimizer with one-turn lookahead.

Then build draft state, manual input, recommendation UI, tests, and only then CBS automation if time remains.

All heuristic coefficients must live in configuration.
No LLM call may occur in the numerical recommendation path.
Never invent CBS or FantasyPros endpoints.
Never block the draft because an external service is unavailable.
Manual mode is a production feature, not a temporary hack.

Before declaring ready, run scoring-boundary tests, full mock-draft replay, undo/reconcile tests, and latency checks.
