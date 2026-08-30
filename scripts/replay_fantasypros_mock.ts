/**
 * One-off replay of a REAL, already-completed FantasyPros Draft Wizard mock
 * draft (12 teams, snake, user at slot 4 "Mama There Goes That Man"). Every
 * pick below is transcribed from the user's screenshots of that draft. This
 * is NOT a synthetic-opponent simulation (scripts/mock_draft.ts) — every
 * non-user pick here is a REAL pick that already happened, replayed in order
 * so we can call the real getRecommendation() at each of the user's real
 * turns and see exactly what our engine would have told them.
 *
 * Run: npx tsx scripts/replay_fantasypros_mock.ts
 */

import { loadPlayerPool } from "@/lib/players";
import { getRecommendation } from "@/lib/optimizer";
import { bestLineup } from "@/lib/lineup";
import { loadModelConfig, stageForRound } from "@/lib/config";
import { computeAllReplacementValues, computeVORP, computeRosterGain } from "@/lib/vorp";
import { currentRosterGain } from "@/lib/lineup";
import { rosterCounts, evaluateConstruction } from "@/lib/roster_rules";
import { computeLeagueMarketRanks, tierUrgency, managerAffinity, runShock } from "@/lib/market";
import { survivalProb, adjustedSurvival, adpSigmaForRank } from "@/lib/survival";
import { computeCenterScale, applyZ } from "@/lib/standardize";
import { runLookahead, buildSimValuation } from "@/lib/lookahead";
import { slotForPick, roundForPick, nextUserPick, LEAGUE_TEAMS, DRAFT_ROUNDS, USER_SLOT } from "@/lib/store";
import type { PlayerRecord, DraftState, DraftPick, TeamRoster, Position } from "@/types";

/** Full per-term score breakdown (same shape as scripts/audit_terms.ts), for a
 * SPECIFIC candidate name list, given a real (not simulated) DraftState. Used
 * to see exactly why the engine ranked Skattebo over the available WRs at 3.4. */
