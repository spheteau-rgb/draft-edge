"""
Family Affair — exact scoring engine.

Scores ONE game's raw stat line under exact Family Affair rules.
Because bonuses are nonlinear, callers must score each simulated weekly
stat line and then average — never score the average stat line.
    Score(E[stats]) != E[Score(stats)]

No third-party dependencies (pure stdlib) so it runs anywhere.
Rules live in FAMILY_AFFAIR_RULES; keep league_config.yaml in sync.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List

FAMILY_AFFAIR_RULES = {
    "passing": {
        "yards_per_point": 20, "fractional": True, "td": 6, "int": -1, "two_pt": 2,
        "yardage_bonuses": [(250, 1), (300, 3), (400, 5)],      # cumulative
        "td_length_bands": [(50, 3), (40, 2), (30, 1)],          # non-cumulative
    },
    "rushing": {
        "yards_per_point": 10, "fractional": True, "td": 6, "two_pt": 2,
        "yardage_bonuses": [(100, 1), (150, 3), (200, 5)],
        "td_length_bands": [(50, 3), (40, 2), (30, 1)],
    },
    "receiving": {
        "yards_per_point": 10, "fractional": True, "td": 6, "two_pt": 2,
        "yardage_bonuses": [(100, 1), (150, 3), (200, 5)],
        "td_length_bands": [(50, 3), (40, 2), (30, 1)],
        "reception_bands": [(10, 5), (7, 3), (4, 1)],            # non-cumulative range
    },
    "misc": {"fumble_lost": -1, "kick_return_td": 6, "punt_return_td": 6},
    "kicking": {"fg_base": 3, "fg_length_bands": [(50, 3), (40, 2), (30, 1)], "xp": 1},
    "dst": {
        "fumble_rec": 2, "forced_fumble": 1, "int": 2, "td": 6, "sack": 1, "safety": 2,
        "points_allowed": [  # (max_points_allowed_inclusive, fantasy_points)
            (1, 15), (6, 12), (10, 10), (14, 8), (19, 6), (25, 4), (30, 2),
        ],
        "points_allowed_over_30": 0,  # UNOBSERVED — verify
    },
}


def _yards(y: float, per: int, fractional: bool) -> float:
    return y / per if fractional else float(int(y // per))


def cumulative_bonus(value: float, thresholds) -> float:
    """Sum every bonus whose threshold is met (250/300/400 stack)."""
    return sum(b for t, b in thresholds if value >= t)


def band_bonus(value: float, bands) -> float:
    """Return the single bonus for the highest band met (bands high->low)."""
    for t, b in bands:
        if value >= t:
            return b
    return 0.0


@dataclass
class StatLine:
    # passing
    pass_yards: float = 0.0
    pass_td: int = 0
    interceptions: int = 0
    pass_2pt: int = 0
    pass_td_lengths: List[int] = field(default_factory=list)
    # rushing
    rush_yards: float = 0.0
    rush_td: int = 0
    rush_2pt: int = 0
    rush_td_lengths: List[int] = field(default_factory=list)
    # receiving
    receptions: int = 0
    rec_yards: float = 0.0
    rec_td: int = 0
    rec_2pt: int = 0
    rec_td_lengths: List[int] = field(default_factory=list)
    # if per-TD lengths are unknown, an upstream expected long-TD bonus can be passed
    expected_long_td_bonus: float = 0.0
    # misc offense / returns
    fumbles_lost: int = 0
    kick_return_td: int = 0
    punt_return_td: int = 0
    # kicking
    fg_distances: List[int] = field(default_factory=list)
    extra_points: int = 0
    # dst
    dst_points_allowed: int = None  # set to an int to score DST
    dst_sacks: int = 0
    dst_int: int = 0
    dst_fumble_rec: int = 0
    dst_forced_fumble: int = 0
    dst_safety: int = 0
    dst_td: int = 0


def score_offense(s: StatLine, r=FAMILY_AFFAIR_RULES) -> float:
    p, ru, rec, m = r["passing"], r["rushing"], r["receiving"], r["misc"]
    pts = 0.0
    # passing
    pts += _yards(s.pass_yards, p["yards_per_point"], p["fractional"])
    pts += s.pass_td * p["td"] + s.interceptions * p["int"] + s.pass_2pt * p["two_pt"]
    pts += cumulative_bonus(s.pass_yards, p["yardage_bonuses"])
    pts += sum(band_bonus(L, p["td_length_bands"]) for L in s.pass_td_lengths)
    # rushing
    pts += _yards(s.rush_yards, ru["yards_per_point"], ru["fractional"])
    pts += s.rush_td * ru["td"] + s.rush_2pt * ru["two_pt"]
    pts += cumulative_bonus(s.rush_yards, ru["yardage_bonuses"])
    pts += sum(band_bonus(L, ru["td_length_bands"]) for L in s.rush_td_lengths)
    # receiving
    pts += _yards(s.rec_yards, rec["yards_per_point"], rec["fractional"])
    pts += s.rec_td * rec["td"] + s.rec_2pt * rec["two_pt"]
    pts += cumulative_bonus(s.rec_yards, rec["yardage_bonuses"])
    pts += sum(band_bonus(L, rec["td_length_bands"]) for L in s.rec_td_lengths)
    pts += band_bonus(s.receptions, rec["reception_bands"])
    # if no explicit TD lengths given, allow an upstream expected long-TD bonus
    pts += s.expected_long_td_bonus
    # misc / returns
    pts += s.fumbles_lost * m["fumble_lost"]
    pts += s.kick_return_td * m["kick_return_td"] + s.punt_return_td * m["punt_return_td"]
    return round(pts, 4)


def score_kicker(s: StatLine, r=FAMILY_AFFAIR_RULES) -> float:
    k = r["kicking"]
    pts = s.extra_points * k["xp"]
    for d in s.fg_distances:
        pts += k["fg_base"] + band_bonus(d, k["fg_length_bands"])
    return round(pts, 4)


def score_dst(s: StatLine, r=FAMILY_AFFAIR_RULES) -> float:
    d = r["dst"]
    pts = (s.dst_sacks * d["sack"] + s.dst_int * d["int"] + s.dst_fumble_rec * d["fumble_rec"]
           + s.dst_forced_fumble * d["forced_fumble"] + s.dst_safety * d["safety"]
           + s.dst_td * d["td"])
    if s.dst_points_allowed is not None:
        pa = s.dst_points_allowed
        tier = d["points_allowed_over_30"]
        for max_pa, val in d["points_allowed"]:
            if pa <= max_pa:
                tier = val
                break
        pts += tier
    return round(pts, 4)


def score_line(s: StatLine, r=FAMILY_AFFAIR_RULES) -> float:
    """Total fantasy points for any stat line (offense + kicking + dst)."""
    return round(score_offense(s, r) + score_kicker(s, r) + score_dst(s, r), 4)


if __name__ == "__main__":
    qb = StatLine(pass_yards=320, pass_td=3, interceptions=1, pass_td_lengths=[45, 12, 8],
                  rush_yards=30, rush_td=1, rush_td_lengths=[5])
    print("Example QB line:", score_offense(qb), "pts")
