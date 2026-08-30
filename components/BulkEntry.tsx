"use client";

import { useState } from "react";
import { submitBulkPaste, type BulkApplyResult } from "@/lib/apiClient";

/**
 * "I'm not watching the draft the whole time" entry point: paste the last N
 * rows straight off the CBS draft board (any column order — pick #, team,
 * player, position, NFL team all fine) and apply everything the parser is
 * confident about in one shot. Anything ambiguous is surfaced instead of
 * guessed (docs/06 error-handling rule: never silently mis-record a pick).
 */
/** A round-14 catch-up paste can resolve 100+ picks; dumping every name buries the summary. */
const MAX_LISTED = 12;

function summarize(items: string[], sep = ", "): string {
  if (items.length <= MAX_LISTED) return items.join(sep);
  return `${items.slice(0, MAX_LISTED).join(sep)}${sep}…and ${items.length - MAX_LISTED} more`;
}

export default function BulkEntry({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState("");
  const [order, setOrder] = useState<"recent_first" | "oldest_first">("recent_first");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [open, setOpen] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitBulkPaste(text, order);
      setResult(res);
      if (res.applied.length > 0) {
        setText("");
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to parse paste");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bulk-entry">
      <button type="button" className="bulk-entry-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide bulk paste" : "Paste last picks from CBS ▸"}
      </button>
      {open && (
        <div className="bulk-entry-body">
          <textarea
            className="bulk-entry-textarea"
            placeholder="Paste the last rows from the CBS draft board here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
          />
          <div className="bulk-entry-row">
            <label className="bulk-entry-order">
              <input
                type="radio"
                checked={order === "recent_first"}
                onChange={() => setOrder("recent_first")}
              />
              Newest pick on top
            </label>
            <label className="bulk-entry-order">
              <input
                type="radio"
                checked={order === "oldest_first"}
                onChange={() => setOrder("oldest_first")}
              />
              Oldest pick on top
            </label>
            <button type="button" onClick={handleSubmit} disabled={busy || !text.trim()}>
              {busy ? "Parsing…" : "Parse & apply"}
            </button>
          </div>
          {error && <p className="manual-entry-error">{error}</p>}
          {result && (
            <div className="bulk-entry-result">
              {result.applied.length > 0 && (
                <p>
                  ✓ Applied {result.applied.length}: {summarize(result.applied.map((m) => m.player_name))}
                </p>
              )}
              {result.already_drafted.length > 0 && (
                <p className="bulk-entry-muted">Already had {result.already_drafted.length} of these.</p>
              )}
              {result.failed.length > 0 && (
                <p className="manual-entry-error">
                  {result.failed.length} failed: {summarize(result.failed.map((f) => f.raw_line), " / ")}
                </p>
              )}
              {result.unresolved.length > 0 && (
                <div className="bulk-entry-unresolved">
                  <p>Couldn&apos;t confidently match {result.unresolved.length} line(s) — enter these manually:</p>
                  <ul>
                    {result.unresolved.slice(0, MAX_LISTED).map((u, i) => (
                      <li key={i}>
                        &quot;{u.raw_line}&quot;
                        {u.candidates.length > 0 && (
                          <> — could be: {u.candidates.map((c) => c.player_name).join(" or ")}</>
                        )}
                      </li>
                    ))}
                  </ul>
                  {result.unresolved.length > MAX_LISTED && (
                    <p className="bulk-entry-muted">…and {result.unresolved.length - MAX_LISTED} more.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
