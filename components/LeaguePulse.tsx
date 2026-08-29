import type { DraftState } from "@/types";

/**
 * docs/06: "League Pulse = 3 signals max; manager detail is expandable, not
 * default." Simple client-safe read of the last 12 picks' position mix (the
 * full run-shock/manager-affinity math in lib/market.ts is server-only and
 * already feeds the recommendation itself — this panel is just a glanceable
 * summary of what the room has been doing, not a second model).
 */
export default function LeaguePulse({ state }: { state: DraftState }) {
  const recent = state.picks.slice(-12);
  if (recent.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of recent) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  const top3 = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <section className="league-pulse">
      <h2>LEAGUE PULSE</h2>
      <p>
        {top3.map(([pos, count]) => `${pos} ×${count}`).join(" · ")}
        <span className="league-pulse-window"> (last {recent.length} picks)</span>
      </p>
    </section>
  );
}
