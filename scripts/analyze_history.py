"""Parse data/history_raw/*.txt into structured picks and report room tendencies."""
import re, json, statistics as st
from pathlib import Path
from collections import defaultdict, Counter

RAW = Path(__file__).resolve().parent.parent / "data" / "history_raw"
POS = {"QB", "RB", "WR", "TE", "K", "DST"}
YEARS = [2021, 2022, 2023, 2024, 2025]


def parse():
    picks = []
    for year in YEARS:
        team = None
        for line in (RAW / f"{year}.txt").read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("@"):
                team = line[1:]
                continue
            m = re.match(r"^(\d+)/(\d+)\s+(\*?)(.+)$", line)
            rnd, slot_pick, auto, rest = int(m.group(1)), int(m.group(2)), bool(m.group(3)), m.group(4)
            name, pos = rest.rsplit(" ", 1)
            if pos not in POS:
                continue  # skipped pick
            picks.append({
                "year": year, "round": rnd, "team": team, "auto": auto,
                "player": name, "pos": pos,
                "overall": (rnd - 1) * 12 + slot_pick,
            })
    return picks


def bar(n, scale=1):
    return "#" * int(round(n * scale))


picks = parse()
print(f"parsed {len(picks)} picks across {len(YEARS)} drafts\n")

# ---------- 1. positional draft curve: what share of each round is each position ----------
print("=" * 78)
print("1. POSITION MIX BY ROUND (all 5 drafts pooled, count out of 60 picks/round)")
print("=" * 78)
print(f"{'Rd':>3} | {'QB':>4} {'RB':>4} {'WR':>4} {'TE':>4} {'K':>4} {'DST':>4}")
for r in range(1, 15):
    c = Counter(p["pos"] for p in picks if p["round"] == r)
    print(f"{r:>3} | " + " ".join(f"{c.get(k,0):>4}" for k in ["QB", "RB", "WR", "TE", "K", "DST"]))

# ---------- 2. when each position comes off the board ----------
print()
print("=" * 78)
print("2. POSITIONAL ADP WITHIN THE ROOM (overall pick number, pooled)")
print("=" * 78)
for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
    # rank-within-position per year, then median overall pick for each rank
    per_year = defaultdict(list)
    for y in YEARS:
        ps = sorted([p for p in picks if p["year"] == y and p["pos"] == pos], key=lambda x: x["overall"])
        for i, p in enumerate(ps, 1):
            per_year[i].append(p["overall"])
    line = []
    for rank in range(1, 13):
        if rank in per_year and len(per_year[rank]) >= 3:
            line.append(f"{pos}{rank}={st.median(per_year[rank]):.0f}")
    print(f"  {pos:>3}: " + "  ".join(line[:12]))

# ---------- 3. K / DST timing ----------
print()
print("=" * 78)
print("3. K & DST TIMING (round of each pick)")
print("=" * 78)
for pos in ["K", "DST"]:
    rounds = sorted(p["round"] for p in picks if p["pos"] == pos)
    c = Counter(rounds)
    print(f"  {pos}: n={len(rounds)} min={min(rounds)} p10={rounds[len(rounds)//10]} "
          f"median={st.median(rounds):.1f} max={max(rounds)}")
    print(f"      by round: " + " ".join(f"R{r}:{c[r]}" for r in range(1, 15) if c[r]))
    # first one off the board each year
    firsts = {y: min(p["round"] for p in picks if p["pos"] == pos and p["year"] == y) for y in YEARS}
    print(f"      first {pos} off board by year: {firsts}")

# ---------- 4. how many of each position does a team end up with ----------
print()
print("=" * 78)
print("4. ROSTER COMPOSITION PER TEAM (14 picks). distribution across 60 team-seasons")
print("=" * 78)
comp = defaultdict(Counter)
for p in picks:
    comp[(p["year"], p["team"])][p["pos"]] += 1
for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
    vals = sorted(c.get(pos, 0) for c in comp.values())
    print(f"  {pos:>3}: min={vals[0]} p25={vals[len(vals)//4]} median={st.median(vals):.1f} "
          f"p75={vals[3*len(vals)//4]} max={vals[-1]}   dist={dict(sorted(Counter(vals).items()))}")

# ---------- 5. multi-QB / multi-TE / multi-DST behavior ----------
print()
print("=" * 78)
print("5. HOW OFTEN DOES A TEAM ROSTER 2+ AT A 1-STARTER POSITION?")
print("=" * 78)
n = len(comp)
for pos in ["QB", "TE", "K", "DST"]:
    two_plus = sum(1 for c in comp.values() if c.get(pos, 0) >= 2)
    three_plus = sum(1 for c in comp.values() if c.get(pos, 0) >= 3)
    zero = sum(1 for c in comp.values() if c.get(pos, 0) == 0)
    print(f"  {pos:>3}: 0={zero}/{n}  2+={two_plus}/{n} ({100*two_plus/n:.0f}%)  3+={three_plus}/{n} ({100*three_plus/n:.0f}%)")

