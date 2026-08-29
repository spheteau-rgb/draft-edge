"use client";

import { useState } from "react";
import type { DraftState, Position } from "@/types";
import { submitPick, undoLastPick } from "@/lib/apiClient";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

export default function ManualEntry({
  state,
  onChanged,
}: {
  state: DraftState;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState<Position>("RB");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await submitPick({
        pick_number: state.current_pick,
        round: state.current_round,
        manager_slot: state.on_the_clock_slot,
        player_name: name.trim(),
        position,
      });
      setName("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to record pick");
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    setBusy(true);
    setError(null);
    try {
      await undoLastPick();
      onChanged();
    } catch {
      setError("failed to undo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="manual-entry" onSubmit={handleSubmit}>
      <span className="manual-entry-label">
        Pick {state.current_pick} · Slot {state.on_the_clock_slot} on the clock
      </span>
      <div className="manual-entry-row">
        <input
          autoFocus
          type="text"
          placeholder="type the player who was just drafted…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="manual-entry-input"
        />
        <select value={position} onChange={(e) => setPosition(e.target.value as Position)} className="manual-entry-select">
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !name.trim()} className="manual-entry-submit">
          ↵
        </button>
        <button type="button" onClick={handleUndo} disabled={busy} className="manual-entry-undo">
          undo
        </button>
      </div>
      {error && <p className="manual-entry-error">{error}</p>}
    </form>
  );
}
