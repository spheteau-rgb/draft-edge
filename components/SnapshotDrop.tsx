"use client";

/**
 * Drop screenshots, get a week (docs/10 §2.4).
 *
 * The whole point is that the user's job is dragging images in. So: each image
 * is transcribed on its own request (progress instead of one long hang), the
 * model's guess at which screen it is stays editable (a misfiled opponent
 * roster would silently corrupt the brief), and nothing is written until the
 * user presses Save — which replaces the week rather than appending to it.
 */

import { useCallback, useRef, useState } from "react";
import type { SnapshotRow, TeamSnapshot, TransactionRow, WeekSnapshot } from "@/lib/season/snapshot";
import type { ScreenKind, TranscriptionResult } from "@/lib/season/transcribe";
import { saveSnapshot, transcribeImage } from "@/lib/apiClient";

const KIND_LABELS: Record<ScreenKind, string> = {
  MY_ROSTER: "My roster",
  OPPONENT_ROSTER: "Opponent roster",
  FREE_AGENTS: "Free agents",
  TRANSACTIONS: "Transactions",
  UNKNOWN: "Not recognised",
};

interface Item {
  id: string;
  fileName: string;
  status: "working" | "done" | "error";
  kind: ScreenKind;
  result?: TranscriptionResult;
  error?: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Same player transcribed off two screens is one row. */
function dedupe(rows: SnapshotRow[]): SnapshotRow[] {
  const seen = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const key = `${r.name.toLowerCase()}|${r.position}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

function buildSnapshot(items: Item[], season: number, week: number): WeekSnapshot {
  const done = items.filter((i) => i.status === "done" && i.result);
  const of = (kind: ScreenKind) => done.filter((i) => i.kind === kind);

  const team = (kind: ScreenKind, fallbackName: string): TeamSnapshot => {
    const group = of(kind);
    const header = group.find((i) => i.result?.team)?.result?.team;
    return {
      team_name: header?.team_name ?? fallbackName,
      owner: header?.owner,
      record: header?.record,
      faab_remaining: header?.faab_remaining ?? null,
      cbs_proj_week_total: header?.cbs_proj_week_total,
      players: dedupe(group.flatMap((i) => i.result!.players)),
    };
  };

  const opponent = team("OPPONENT_ROSTER", "Opponent");
  const transactions: TransactionRow[] = of("TRANSACTIONS").flatMap((i) => i.result!.transactions);

  return {
    season,
    week,
    captured_at: new Date().toISOString(),
    source: "screenshot-upload",
    my_team: team("MY_ROSTER", "Mama There Goes That Man"),
    opponent: opponent.players.length > 0 ? opponent : undefined,
    free_agents: dedupe(of("FREE_AGENTS").flatMap((i) => i.result!.players)),
    transactions,
  };
}

export default function SnapshotDrop({
  season,
  week,
  onSaved,
}: {
  season: number;
  week: number;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setSavedAt(null);

    for (const file of images) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev, { id, fileName: file.name, status: "working", kind: "UNKNOWN" }]);

      try {
        const result = await transcribeImage(await fileToBase64(file), file.type);
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, status: "done", kind: result.kind, result } : i))
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "transcription failed";
        console.error(`Transcription failed for ${file.name}`, err);
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "error", error: message } : i)));
      }
    }
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveSnapshot(buildSnapshot(items, season, week));
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to save the week";
      console.error("Snapshot save failed", err);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [items, season, week, onSaved]);

  const done = items.filter((i) => i.status === "done");
  const working = items.some((i) => i.status === "working");
  const myRows = done.filter((i) => i.kind === "MY_ROSTER").reduce((n, i) => n + i.result!.players.length, 0);
  const faRows = done.filter((i) => i.kind === "FREE_AGENTS").reduce((n, i) => n + i.result!.players.length, 0);
  const canSave = myRows > 0 && !working && !saving;

  return (
    <section className="brief-section drop-section">
      <h2>Drop this week&apos;s screenshots</h2>
      <p className="brief-sub">
        Your roster, your opponent&apos;s roster, and one Add Player screen per position — including K
        and DST, or those slots price at zero. Saving replaces week {week}.
      </p>

      <div
        className={dragging ? "dropzone dropzone-active" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingest([...e.dataTransfer.files]);
        }}
        onPaste={(e) => void ingest([...e.clipboardData.files])}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <strong>Drop images here</strong>
        <span>or tap to choose · paste works too</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void ingest([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="drop-list">
          {items.map((item) => (
            <li key={item.id} className="drop-item">
              <span className="drop-file">{item.fileName}</span>
              {item.status === "working" && <span className="drop-status">reading…</span>}
              {item.status === "error" && <span className="drop-error">{item.error}</span>}
              {item.status === "done" && (
                <>
                  <select
                    value={item.kind}
                    aria-label={`Screen type for ${item.fileName}`}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, kind: e.target.value as ScreenKind } : i))
                      )
                    }
                  >
                    {(Object.keys(KIND_LABELS) as ScreenKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <span className="drop-status">{item.result!.players.length} players</span>
                  {item.result!.notes.length > 0 && (
                    <em className="brief-guard">{item.result!.notes.join("; ")}</em>
                  )}
                </>
              )}
              <button
                type="button"
                className="drop-remove"
                aria-label={`Remove ${item.fileName}`}
                onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="drop-actions">
          <span className="brief-sub">
            {myRows} roster rows · {faRows} free agents
            {myRows === 0 && " · mark one image as My roster to save"}
          </span>
          <button type="button" onClick={() => void save()} disabled={!canSave}>
            {saving ? "Saving…" : `Save week ${week}`}
          </button>
        </div>
      )}

      {saveError && <p className="conn-banner">{saveError}</p>}
      {savedAt && <p className="brief-ok">Saved at {savedAt} — the brief below is rebuilt from it.</p>}
    </section>
  );
}