# ---------- 6. autopick prevalence ----------
print()
print("=" * 78)
print("6. AUTOPICK BEHAVIOR (asterisk = CBS autopick)")
print("=" * 78)
auto_by_team = defaultdict(lambda: [0, 0])
for p in picks:
    k = p["team"]
    auto_by_team[k][1] += 1
    if p["auto"]:
        auto_by_team[k][0] += 1
for team, (a, t) in sorted(auto_by_team.items(), key=lambda x: -x[1][0] / x[1][1]):
    if a:
        yrs = sorted({p["year"] for p in picks if p["team"] == team and p["auto"]})
        print(f"  {team:<28} {a:>3}/{t} autopicked ({100*a/t:>4.0f}%)  years={yrs}")
tot_auto = sum(1 for p in picks if p["auto"])
print(f"  TOTAL: {tot_auto}/{len(picks)} = {100*tot_auto/len(picks):.1f}% of all picks are autopicks")

# ---------- 7. user's own team ----------
print()
print("=" * 78)
print("7. MAMA THERE GOES THAT MAN — position taken at each round")
print("=" * 78)
me = "Mama There Goes That Man"
print(f"{'Rd':>3} | " + " ".join(f"{y:>5}" for y in YEARS))
for r in range(1, 15):
    row = []
    for y in YEARS:
        hit = [p for p in picks if p["year"] == y and p["team"] == me and p["round"] == r]
        row.append(hit[0]["pos"] if hit else "-")
    print(f"{r:>3} | " + " ".join(f"{v:>5}" for v in row))
for y in YEARS:
    c = Counter(p["pos"] for p in picks if p["year"] == y and p["team"] == me)
    print(f"  {y}: {dict(c)}")

# ---------- 8. positional runs ----------
print()
print("=" * 78)
print("8. POSITION RUNS (max consecutive same-pos picks, and run frequency)")
print("=" * 78)
for y in YEARS:
    seq = [p["pos"] for p in sorted([p for p in picks if p["year"] == y], key=lambda x: x["overall"])]
    runs = []
    cur, cnt = seq[0], 1
    for s in seq[1:]:
        if s == cur:
            cnt += 1
        else:
            runs.append((cur, cnt)); cur, cnt = s, 1
    runs.append((cur, cnt))
    big = [f"{p}x{c}@" for p, c in runs if c >= 4]
    print(f"  {y}: longest={max(runs, key=lambda x: x[1])}  runs>=4: {Counter(p for p,c in runs if c>=4)}")
# window-based: in any rolling 12-pick window, max same-position count
print("\n  Rolling 12-pick window, max count of one position (pooled):")
for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
    best = 0
    for y in YEARS:
        seq = [p["pos"] for p in sorted([p for p in picks if p["year"] == y], key=lambda x: x["overall"])]
        for i in range(len(seq) - 12):
            best = max(best, seq[i:i+12].count(pos))
    print(f"    {pos:>3}: max {best}/12")

# ---------- 9. manager position-order fingerprints ----------
print()
print("=" * 78)
print("9. MANAGER FINGERPRINT — median round they take QB1 / TE1 / first K / first DST")
print("=" * 78)
print(f"{'Manager':<28} {'QB1':>5} {'TE1':>5} {'K':>5} {'DST':>5}  {'RB':>4} {'WR':>4}  auto%")
teams = sorted({p["team"] for p in picks})
for t in teams:
    row = {}
    for pos in ["QB", "TE", "K", "DST"]:
        rs = [min([p["round"] for p in picks if p["team"] == t and p["year"] == y and p["pos"] == pos] or [99])
              for y in YEARS]
        rs = [r for r in rs if r < 99]
        row[pos] = st.median(rs) if rs else float("nan")
    nrb = st.median([sum(1 for p in picks if p["team"] == t and p["year"] == y and p["pos"] == "RB") for y in YEARS])
    nwr = st.median([sum(1 for p in picks if p["team"] == t and p["year"] == y and p["pos"] == "WR") for y in YEARS])
    a, tot = auto_by_team[t]
    print(f"{t:<28} {row['QB']:>5.1f} {row['TE']:>5.1f} {row['K']:>5.1f} {row['DST']:>5.1f}  "
          f"{nrb:>4.0f} {nwr:>4.0f}  {100*a/tot:>4.0f}%")

# ---------- 10. RB/WR balance by round ----------
print()
print("=" * 78)
print("10. FIRST 3 ROUNDS: what the room actually takes (36 picks/yr)")
print("=" * 78)
for y in YEARS:
    c = Counter(p["pos"] for p in picks if p["year"] == y and p["round"] <= 3)
    print(f"  {y}: {dict(c)}")
c = Counter(p["pos"] for p in picks if p["round"] <= 3)
print(f"  POOLED R1-3 (180 picks): {dict(c)}")
c = Counter(p["pos"] for p in picks if p["round"] <= 2)
print(f"  POOLED R1-2 (120 picks): {dict(c)}")

# ---------- emit machine-readable ----------
out = Path(__file__).resolve().parent.parent / "data" / "family_affair_history_full.json"
out.write_text(json.dumps({"_note": "5 complete 14-round Family Affair drafts, 2021-2025.",
                           "picks": picks}, indent=1))
print(f"\nwrote {out}")