async function debugBreakdown(state: DraftState, allPlayers: PlayerRecord[], watchNames: string[]) {
  const config = loadModelConfig();
  const stage = stageForRound(state.current_round);
  const weights = config.stage_weights[stage];
  const draftedIds = new Set(state.drafted_player_ids);
  const available = allPlayers.filter((p) => !draftedIds.has(p.player_id) && !p.is_drafted);

  const replacement = computeAllReplacementValues(available);
  const marketRanks = computeLeagueMarketRanks(available, state);
  const availableFundamentalRank = new Map<string, number>();
  [...available]
    .sort((a, b) => a.fundamental_rank - b.fundamental_rank)
    .forEach((p, idx) => availableFundamentalRank.set(p.player_id, idx + 1));
  const userRoster = state.rosters.find((r) => r.manager_slot === USER_SLOT)!;
  const userIds = new Set(userRoster.bench_player_ids);
  const userPlayers = allPlayers.filter((p) => userIds.has(p.player_id));
  const counts = rosterCounts(userPlayers);

  const p90ByPos: Record<string, number[]> = {};
  for (const p of available) (p90ByPos[p.position] ??= []).push(p.projection.weekly_p90);
  const p90Stats: Record<string, { mean: number; sd: number }> = {};
  for (const [pos, vals] of Object.entries(p90ByPos)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length);
    p90Stats[pos] = { mean, sd: Math.sqrt(v) };
  }

  const horizon =
    state.on_the_clock_slot === USER_SLOT ? nextUserPick(state.current_pick, USER_SLOT) : state.user_next_pick;
  const oppSlot =
    state.on_the_clock_slot === USER_SLOT ? slotForPick(state.current_pick + 1) : state.on_the_clock_slot;
  const pressureByPos = new Map<Position, { pressure: number; shock: number }>();

  const comps = available.map((p) => {
    const vorp = computeVORP(p, replacement[p.position] ?? 0);
    const rGain = currentRosterGain(p, userPlayers, replacement);
    const rosterGain = computeRosterGain(vorp, rGain, stage);
    const urgency = tierUrgency(p.position, available, allPlayers);
    const lmr = marketRanks.get(p.player_id)?.rank ?? p.league_market_rank;
    const ps = p90Stats[p.position];
    const construction = evaluateConstruction(p.position, counts, state.current_round);
    let pressureEntry = pressureByPos.get(p.position);
    if (!pressureEntry) {
      pressureEntry = {
        pressure: managerAffinity(oppSlot, p.position),
        shock: runShock(p.position, state.picks, state.current_round),
      };
      pressureByPos.set(p.position, pressureEntry);
    }
    const survival = adjustedSurvival(
      survivalProb(p.market.expected_pick, adpSigmaForRank(p.market.expected_pick), state.current_pick, horizon),
      pressureEntry.pressure,
      pressureEntry.shock,
      urgency
    );
    return {
      p,
      vorp,
      rosterGain,
      urgency,
      survival,
      market: lmr - (availableFundamentalRank.get(p.player_id) ?? p.fundamental_rank),
      upside: ps && ps.sd > 0 ? (p.projection.weekly_p90 - ps.mean) / ps.sd : 0,
      uncertainty: p.projection.weekly_mean > 0 ? p.projection.weekly_sd / p.projection.weekly_mean : 0,
      hardBlock: construction.hardBlock,
      needBoost: construction.needBoost,
      earlyPenalty: construction.earlyPenalty,
    };
  });

  const eligible = comps.filter((c) => !c.hardBlock);
  const pool = eligible.length ? eligible : comps;
  const cp = config.candidate_pool;
  const set = new Map<string, (typeof pool)[number]>();
  for (const c of [...pool].sort((a, b) => a.p.fundamental_rank - b.p.fundamental_rank).slice(0, cp.top_by_fundamental_value)) set.set(c.p.player_id, c);
  for (const c of [...pool].sort((a, b) => b.vorp - a.vorp).slice(0, cp.top_by_vorp)) set.set(c.p.player_id, c);
  for (const c of [...pool].sort((a, b) => b.urgency - a.urgency).slice(0, cp.top_by_urgency)) set.set(c.p.player_id, c);
  for (const c of [...pool].sort((a, b) => b.market - a.market).slice(0, cp.top_by_market_mispricing)) set.set(c.p.player_id, c);
  for (const c of [...pool].sort((a, b) => b.upside - a.upside).slice(0, cp.top_by_upside)) set.set(c.p.player_id, c);
  // Force-include the players we specifically want visibility into, even if
  // they didn't make the top-N-by-metric candidate pool cuts, so we can see
  // WHY they were excluded/demoted rather than just that they were.
  for (const name of watchNames) {
    const target = normalizeName(name);
    const found = comps.find((c) => normalizeName(c.p.name) === target);
    if (found) set.set(found.p.player_id, found);
  }
  const cands = [...set.values()];

  const cs = {
    rosterGain: computeCenterScale(cands.map((c) => c.rosterGain)),
    urgency: computeCenterScale(cands.map((c) => c.urgency)),
    market: computeCenterScale(cands.map((c) => c.market)),
    upside: computeCenterScale(cands.map((c) => c.upside)),
    uncertainty: computeCenterScale(cands.map((c) => c.uncertainty)),
    survival: computeCenterScale(cands.map((c) => c.survival)),
  };

  const scored = cands
    .map((c) => {
      const t = {
        roster: weights.roster_gain * applyZ(c.rosterGain, cs.rosterGain),
        urg: weights.urgency * applyZ(c.urgency, cs.urgency),
        mkt: weights.market * applyZ(c.market, cs.market),
        up: weights.upside * applyZ(c.upside, cs.upside),
        unc: -weights.uncertainty * applyZ(c.uncertainty, cs.uncertainty),
        surv: -weights.survival * applyZ(c.survival, cs.survival),
        need: c.needBoost,
        early: -c.earlyPenalty,
      };
      const immediate = t.roster + t.urg + t.mkt + t.up + t.unc + t.surv + t.need + t.early;
      return { c, t, immediate };
    })
    .sort((a, b) => b.immediate - a.immediate);

  const shortlist = scored.slice(0, cp.shortlist_size);
  const shortlistIds = new Set(shortlist.map((s) => s.c.p.player_id));
  const roll = await runLookahead(shortlist.map((s) => s.c.p), available, state, buildSimValuation(replacement, counts));
  const rmap = new Map(roll.map((r) => [r.candidatePlayerId, r]));
  // Mirror lib/optimizer.ts's fitAdjustedLookaheadZ: z-standardize raw
  // LookaheadValue over its own distribution first, THEN add the same
  // needBoost - earlyPenalty delta folded into ImmediateScore, in z-scale
  // units (see lib/optimizer.ts for why this must happen post-z, not pre-z).
  const laVals = shortlist.map((s) => rmap.get(s.c.p.player_id)?.lookaheadValue ?? 0);
  const laCS = computeCenterScale(laVals);
  const fitAdjustedLAZ = (s: (typeof shortlist)[number]) =>
    applyZ(rmap.get(s.c.p.player_id)?.lookaheadValue ?? 0, laCS) + s.t.need + s.t.early;
  if (process.env.DEBUG_LA) {
    for (const s of shortlist) {
      const raw = rmap.get(s.c.p.player_id)?.lookaheadValue ?? 0;
      console.log(`    LA-DEBUG ${s.c.p.name.padEnd(20)} rawLA=${raw.toFixed(3)} z=${applyZ(raw, laCS).toFixed(3)} need=${s.t.need.toFixed(3)} early=${s.t.early.toFixed(3)} adjZ=${fitAdjustedLAZ(s).toFixed(3)}`);
    }
    console.log(`    LA-DEBUG center=${laCS.center.toFixed(3)} scale=${laCS.scale.toFixed(3)}`);
  }

  console.log(`\n----- DEBUG BREAKDOWN pick ${state.current_pick} (R${state.current_round}, stage ${stage}) userCounts=${JSON.stringify(counts)}`);
  console.log("  (IMMEDIATE-score ranking over the FULL candidate-pool union, not just the top-8 lookahead shortlist; * = made the lookahead shortlist)");
  console.log("  name                  pos  roster   urg    mkt    up    unc   surv   need  early  IMMED   FundRank");
  for (const s of scored) {
    console.log(
      `  ${(s.c.p.name + (shortlistIds.has(s.c.p.player_id) ? " *" : "")).padEnd(23)} ${s.c.p.position.padEnd(4)} ` +
        [s.t.roster, s.t.urg, s.t.mkt, s.t.up, s.t.unc, s.t.surv, s.t.need, s.t.early, s.immediate]
          .map((v) => v.toFixed(2).padStart(6))
          .join(" ") +
        `   ${s.c.p.fundamental_rank}`
    );
  }

  console.log("\n  FINAL score (shortlist only, incl. lookahead):");
  const rows = shortlist.map((s) => {
    const laTerm = config.lookahead.final_score_weight * fitAdjustedLAZ(s);
    return { ...s, laTerm, final: s.immediate + laTerm };
  });
  rows.sort((a, b) => b.final - a.final);
  console.log("  name                  pos  roster   urg    mkt    up    unc   surv   need  early  IMMED   look   FINAL   P(surv)");
  for (const r of rows) {
    console.log(
      `  ${r.c.p.name.padEnd(21)} ${r.c.p.position.padEnd(4)} ` +
        [r.t.roster, r.t.urg, r.t.mkt, r.t.up, r.t.unc, r.t.surv, r.t.need, r.t.early, r.immediate, r.laTerm, r.final, r.c.survival]
          .map((v) => v.toFixed(2).padStart(6))
          .join(" ")
    );
  }
}

