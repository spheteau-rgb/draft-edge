# Source Register

This file records major external sources reviewed in the design.

## FantasyPros Public API

https://api.fantasypros.com/public/v2/docs/

Supports:
- players;
- external IDs including CBS;
- rankings;
- compare players;
- projections;
- news;
- injuries;
- player points.

Use documented endpoints and user-authorized API keys only.

## FantasyPros Draft Assistant

https://support.fantasypros.com/hc/en-us/articles/115001308567-What-is-the-Draft-Assistant

Current documentation states Draft Assistant supports CBS Sports and uses personal cheat sheets, team needs, and position scarcity in recommendations.

## FantasyPros Manual vs Sync

https://support.fantasypros.com/hc/en-us/articles/115001356148-What-is-the-difference-between-the-Manual-Draft-Assistant-and-Draft-Assistant-w-Sync

Documents direct sync with CBS and automatic crossing-off of drafted players, with optional 30-second auto-sync.

## FantasyPros Supported Commissioner Hosts

https://support.fantasypros.com/hc/en-us/articles/115000540814-Which-fantasy-football-league-commissioner-host-sites-are-supported-in-the-Draft-Wizard-Draft-Assistant

Documents CBS Sports as supported.

## FantasyPros Expert Accuracy

https://www.fantasypros.com/2026/07/2025s-most-accurate-fantasy-football-draft-rankings/

Shows:
- 2025 preseason accuracy rankings;
- rolling 2023–2025 multi-year accuracy;
- variation in expert performance.

https://www.fantasypros.com/2026/01/2025-fantasy-football-rankings-most-accurate-experts/

Shows separate in-season weekly accuracy rankings.

## nflverse

https://github.com/nflverse/nflverse

Documents:
- nflfastR play-by-play back to 1999;
- nflseedR;
- nflreadr;
- related tools.

## ffverse

https://github.com/ffverse

Documents the fantasy-football ecosystem including:
- ffscrapr;
- ffsimulator;
- ffpros;
- ffopportunity.

## ffopportunity

https://github.com/ffverse/ffopportunity

Expected fantasy points model:
- XGBoost;
- nflverse play-by-play;
- opportunity-level expected points.

License:
- code GPL-3.0;
- expected-points data/models CC BY-SA 4.0.

## ffsimulator

https://github.com/ffverse/ffsimulator

Uses bootstrap resampling for fantasy season simulations, optimal lineups, replacement-level handling, season outcomes, trade effects.

License:
- MIT for package code.

## ffanalytics

https://github.com/FantasyFootballAnalytics/ffanalytics

Supports:
- multi-source projections;
- average/robust/weighted aggregation;
- ADP/AAV;
- ECR;
- uncertainty based on projection and rank dispersion;
- custom scoring.

## Academic DFS Optimization

Hunter, Vielma, Zaman:
"Picking Winners in Daily Fantasy Sports Using Integer Programming"

https://arxiv.org/abs/1604.01455

Relevant concepts:
- top-heavy objective functions;
- variance;
- covariance/correlation;
- combinatorial optimization.

Do not directly transfer DFS conclusions without validation because season-long fantasy has different dynamics.

## CBS Fantasy Commissioner Terms

https://www.cbssports.com/info/about/tos/fcs

Effective April 28, 2026.

Any browser-companion or automated integration should be reviewed against applicable CBS/Paramount terms before production deployment.

---

# Research Interpretation Notes

- FantasyPros' CBS synchronization demonstrates technical feasibility but does not imply that its private synchronization mechanisms are available to third parties.
- Open-source scrapers are not automatically appropriate production integrations; use licensed/documented APIs where available.
- Historical expert accuracy should be used with regularization because leaderboard leadership changes across years and tasks.
- Open-source models should be benchmarked and potentially retrained on current data rather than copied unquestioningly.
