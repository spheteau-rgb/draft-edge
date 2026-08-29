"""Boundary tests from spec §29. Run: python3 test_scoring.py"""
from scoring import (StatLine, score_offense, score_kicker, score_dst,
                     cumulative_bonus, band_bonus, FAMILY_AFFAIR_RULES as R)

fails = []
def check(name, got, want):
    ok = abs(got - want) < 1e-6
    print(f"{'PASS' if ok else 'FAIL'}  {name:40s} got={got}  want={want}")
    if not ok: fails.append(name)

# --- passing yardage bonus (cumulative 250/300/400) ---
pb = R["passing"]["yardage_bonuses"]
for y, w in [(249,0),(250,1),(299,1),(300,4),(399,4),(400,9)]:
    check(f"pass yd bonus @{y}", cumulative_bonus(y, pb), w)

# --- rushing yardage bonus (100/150/200) ---
rb = R["rushing"]["yardage_bonuses"]
for y, w in [(99,0),(100,1),(149,1),(150,4),(199,4),(200,9)]:
    check(f"rush yd bonus @{y}", cumulative_bonus(y, rb), w)

# --- receiving yardage bonus (same) ---
recb = R["receiving"]["yardage_bonuses"]
for y, w in [(99,0),(100,1),(149,1),(150,4),(199,4),(200,9)]:
    check(f"rec yd bonus @{y}", cumulative_bonus(y, recb), w)

# --- receptions (range 4/7/10 -> 1/3/5, NON-cumulative) ---
rcb = R["receiving"]["reception_bands"]
for n, w in [(3,0),(4,1),(6,1),(7,3),(9,3),(10,5)]:
    check(f"reception bonus @{n}", band_bonus(n, rcb), w)

# --- TD length bands (30/40/50 -> 1/2/3, one TD one band) ---
tdb = R["passing"]["td_length_bands"]
for d, w in [(29,0),(30,1),(39,1),(40,2),(49,2),(50,3)]:
    check(f"TD length bonus @{d}", band_bonus(d, tdb), w)

# --- field goals: base 3 + length band ---
for d, w in [(29,3),(30,4),(39,4),(40,5),(49,5),(50,6)]:
    check(f"FG @{d}yd", score_kicker(StatLine(fg_distances=[d])), w)
check("extra point", score_kicker(StatLine(extra_points=1)), 1)

# --- base yardage (continuous) ---
check("pass 320 base", score_offense(StatLine(pass_yards=320)), 320/20 + 4)  # +250,+300 met? 320>=300 ->1+3
check("rush 100 base+bonus", score_offense(StatLine(rush_yards=100)), 10 + 1)

# --- composite QB line ---
qb = StatLine(pass_yards=320, pass_td=3, interceptions=1, pass_td_lengths=[45,12,8],
              rush_yards=30, rush_td=1, rush_td_lengths=[5])
# 16 + 18 -1 + 4(250,300) + 2(45yd TD) + 3(rush) + 6(rush TD) = 48
check("composite QB", score_offense(qb), 48.0)

# --- DST points-allowed tiers ---
for pa, w in [(0,15),(1,15),(2,12),(6,12),(7,10),(14,8),(19,6),(25,4),(30,2),(31,0),(45,0)]:
    check(f"DST PA={pa}", score_dst(StatLine(dst_points_allowed=pa)), w)
# DST with events
check("DST 3sack 1int 1ff 1fr, PA=10",
      score_dst(StatLine(dst_points_allowed=10, dst_sacks=3, dst_int=1,
                         dst_forced_fumble=1, dst_fumble_rec=1)),
      10 + 3 + 2 + 1 + 2)

print("\n" + ("ALL TESTS PASSED ✅" if not fails else f"{len(fails)} FAILURES ❌: {fails}"))