// pick_number -> player name as it appears in data/players.json (or a close
// spelling we alias below). USER_SLOT (4) picks are the ones we care about,
// but every pick must be present in order for state (drafted pool, roster
// counts, market/urgency signals) to be accurate at each user turn.
const NAME_ALIASES: Record<string, string> = {
  "Jeremiah Love": "Jeremiyah Love",
  "Pittsburgh Steelers DST": "Pittsburgh Steelers",
  "Houston Texans DST": "Houston Texans",
};

// IMPORTANT: this is TEAM-COLUMN order (Gladiators, Domination, Mac Diesel,
// Mama There Goes That Man (USER), Outlaws, Pack Attack, Jaguars, Comets,
// Harlem Knights, Suicide squad 84, Black and Blue Warhorses, Jacob's Ladder),
// which is how the board was transcribed from the screenshots for EVERY
// round, including even rounds. It is NOT chronological pick order — in a
// snake draft, even rounds run in the REVERSE of team-column order (team 12
// picks first in round 2, team 1 picks last). Round 1 confirms this reading:
// the user (team-column slot 4) took "Jonathan Taylor" at what should be
// pick 4 — consistent with team-column order == pick order for round 1 only.
// `pickNumberForTeam` below converts (round, teamColumnSlot) -> the correct
// chronological pick_number so the replay board is built in real draft
// order, not silently scrambled from round 2 onward.
const ROUNDS: string[][] = [
  // Round 1
  ["Jahmyr Gibbs", "Bijan Robinson", "Ja'Marr Chase", "Jonathan Taylor",
   "Christian McCaffrey", "Puka Nacua", "Jaxon Smith-Njigba", "James Cook III",
   "De'Von Achane", "Derrick Henry", "Amon-Ra St. Brown", "Omarion Hampton"],
  // Round 2
  ["Justin Jefferson", "Josh Allen", "Breece Hall", "Josh Jacobs",
   "Javonte Williams", "Jeremiah Love", "Kyren Williams", "Saquon Barkley",
   "CeeDee Lamb", "Chase Brown", "George Pickens", "Ashton Jeanty"],
  // Round 3
  ["Travis Etienne Jr", "Drake London", "Trey McBride", "Cam Skattebo",
   "A.J. Brown", "Brock Bowers", "Nico Collins", "Quinshon Judkins",
   "Bucky Irving", "Chris Olave", "Jonathon Brooks", "Malik Nabers"],
  // Round 4
  ["Jadarian Price", "Colston Loveland", "Tee Higgins", "Zay Flowers",
   "DeVonta Smith", "David Montgomery", "Bhayshul Tuten", "DJ Moore",
   "TreVeyon Henderson", "D'Andre Swift", "Garrett Wilson", "Rashee Rice"],
  // Round 5
  ["Emeka Egbuka", "Tetairoa McMillan", "Jaylen Warren", "Davante Adams",
   "Rhamondre Stevenson", "Luther Burden III", "RJ Harvey", "Ladd McConkey",
   "Tyler Warren", "Jaylen Waddle", "Jonathon Brooks", "Rico Dowdle"],
  // Round 6
  ["Isaiah Likely", "J.K. Dobbins", "Chuba Hubbard", "Jameson Williams",
   "Kyle Pitts Sr", "Kyle Monangai", "Drake Maye", "Joe Burrow",
   "Tony Pollard", "Mike Evans", "Tucker Kraft", "Harold Fannin Jr"],
  // Round 7
  ["Jayden Daniels", "Terry McLaurin", "Jalen Hurts", "Matthew Stafford",
   "Caleb Williams", "Justin Herbert", "Blake Corum", "Jordan Mason",
   "Trevor Lawrence", "Mike Evans", "Rome Odunze", "Christian Watson"],
  // Round 8
  ["Marvin Harrison Jr", "Jacory Croskey-Merritt", "DK Metcalf", "George Kittle",
   "Chris Godwin Jr", "Michael Wilson", "Jordyn Tyson", "Wan'Dale Robinson",
   "Courtland Sutton", "Carnell Tate", "Kenny Gainwell", "Parker Washington"],
  // Round 9
  ["Brian Thomas Jr", "Aaron Jones Sr", "Brian Robinson Jr", "Pittsburgh Steelers DST",
   "De'Zhaun Stribling", "Woody Marks", "Jakobi Meyers", "Alec Pierce",
   "Houston Texans DST", "Jordan Addison", "Michael Pittman Jr", "Tyler Allgeier"],
];

