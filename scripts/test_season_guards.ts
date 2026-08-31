/**
 * docs/10 §5 Slice 2a acceptance — the retention/add-quality guards.
 *
 * Synthetic rosters, not the Week 1 snapshot: each case has to isolate one
 * guard, and real data always trips several at once.
 *
 * Run: npx tsx scripts/test_season_guards.ts
 */

import type { PlayerRecord, Position } from "@/types";
import { evaluateMoves, marginalRosValues } from "@/lib/season/moves";
import { streamableReplacement, type RosterEntry } from "@/lib/season/value";
import type { InjuryTag } from "@/lib/season/snapshot";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

let seq = 0;
function player(
  name: string,
  position: Position,
  weeklyMean: number,
  opts: { bye?: number | null; p90?: number } = {}
): PlayerRecord {
  const sd = weeklyMean * 0.35;
  return {
    player_id: `syn-${seq++}`,
    name,
    position,
    nfl_team: "FA",
    external_ids: {},
    projection: {
      season_projection_points: weeklyMean * 17,
      weekly_mean: weeklyMean,
      weekly_sd: sd,
      weekly_p10: weeklyMean - 1.28 * sd,
      weekly_p25: weeklyMean - 0.67 * sd,
      weekly_p75: weeklyMean + 0.67 * sd,
      weekly_p90: opts.p90 ?? weeklyMean + 1.28 * sd,
      prob_20plus: 0,
      prob_25plus: 0,
      prob_30plus: 0,
      expected_games: 17,
      injury_penalty: 0,
      risk_adjusted_points: weeklyMean * 17,
      projection_source_count: 1,
      projection_disagreement: null,
      source_timestamp: "2026-08-30T00:00:00Z",
    },
    market: { adp_cbs: null, adp_fantasypros: null, adp_other: null, expected_pick: 999, adp_sigma: 18 },
    fundamental_rank: 999,
    league_market_rank: 999,
    vorp: null,
    bye_week: opts.bye ?? null,
    injury_status: null,
    news_age_minutes: null,
    data_freshness: "GREEN" as PlayerRecord["data_freshness"],
    is_drafted: false,
    drafted_by_slot: null,
  };
}

const entry = (p: PlayerRecord, injury?: InjuryTag): RosterEntry => ({ player: p, injury });

/** A legal 14-man roster: fills every starter slot so nothing collapses for unrelated reasons. */
function baseRoster(): RosterEntry[] {
  return [
    entry(player("QB1", "QB", 18)),
    entry(player("RB1", "RB", 15)),
    entry(player("RB2", "RB", 13)),
    entry(player("RB3", "RB", 9)),
    entry(player("WR1", "WR", 14)),
    entry(player("WR2", "WR", 12)),
    entry(player("WR3", "WR", 10)),
    entry(player("WR4", "WR", 7)),
    entry(player("WR5", "WR", 6)),
    entry(player("TE1", "TE", 9)),
    entry(player("TE2", "TE", 5)),
    entry(player("K1", "K", 8)),
    entry(player("DST1", "DST", 7)),
    entry(player("RB4", "RB", 4)),
  ];
}

const CURRENT_WEEK = 1;

// ---------------------------------------------------------------------------
// 1. A hurt stud survives a streamer who is better THIS week.
//    The single most expensive waiver error is dropping a top asset during the
//    weeks he is unavailable, when a replacement-level body outscores him for
//    exactly as long as the designation lasts.
// ---------------------------------------------------------------------------
{
  const roster = baseRoster();
  const stud = entry(player("Hurt Stud RB", "RB", 20), "IR");
  roster[3] = stud; // replaces RB3
  const streamer = player("Hot Streamer RB", "RB", 11);
  const fas = [entry(streamer), entry(player("FA WR", "WR", 5)), entry(player("FA K", "K", 6)), entry(player("FA DST", "DST", 5))];

  const res = evaluateMoves(roster, fas, CURRENT_WEEK, streamableReplacement(fas), "free");
  const hold = res.playerValueRanking.find((p) => p.name === "Hurt Stud RB");
  check(
    "INJURED_STUD is attached to a hurt top-9 asset on the holds list",
    !!hold && hold.guards.includes("INJURED_STUD"),
    hold ? `guards=${hold.guards.join("/")}` : "not on holds list"
  );
  check(
    "the hurt stud is never the recommended drop",
    !res.recommended.some((c) => c.dropName === "Hurt Stud RB")
  );
}

