"use client";

/**
 * The weekly brief (docs/10 §5 Slice 2b). Two questions, in the order you act on
 * them: set the lineup, then work the wire. Everything else on the page exists
 * to make an answer checkable — what each move beat, which guard stopped a drop,
 * and which future weeks still have a hole.
 */
import { useCallback, useEffect, useState } from "react";
import type { Brief } from "@/lib/season/brief";
import { fetchBrief } from "@/lib/apiClient";
import SnapshotDrop from "@/components/SnapshotDrop";

const SEASON = 2026;

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function n1(x: number): string {
  return x.toFixed(1);
}

export default function WeekBrief() {
  const [week, setWeek] = useState(1);
  const [window, setWindow] = useState<"free" | "faab">("free");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDrop, setShowDrop] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBrief(await fetchBrief(SEASON, week, window));
      setError(null);
    } catch {
      setBrief(null);
      setError(`No brief for week ${week}. Drop this week's screenshots in and re-run the transcription.`);
    } finally {
      setLoading(false);
    }
  }, [week, window]);

  useEffect(() => {
    load();
  }, [load]);

  const s = brief?.startSit;
  const moves = brief?.moves;

  return (
    <main className="app-main brief-main">
      <header className="brief-header">
        <h1>Week {week}</h1>
        <div className="brief-controls">
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-label="Week">
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>{`Week ${w}`}</option>
            ))}
          </select>
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as "free" | "faab")}
            aria-label="Waiver window"
          >
            <option value="free">Free window</option>
            <option value="faab">FAAB claim</option>
          </select>
          <button type="button" onClick={() => setShowDrop((v) => !v)}>
            {showDrop ? "Hide upload" : "Add screenshots"}
          </button>
        </div>
      </header>

      {loading && <p>Building brief…</p>}
      {error && <p className="conn-banner">{error}</p>}

      {/* Opened on demand, and forced open when there is nothing to show — an
          empty week is exactly when the upload is the only useful control. */}
      {(showDrop || (!loading && !brief)) && (
        <SnapshotDrop season={SEASON} week={week} onSaved={load} />
      )}

      {brief && !loading && (
        <>
          {brief.unresolved.length > 0 && (
            <p className="conn-banner">
              {brief.unresolved.length} row(s) did not match a player — this brief is partial:{" "}
              {brief.unresolved.map((u) => u.row.name).join(", ")}
            </p>
          )}
          {brief.missingReplacement.length > 0 && (
            <p className="conn-banner">
              No free agents captured at {brief.missingReplacement.join(", ")}. Values at those
              positions are inflated — add one Add Player screenshot per missing position.
            </p>
          )}

          <section className="brief-section">
            <h2>Start / sit</h2>
            {s && (
              <>
                <p className="brief-headline">
                  {pct(s.winProbability)} to win
                  {s.changes.length > 0 && <> · {pct(s.winProbabilityIfUnchanged)} if you leave it</>}
                </p>
                <p className="brief-sub">
                  You {n1(s.myMean)} ± {n1(s.mySd)} · Them {n1(s.opponentMean)} ± {n1(s.opponentSd)} ·{" "}
                  {s.isUnderdog ? "underdog — take ceiling" : "favourite — take floor"}
                </p>
                {s.changes.length === 0 ? (
                  <p className="brief-ok">Lineup is already optimal. Nothing to change.</p>
                ) : (
                  <ul className="brief-list">
                    {s.changes.map((c) => (
                      <li key={c.in.player_id}>
                        <strong>{c.slot}</strong>: start {c.in.name} ({n1(c.in.mean)})
                        {c.out && <> instead of {c.out.name} ({n1(c.out.mean)})</>}
                      </li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary>Full optimal lineup</summary>
                  <ul className="brief-list">
                    {s.optimal.map((a) => (
                      <li key={a.player_id}>
                        <strong>{a.slot}</strong> {a.name} — {n1(a.mean)} ± {n1(a.sd)}
                        {a.injury && <> ({a.injury})</>}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </section>

          <section className="brief-section">
            <h2>Add / drop</h2>
            {moves && moves.recommended.length === 0 ? (
              <p className="brief-ok">
                Nothing clears the bar (ΔROS ≥ {moves.threshold}). Stand pat — every available add is
                worth less than what you would give up.
              </p>
            ) : (
              <ul className="brief-list">
                {moves?.recommended.slice(0, 3).map((m) => (
                  <li key={`${m.addId}-${m.dropId}`}>
                    <strong>Add {m.addName}</strong> ({m.addPosition}) · drop {m.dropName} (
                    {m.dropPosition}) · +{n1(m.deltaRos)} ROS · starts{" "}
                    {m.weeksStarted.length} week(s)
                    {m.dropGuards.length > 0 && (
                      <em className="brief-guard"> heads up: {m.dropGuards.join(", ")}</em>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {brief.runnerUp && (
              <p className="brief-sub">
                Runner-up: {brief.runnerUp.addName} for {brief.runnerUp.dropName} (
                {n1(brief.runnerUp.deltaRos)} ROS
                {[...brief.runnerUp.addGuards, ...brief.runnerUp.dropGuards].length > 0 &&
                  ` — ${[...brief.runnerUp.addGuards, ...brief.runnerUp.dropGuards].join(", ")}`}
                )
              </p>
            )}
          </section>

          <section className="brief-section">
            <h2>Holds</h2>
            <p className="brief-sub">Marginal value = what the roster loses without him.</p>
            <ul className="brief-list">
              {moves?.playerValueRanking.map((p) => (
                <li key={p.player_id}>
                  {p.name} ({p.position}) — {n1(p.marginalRos)}
                  {p.guards.length > 0 && <em className="brief-guard"> {p.guards.join(", ")}</em>}
                </li>
              ))}
            </ul>
          </section>

          {brief.byeAlerts.length > 0 && (
            <section className="brief-section">
              <h2>Holes ahead</h2>
              <ul className="brief-list">
                {brief.byeAlerts.map((b) => (
                  <li key={b.week}>
                    Week {b.week}: {b.emptySlots.join(", ")} unfilled
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="brief-section">
            <summary>Rejected moves ({moves?.rejected.length ?? 0})</summary>
            <ul className="brief-list">
              {moves?.rejected.map((m) => (
                <li key={`r-${m.addId}-${m.dropId}`}>
                  {m.addName} for {m.dropName} — {n1(m.deltaRos)} ROS ·{" "}
                  {[...m.addGuards, ...m.dropGuards].join(", ")}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </main>
  );
}
