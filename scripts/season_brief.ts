/** Print the weekly brief for a snapshot: npx tsx scripts/season_brief.ts 2026 1 [free|faab] */

import "./loadEnv";
import { buildBrief, type Brief } from "@/lib/season/brief";
import type { Window } from "@/lib/season/moves";

const season = Number(process.argv[2] ?? 2026);
const week = Number(process.argv[3] ?? 1);
const window = (process.argv[4] ?? "free") as Window;

const f = (n: number) => n.toFixed(1);

function render(brief: Brief): void {
  console.log(`\n=== WEEK ${brief.week} BRIEF (${window} window) ===`);
  if (brief.unresolved.length > 0) {
    console.log(`\n!! UNRESOLVED ROWS (${brief.unresolved.length}) — brief is partial`);
    for (const u of brief.unresolved) console.log(`   ${u.row.name} ${u.row.position} ${u.row.nfl_team}`);
  }

  if (brief.missingReplacement.length > 0) {
    console.log(
      `\n!! NO FREE AGENTS CAPTURED AT: ${brief.missingReplacement.join(", ")}` +
        `\n   Their empty slots price at zero, so marginal values at those positions are inflated.` +
        `\n   Fix: one Add Player screenshot per missing position.`
    );
  }

  const s = brief.startSit;
  console.log(`\n--- START/SIT ---`);
  console.log(
    `me ${f(s.myMean)} ±${f(s.mySd)}  vs opp ${f(s.opponentMean)} ±${f(s.opponentSd)}` +
      `   win ${(s.winProbability * 100).toFixed(1)}%  (as set: ${(s.winProbabilityIfUnchanged * 100).toFixed(1)}%)` +
      `   ${s.isUnderdog ? "UNDERDOG → take ceiling" : "FAVOURITE → take floor"}`
  );
  if (s.changes.length === 0) console.log("lineup is already optimal — no changes");
  for (const c of s.changes) {
    console.log(`  ${c.slot}: START ${c.in.name} (${f(c.in.mean)}) ${c.out ? `for ${c.out.name} (${f(c.out.mean)})` : ""}`);
  }
  console.log("  optimal:", s.optimal.map((a) => `${a.slot}=${a.name}`).join(" "));

  console.log(`\n--- MOVES (threshold ΔROS ≥ ${brief.moves.threshold}) ---`);
  if (brief.moves.recommended.length === 0) console.log("no move clears the bar — stand pat");
  for (const m of brief.moves.recommended.slice(0, 5)) {
    console.log(
      `  ADD ${m.addName} (${m.addPosition}, bye ${m.addBye ?? "-"})  DROP ${m.dropName} (${m.dropPosition})` +
        `  ΔROS ${f(m.deltaRos)}  starts wk [${m.weeksStarted.join(",")}]` +
        `${m.addGuards.length ? `  add:${m.addGuards.join("/")}` : ""}` +
        `${m.dropGuards.length ? `  drop:${m.dropGuards.join("/")}` : ""}`
    );
  }
  if (brief.runnerUp) {
    const r = brief.runnerUp;
    console.log(`  runner-up: ADD ${r.addName}/DROP ${r.dropName} ΔROS ${f(r.deltaRos)} ${[...r.addGuards, ...r.dropGuards].join("/")}`);
  }

  console.log(`\n--- REJECTED (guard fired) ---`);
  for (const m of brief.moves.rejected.slice(0, 6)) {
    console.log(
      `  ADD ${m.addName} / DROP ${m.dropName}  ΔROS ${f(m.deltaRos)}  ` +
        [...m.addGuards, ...m.dropGuards].join("/")
    );
  }

  console.log(`\n--- HOLDS (marginal ROS value) ---`);
  for (const p of brief.moves.playerValueRanking) {
    console.log(`  ${p.name.padEnd(22)} ${p.position.padEnd(4)} ${f(p.marginalRos).padStart(7)}  ${p.guards.join("/")}`);
  }

  console.log(`\n--- LINEUP HOLES AHEAD ---`);
  if (brief.byeAlerts.length === 0) console.log("none");
  for (const b of brief.byeAlerts) console.log(`  week ${b.week}: ${b.emptySlots.join(", ")}`);
  console.log();
}

buildBrief(season, week, window)
  .then((brief) => {
    render(brief);
    // An open Redis socket would otherwise keep this CLI alive after the output lands.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