// ---------------------------------------------------------------------------
// 2. A bye-colliding QB2 loses to a lower-projected QB2 with a usable bye.
//    Raw season points say take the better player; ROSValue says the only weeks
//    a QB2 is worth anything are the weeks your QB1 cannot play.
// ---------------------------------------------------------------------------
{
  const roster = baseRoster();
  roster[0] = entry(player("QB1", "QB", 18, { bye: 11 }));
  const collide = player("Better QB2", "QB", 16, { bye: 11 });
  const usable = player("Worse QB2", "QB", 15, { bye: 8 });
  // No QB in the FA pool: without one, the empty week-11 QB slot is genuinely
  // unfillable, which is the only world where rostering a QB2 can pay.
  const fas = [entry(collide), entry(usable)];

  const res = evaluateMoves(roster, fas, CURRENT_WEEK, {}, "free");
  const better = res.recommended.concat(res.rejected).find((c) => c.addName === "Better QB2");
  const worse = res.recommended.concat(res.rejected).find((c) => c.addName === "Worse QB2");

  check(
    "the bye-colliding QB2 is flagged BYE_COLLISION",
    !!better && better.addGuards.includes("BYE_COLLISION"),
    better ? better.addGuards.join("/") : "missing"
  );
  check(
    "the lower-projected QB2 with a usable bye scores higher ΔROS",
    !!better && !!worse && worse.deltaRos > better.deltaRos,
    better && worse ? `worse=${worse.deltaRos.toFixed(1)} better=${better.deltaRos.toFixed(1)}` : "missing"
  );
  check(
    "the recommended QB add is the one whose bye actually covers",
    res.recommended[0]?.addName === "Worse QB2",
    res.recommended[0]?.addName ?? "none"
  );
}

// ---------------------------------------------------------------------------
// 3. A WR6 who can never crack the lineup is rejected for NO_LINEUP_PATH.
// ---------------------------------------------------------------------------
{
  const roster = baseRoster();
  const wr6 = player("Depth WR6", "WR", 5.5);
  const fas = [entry(wr6), entry(player("FA K", "K", 6)), entry(player("FA DST", "DST", 5))];

  const res = evaluateMoves(roster, fas, CURRENT_WEEK, streamableReplacement(fas), "free");
  const wr6Pairings = [...res.recommended, ...res.rejected].filter((c) => c.addName === "Depth WR6");
  check(
    "a WR6 with no path to a starting slot is blocked",
    wr6Pairings.length > 0 && wr6Pairings.every((c) => c.blocked),
    `${wr6Pairings.length} pairings`
  );
  check(
    "NO_LINEUP_PATH is the stated reason when he never starts",
    wr6Pairings.some((c) => c.weeksStarted.length === 0 && c.addGuards.includes("NO_LINEUP_PATH"))
  );
}

// ---------------------------------------------------------------------------
// 4. Streamable empty slots: a free-agent-equivalent add gains nothing.
//    This is the anti-hoarding mechanism, and the reason "grab a backup QB now"
//    is usually wrong in a league with an unrestricted waiver window.
// ---------------------------------------------------------------------------
{
  const roster = baseRoster();
  roster[0] = entry(player("QB1", "QB", 18, { bye: 11 }));
  const fas = [
    entry(player("FA QB A", "QB", 16, { bye: 8 })),
    entry(player("FA QB B", "QB", 15, { bye: 9 })),
  ];
  const res = evaluateMoves(roster, fas, CURRENT_WEEK, streamableReplacement(fas), "free");
  const best = [...res.recommended, ...res.rejected].sort((a, b) => b.deltaRos - a.deltaRos)[0];
  check(
    "rostering a QB2 no better than the streamable QB gains ~0",
    !!best && best.deltaRos < 3,
    best ? `ΔROS=${best.deltaRos.toFixed(2)}` : "missing"
  );
  check("and therefore nothing is recommended", res.recommended.length === 0);
}

// ---------------------------------------------------------------------------
// 5. Marginal value is lineup value, not raw projection: a strong bench player
//    behind two stronger starters is worth less than a weak lone kicker.
// ---------------------------------------------------------------------------
{
  const roster = baseRoster();
  const marginal = marginalRosValues(roster, CURRENT_WEEK, { RB: 6, WR: 6, TE: 4, QB: 10, K: 7, DST: 6 });
  const wr5 = roster.find((e) => e.player.name === "WR5")!.player.player_id;
  const k1 = roster.find((e) => e.player.name === "K1")!.player.player_id;
  check(
    "a buried WR5 has lower marginal ROS than the only K",
    (marginal.get(wr5) ?? 0) < (marginal.get(k1) ?? 0),
    `WR5=${marginal.get(wr5)?.toFixed(1)} K1=${marginal.get(k1)?.toFixed(1)}`
  );
}

console.log(failures === 0 ? "\nguard suite green" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