/** Chronological pick_number for team-column slot `team` (1-indexed) in `round` (1-indexed), 12-team snake. */
function pickNumberForTeam(round: number, team: number): number {
  return round % 2 === 1 ? (round - 1) * 12 + team : round * 12 - team + 1;
}

/** BOARD[pick_number - 1] = player name, built in true chronological order from ROUNDS (team-column layout). */
const BOARD: string[] = new Array(ROUNDS.length * 12);
ROUNDS.forEach((teamNames, roundIdx) => {
  teamNames.forEach((name, teamIdx) => {
    const pickNumber = pickNumberForTeam(roundIdx + 1, teamIdx + 1);
    BOARD[pickNumber - 1] = name;
  });
});

// User-only picks, rounds 10-14 (bench-filling; other teams' R10-14 picks
// weren't transcribed and aren't needed since the user is never on the clock
// again after 9.4 in a way that depends on them for THIS analysis — we stop
// calling getRecommendation after 9.4, the picks below just complete the
// draft state for completeness/logging).
const USER_LATE_PICKS: { pick: number; name: string }[] = [
  { pick: 105, name: "Zach Charbonnet" }, // 10.9 (round 10, slot 4 -> pick 9 in even round order... see note below)
  { pick: 124, name: "KC Concepcion" },
  { pick: 141, name: "Isiah Pacheco" },
  { pick: 148, name: "Jason Myers" },
  { pick: 165, name: "Matthew Golden" },
];

