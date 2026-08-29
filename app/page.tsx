"use client";

/**
 * The one-glance draft screen (docs/06). Polls /api/recommendation +
 * /api/draft/state + /api/players every 3s (docs/06: "polling ... every
 * 2-3s is plenty") so any device shows the same live state, and a pick
 * entered on one device shows up on all others within a few seconds
 * (CLAUDE.md multi-device requirement). All fetches go through
 * lib/apiClient.ts; this file is pure orchestration + layout, no fetch calls
 * inline (project code-quality rule).
 */
import { useCallback, useEffect, useState } from "react";
import type { DraftState, PlayerRecord, Recommendation } from "@/types";
import { fetchDraftState, fetchPlayers, fetchRecommendation } from "@/lib/apiClient";
import PickCard from "@/components/PickCard";
import AlternativesTable from "@/components/AlternativesTable";
import RosterPanel from "@/components/RosterPanel";
import ManualEntry from "@/components/ManualEntry";
import BulkEntry from "@/components/BulkEntry";
import LeaguePulse from "@/components/LeaguePulse";

const POLL_MS = 3000;

export default function Home() {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [r, s, p] = await Promise.all([fetchRecommendation(), fetchDraftState(), fetchPlayers()]);
      setRec(r);
      setState(s);
      setPlayers(p.players);
      setError(null);
    } catch {
      // Never blank the screen on a transient poll failure (CLAUDE.md +
      // project error-handling rule) — keep the last-known good state on
      // screen and surface a quiet banner instead.
      setError("connection hiccup — showing last known state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) {
    return (
      <main className="app-main">
        <p>Loading draft state…</p>
      </main>
    );
  }

  if (!rec || !state) {
    return (
      <main className="app-main">
        <p>Couldn&apos;t load draft state. Retrying every {POLL_MS / 1000}s…</p>
      </main>
    );
  }

  return (
    <main className="app-main">
      {error && <div className="conn-banner">{error}</div>}
      <div className="app-layout">
        <div className="app-primary">
          <PickCard rec={rec} />
          <AlternativesTable alternatives={rec.alternatives} />
          <LeaguePulse state={state} />
          <ManualEntry state={state} onChanged={refresh} />
          <BulkEntry onChanged={refresh} />
        </div>
        <RosterPanel state={state} players={players} />
      </div>
    </main>
  );
}
