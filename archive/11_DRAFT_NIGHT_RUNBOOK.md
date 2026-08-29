# Draft Night Runbook

## 1. T-24 Hours

Run:

```bash
make ingest
make models
make replay
make release-check
```

Confirm:
- latest player pool;
- FantasyPros projections/ECR cached;
- injury/news cache fresh;
- league rules unchanged;
- draft order correct;
- model bundle current;
- replay tests pass.

Do not introduce a major algorithm change after this gate unless fixing a critical defect.

---

# 2. T-2 Hours

Run:

```bash
make draft
```

Confirm:

```text
Backend                 PASS
UI                      PASS
CBS bridge              PASS / MANUAL MODE READY
FantasyPros cache       PASS
nflverse snapshot       PASS
League config           PASS
Player identity         PASS
Draft order             PASS
Manual fallback         PASS
Latency benchmark       PASS
```

Open:
1. CBS draft room;
2. Draft Edge recommendation screen;
3. FantasyPros Draft Assistant as independent reference.

FantasyPros should be a cross-check, not the controlling system.

---

# 3. Pre-Draft Reconciliation

Compare:
- number of teams;
- roster slots;
- scoring;
- draft order;
- keeper assignments if applicable;
- already drafted/kept players;
- player availability.

Compute state hash.

Save:
`pre_draft_snapshot.json`.

---

# 4. During Draft

Draft Edge should automatically:
- ingest pick;
- update roster;
- update market;
- update opponent model;
- update player survival;
- update recommendation.

The user's workflow is only:

1. read `PICK`;
2. glance at `WHY`;
3. inspect alternatives if desired;
4. make selection in CBS.

---

# 5. Independent Sanity Check

FantasyPros remains visible.

If Draft Edge recommends a player dramatically below consensus, the UI should automatically surface the reason code.

Example:

```text
CONSENSUS DISAGREEMENT

FantasyPros ECR: 47
Draft Edge: 21

Reason:
Your league awards 0.5 points per rushing first down and 6-point passing TDs,
creating a materially different replacement-value curve.
```

This is not a veto.
It is a prompt to make the divergence interpretable.

---

# 6. Sync Failure

If no CBS event arrives within expected interval after a visible pick:

UI shows:

```text
SYNC DEGRADED
```

Immediately enable manual search.

User enters taken player.

System continues from manual state.

The connector can recover later and reconcile without duplicating picks.

---

# 7. Incorrect Pick

User clicks:
`Undo / Correct`

Backend uses event sourcing:
- mark correction;
- rebuild current state;
- rerun recommendation.

Never mutate historical events invisibly.

---

# 8. FantasyPros Failure

Use cached data.

Do not stop draft.

Show:
`FantasyPros cache: stale`

The optimizer remains functional.

---

# 9. Simulation Timeout

Return:
- last valid recommendation;
- deterministic league-adjusted fallback;
- degraded confidence.

Never return an empty recommendation.

---

# 10. Model Failure

Fallback hierarchy:

1. current fast policy;
2. cached previous-state policy adjusted for removed player;
3. deterministic marginal roster value + survival heuristic;
4. league-adjusted VORP;
5. FantasyPros consensus as final emergency fallback.

The system should always have an answer.

---

# 11. Draft Completion

Save:
- all draft events;
- full board;
- recommendations at every user pick;
- alternatives;
- simulation seeds;
- model versions;
- actual user selections;
- latency;
- connector health.

This becomes training/evaluation data for next season.

---

# 12. Post-Draft Evaluation

Calculate:
- where user followed recommendation;
- where user overrode;
- value left;
- estimated option value;
- realized player survival;
- opponent-model calibration;
- recommendation latency.

Do not judge the system by realized player injuries or one season alone.

Judge whether its probabilities were calibrated and decision process sound.
