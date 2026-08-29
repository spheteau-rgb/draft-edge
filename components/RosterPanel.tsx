import type { DraftState, PlayerRecord } from "@/types";

export default function RosterPanel({
  state,
  players,
}: {
  state: DraftState;
  players: PlayerRecord[];
}) {
  const roster = state.rosters.find((r) => r.manager_slot === state.user_slot);
  if (!roster) return null;

  const nameFor = (id: string | null) => (id ? players.find((p) => p.player_id === id)?.name ?? id : "—");

  return (
    <aside className="roster-panel">
      <h2>YOUR ROSTER — {roster.team_name}</h2>
      <ul className="roster-starters">
        {roster.starters.map((s, i) => (
          <li key={`${s.slot}-${i}`}>
            <span className="roster-slot">{s.slot}</span>
            <span className="roster-player">{nameFor(s.player_id)}</span>
          </li>
        ))}
      </ul>
      {roster.bench_player_ids.length > 0 && (
        <>
          <h3>Bench</h3>
          <ul className="roster-bench">
            {roster.bench_player_ids.map((id) => (
              <li key={id}>{nameFor(id)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="roster-meta">
        Your next pick: <strong>#{state.user_next_pick}</strong>
      </p>
    </aside>
  );
}
