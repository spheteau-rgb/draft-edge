import type { Recommendation } from "@/types";
import { REASON_TEXT } from "@/lib/reasonText";
import FreshnessBadge from "@/components/FreshnessBadge";

export default function PickCard({ rec }: { rec: Recommendation }) {
  if (!rec.recommended_player_id) {
    return (
      <section className="pick-card pick-card-empty">
        <p>No recommendation available — draft may be complete, or the player pool is empty.</p>
      </section>
    );
  }

  const survivalPct = Math.round(rec.survival_to_next_pick * 100);

  return (
    <section className="pick-card">
      <div className="pick-card-top">
        <span className="pick-label">
          {rec.is_user_on_the_clock
            ? `YOUR PICK NOW — #${rec.pick_number}`
            : `YOUR NEXT PICK — #${rec.pick_number} (${rec.picks_until_your_turn} pick${rec.picks_until_your_turn === 1 ? "" : "s"} away)`}
        </span>
        <FreshnessBadge freshness={rec.data_freshness} />
      </div>
      {!rec.is_user_on_the_clock && (
        <p className="pick-preview-note">
          Preview — this is who we&apos;d take if your pick were right now; survival % below accounts for the picks in between.
        </p>
      )}

      {rec.do_not_reach_flag && (
        <div className="do-not-reach-badge">MODEL DISAGREEMENT — REVIEW</div>
      )}

      <h1 className="pick-name">
        {rec.recommended_player_name} <span className="pick-pos">({rec.position})</span>
      </h1>

      <div className="pick-meta">
        <span className={`confidence confidence-${rec.decision_confidence.replace(" ", "-").toLowerCase()}`}>
          {rec.decision_confidence}
        </span>
        <span className="rank-line">
          Fundamental #{rec.fundamental_rank} · Market #{rec.league_market_rank}
        </span>
      </div>

      {rec.reasons.length > 0 && (
        <div className="why-block">
          <h2>WHY</h2>
          <ul>
            {rec.reasons.map((r) => (
              <li key={r}>{REASON_TEXT[r] ?? r}</li>
            ))}
          </ul>
        </div>
      )}

      {rec.community_note && (
        <div className="community-note-block">
          <h2>FROM THE WEB — {rec.community_note.tag.replace(/_/g, " ")}</h2>
          <p>{rec.community_note.note}</p>
        </div>
      )}

      <div className="consequence-block">
        <p>
          <strong>{survivalPct}%</strong> chance he survives to your next pick
        </p>
        {rec.expected_alternative_if_wait && (
          <p>
            If you wait, expected alternative: <strong>{rec.expected_alternative_if_wait.name}</strong>
          </p>
        )}
        {rec.edge_vs_runner_up !== null && (
          <p>
            Edge vs next-best now: <strong>+{rec.edge_vs_runner_up.toFixed(2)}</strong>
          </p>
        )}
      </div>
    </section>
  );
}
