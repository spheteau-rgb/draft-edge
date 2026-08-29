import type { RecommendationAlternative } from "@/types";

export default function AlternativesTable({ alternatives }: { alternatives: RecommendationAlternative[] }) {
  if (alternatives.length === 0) return null;

  return (
    <section className="alternatives">
      <h2>ALTERNATIVES</h2>
      <table>
        <tbody>
          {alternatives.map((a) => (
            <tr key={a.player_id}>
              <td className="alt-name">{a.name}</td>
              <td className="alt-pos">{a.position}</td>
              <td>score {a.score.toFixed(2)}</td>
              <td>survives {Math.round(a.survival_to_next_pick * 100)}%</td>
              {a.do_not_reach_flag && <td className="alt-flag">REVIEW</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
