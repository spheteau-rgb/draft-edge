/**
 * Diagnostic: for a set of synthetic draft states, dump the per-term
 * contribution to FinalScore for each shortlist candidate, so we can see which
 * terms actually move the recommendation and which are inert or dominating.
 *
 * npx tsx scripts/audit_terms.ts
 */

import { loadPlayerPool } from "@/lib/players";
import { loadModelConfig, stageForRound } from "@/lib/config";
import { computeAllReplacementValues, computeVORP, computeRosterGain } from "@/lib/vorp";
import { currentRosterGain } from "@/lib/lineup";
import { rosterCounts, evaluateConstruction, mustFillPositions } from "@/lib/roster_rules";
import { computeLeagueMarketRanks, tierUrgency, managerAffinity, runShock } from "@/lib/market";
import { survivalProb, adjustedSurvival, adpSigmaForRank } from "@/lib/survival";
import { computeCenterScale, applyZ } from "@/lib/standardize";
import { runLookahead, buildSimValuation } from "@/lib/lookahead";
import { slotForPick, nextUserPick, LEAGUE_TEAMS, DRAFT_ROUNDS, USER_SLOT } from "@/lib/store";
import type { PlayerRecord, DraftState, DraftPick, Position } from "@/types";

function buildState(picks: DraftPick[], allPlayers: PlayerRecord[]): DraftState {
  const currentPick = picks.length + 1;
  const round = Math.ceil(currentPick / LEAGUE_TEAMS);
  const onClock = slotForPick(currentPick);
  const rosters = Array.from({ length: LEAGUE_TEAMS }, (_, i) => ({
    manager_slot: i + 1,
    manager_name: `M${i + 1}`,
    starters: [],
    bench_player_ids: picks.filter((p) => p.manager_slot === i + 1).map((p) => p.player_id),
  }));
  return {
    draft_id: "audit",
    league_id: "fa",
    user_slot: USER_SLOT,
    current_pick: currentPick,
    current_round: round,
    on_the_clock_slot: onClock,
    user_next_pick: onClock === USER_SLOT ? currentPick : nextUserPick(currentPick, USER_SLOT),
    picks,
    rosters,
    drafted_player_ids: picks.map((p) => p.player_id),
    updated_at: new Date().toISOString(),
    source: "manual",
  } as DraftState;
}

/** Fill picks 1..n-1 greedily by ADP so the state is realistic. */
function simulateToPick(target: number, all: PlayerRecord[]): DraftPick[] {
  const byAdp = [...all].sort((a, b) => a.market.expected_pick - b.market.expected_pick);
  const picks: DraftPick[] = [];
  for (let pk = 1; pk < target; pk++) {
    const p = byAdp[pk - 1];
    picks.push({
      pick_number: pk,
      round: Math.ceil(pk / LEAGUE_TEAMS),
      manager_slot: slotForPick(pk),
      player_id: p.player_id,
      player_name: p.name,
      position: p.position,
      source: "manual",
      timestamp: new Date().toISOString(),
    } as DraftPick);
  }
  return picks;
}

async function auditAt(pick: number, all: PlayerRecord[]) {
  const config = loadModelConfig();
  const picks = simulateToPick(pick, all);
  const state = buildState(picks, all);
  const stage = stageForRound(state.current_round);
  const weights = config.stage_weights[stage];
  const draftedIds = new Set(state.drafted_player_ids);
  const available = all.filter((p) => !draftedIds.has(p.player_id) && !p.is_drafted);

  const replacement = computeAllReplacementValues(available);
  const marketRanks = computeLeagueMarketRanks(available, state);
  const userIds = new Set(picks.filter((p) => p.manager_slot === USER_SLOT).map((p) => p.player_id));
  const userPlayers = all.filter((p) => userIds.has(p.player_id));
  const counts = rosterCounts(userPlayers);

  const p90ByPos: Record<string, number[]> = {};
  for (const p of available) (p90ByPos[p.position] ??= []).push(p.projection.weekly_p90);
  const p90Stats: Record<string, { mean: number; sd: number }> = {};
  for (const [pos, vals] of Object.entries(p90ByPos)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length);
    p90Stats[pos] = { mean, sd: Math.sqrt(v) };
  }

  // Same horizon/pressure-slot logic as lib/optimizer.ts.
  const horizon =
    state.on_the_clock_slot === USER_SLOT
      ? nextUserPick(state.current_pick, USER_SLOT)
      : state.user_next_pick;
  const oppSlot =
    state.on_the_clock_slot === USER_SLOT
      ? slotForPick(state.current_pick + 1)
      : state.on_the_clock_slot;
  const pressureByPos = new Map<Position, { pressure: number; shock: number }>();

  const comps = available.map((p) => {
    const vorp = computeVORP(p, replacement[p.position] ?? 0);
    const rGain = currentRosterGain(p, userPlayers, replacement);
    const rosterGain = computeRosterGain(vorp, rGain, stage);
    const urgency = tierUrgency(p.position, available, all);
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
      survivalProb(
        p.market.expected_pick,
        adpSigmaForRank(p.market.expected_pick),
        state.current_pick,
        horizon
      ),
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
      market: lmr - p.fundamental_rank,
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
  const lookaheadTarget = state.on_the_clock_slot === USER_SLOT ? nextUserPick(state.current_pick, USER_SLOT) : state.user_next_pick;
  const lState = { ...state, user_next_pick: lookaheadTarget };
  const roll = await runLookahead(shortlist.map((s) => s.c.p), available, lState, buildSimValuation(replacement, counts));
  const rmap = new Map(roll.map((r) => [r.candidatePlayerId, r]));
  const laVals = shortlist.map((s) => rmap.get(s.c.p.player_id)?.lookaheadValue ?? 0);
  const laCS = computeCenterScale(laVals);

  console.log(`\n===== PICK ${pick} (R${state.current_round}, stage ${stage}, onClock=${state.on_the_clock_slot}) userRoster=${JSON.stringify(counts)}`);
  console.log(`  lookahead raw values: [${laVals.map((v) => v.toFixed(2)).join(", ")}]  center=${laCS.center.toFixed(3)} MAD-scale=${laCS.scale.toExponential(2)}`);
  const respIds = new Set(shortlist.map((s) => rmap.get(s.c.p.player_id)?.expectedBestResponsePlayerId));
  console.log(`  distinct best-responses: ${respIds.size} -> ${[...respIds].map((id) => all.find((p) => p.player_id === id)?.name + "/" + all.find((p) => p.player_id === id)?.position).join(", ")}`);

  const rows = shortlist.map((s) => {
    const la = rmap.get(s.c.p.player_id)?.lookaheadValue ?? 0;
    const laZ = applyZ(la, laCS);
    const laTerm = config.lookahead.final_score_weight * laZ;
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

async function main() {
  const { players: all } = loadPlayerPool();
  console.log(`pool=${all.length}`);
  for (const pk of [4, 21, 45, 76, 100, 141, 160]) await auditAt(pk, all);
}

main();