function resolveName(raw: string): string {
  return NAME_ALIASES[raw] ?? raw;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findPlayer(players: PlayerRecord[], rawName: string): PlayerRecord {
  const name = resolveName(rawName);
  const target = normalizeName(name);
  const match = players.find((p) => normalizeName(p.name) === target);
  if (!match) throw new Error(`replay: could not resolve player "${rawName}" (aliased: "${name}")`);
  return match;
}

function buildInitialRosters(): TeamRoster[] {
  const rosters: TeamRoster[] = [];
  for (let slot = 1; slot <= LEAGUE_TEAMS; slot++) {
    rosters.push({
      manager_slot: slot,
      team_name: slot === USER_SLOT ? "Mama There Goes That Man" : `Team ${slot}`,
      starters: [],
      bench_player_ids: [],
    });
  }
  return rosters;
}

function fmt(n: number): string {
  return n.toFixed(3);
}

async function main() {
  const { players } = loadPlayerPool();
  const rosters = buildInitialRosters();
  const picks: DraftPick[] = [];
  const draftedIds = new Set<string>();

  // pick_number -> resolved PlayerRecord for the whole board we transcribed
  // (rounds 1-9, all 12 teams). Rounds 10-14 are user-only and appended after
  // pick 108 isn't needed to reach 9.4, so we stop driving getRecommendation
  // there; we still log the user's real remaining picks for completeness.
  const boardPlayers = BOARD.map((n) => findPlayer(players, n));

  const USER_TURN_PICKS = [4, 21, 28, 40, 52, 64, 76, 88, 97]; // 1.4 2.9 3.4 4.9 5.4 6.9 7.4 8.9 9.4

  for (let pickNumber = 1; pickNumber <= boardPlayers.length; pickNumber++) {
    const slot = slotForPick(pickNumber);
    const round = roundForPick(pickNumber);

    const state: DraftState = {
      draft_id: "replay-fantasypros-mock",
      season: 2026,
      current_pick: pickNumber,
      current_round: round,
      on_the_clock_slot: slot,
      user_slot: USER_SLOT,
      user_next_pick: slot === USER_SLOT ? pickNumber : nextUserPick(pickNumber - 1),
      picks,
      rosters,
      drafted_player_ids: [...draftedIds],
      status: "in_progress",
      last_updated: new Date().toISOString(),
    };

    if (slot === USER_SLOT) {
      const rec = await getRecommendation(state, players);
      const actual = boardPlayers[pickNumber - 1];
      console.log(`\n=== USER PICK ${pickNumber} (round ${round}) ===`);
      console.log(`  ENGINE recommended: ${rec.recommended_player_name} (${rec.position}) score=${fmt(rec.score)} survival=${fmt(rec.survival_to_next_pick)} confidence=${rec.decision_confidence}`);
      console.log(`  reasons: ${rec.reasons.join(", ")}`);
      console.log(`  ACTUAL pick taken in the real draft: ${actual.name} (${actual.position})`);
      console.log(`  Top alternatives:`);
      for (const alt of rec.alternatives.slice(0, 5)) {
        console.log(`    - ${alt.name} (${alt.position}) score=${fmt(alt.score)} survival=${fmt(alt.survival_to_next_pick)}`);
      }
      if (pickNumber === 28) {
        await debugBreakdown(state, players, [
          "Cam Skattebo", "Drake London", "A.J. Brown", "Nico Collins", "Chris Olave", "Malik Nabers", "Kenneth Walker III",
        ]);
      }
      if (pickNumber === 76) {
        await debugBreakdown(state, players, [
          "Matthew Stafford", "Jalen Hurts", "Justin Herbert", "Trevor Lawrence", "Caleb Williams",
          "Lamar Jackson", "Dak Prescott", "Kenneth Walker III",
        ]);
      }
      if (pickNumber === 69) {
        await debugBreakdown(state, players, [
          "Jameson Williams", "J.K. Dobbins", "George Kittle", "Chuba Hubbard", "Mike Evans",
          "Tucker Kraft", "Isaiah Likely", "Kyle Pitts Sr", "Tony Pollard",
        ]);
      }
    }

    const chosen = boardPlayers[pickNumber - 1];
    draftedIds.add(chosen.player_id);
    const roster = rosters.find((r) => r.manager_slot === slot)!;
    roster.bench_player_ids.push(chosen.player_id);
    picks.push({
      pick_number: pickNumber,
      round,
      manager_slot: slot,
      player_id: chosen.player_id,
      player_name: chosen.name,
      position: chosen.position,
      nfl_team: chosen.nfl_team,
      source: "manual",
      observed_at: new Date().toISOString(),
    });
  }

  void USER_TURN_PICKS;
  void bestLineup;
  void USER_LATE_PICKS;

  console.log("\n=== Replay complete through pick 108 (round 9). ===");
  console.log("User's real final roster (per screenshots) beyond this point: 10.9 Zach Charbonnet(RB), 11.4 KC Concepcion(WR), 12.9 Isiah Pacheco(RB), 13.4 Jason Myers(K), 14.9 Matthew Golden(WR).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
