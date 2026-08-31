/**
 * Single client-side API layer (per project code-quality rules: no fetch
 * calls inside UI components). Every /app/api/* call the browser makes goes
 * through here so error handling / JSON parsing lives in one place.
 */
import type { DraftState, PlayerRecord, Position, Recommendation } from "@/types";
import type { Brief } from "@/lib/season/brief";
import type { WeekSnapshot } from "@/lib/season/snapshot";
import type { TranscriptionResult } from "@/lib/season/transcribe";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({ error: fallback }));
    throw new Error(parsed.error ?? fallback);
  }
  return res.json() as Promise<T>;
}

export function fetchRecommendation(): Promise<Recommendation> {
  return getJson<Recommendation>("/api/recommendation");
}

export function fetchDraftState(): Promise<DraftState> {
  return getJson<DraftState>("/api/draft/state");
}

export function fetchPlayers(): Promise<{ players: PlayerRecord[]; source: string }> {
  return getJson("/api/players");
}

export function fetchBrief(season: number, week: number, window: "free" | "faab"): Promise<Brief> {
  return getJson<Brief>(`/api/brief?season=${season}&week=${week}&window=${window}`);
}

/** One screenshot in, rows out. Nothing is stored until saveSnapshot is called. */
export function transcribeImage(imageBase64: string, mediaType: string): Promise<TranscriptionResult> {
  return postJson<TranscriptionResult>(
    "/api/season/ingest",
    { image: imageBase64, mediaType },
    "failed to read that screenshot"
  );
}

export function saveSnapshot(snapshot: WeekSnapshot): Promise<{ ok: true; season: number; week: number }> {
  return postJson("/api/season/snapshot", snapshot, "failed to save the week");
}

export function fetchSnapshot(season: number, week: number): Promise<{ snapshot: WeekSnapshot | null }> {
  return getJson(`/api/season/snapshot?season=${season}&week=${week}`);
}

export interface ManualPickInput {
  pick_number: number;
  round: number;
  manager_slot: number;
  player_name: string;
  position: Position;
}

export async function submitPick(input: ManualPickInput): Promise<DraftState> {
  const res = await fetch("/api/draft/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: "draft_pick",
      source: "manual",
      pick_number: input.pick_number,
      round: input.round,
      manager_slot: input.manager_slot,
      player_name: input.player_name,
      position: input.position,
      nfl_team: "",
      observed_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "failed to record pick" }));
    throw new Error(body.error ?? "failed to record pick");
  }
  return res.json() as Promise<DraftState>;
}

export async function undoLastPick(): Promise<DraftState> {
  const res = await fetch("/api/draft/undo", { method: "POST" });
  if (!res.ok) throw new Error("failed to undo");
  return res.json() as Promise<DraftState>;
}

export async function resetDraft(): Promise<DraftState> {
  const res = await fetch("/api/draft/reset", { method: "POST" });
  if (!res.ok) throw new Error("failed to reset draft");
  return res.json() as Promise<DraftState>;
}

export interface BulkParseMatchDTO {
  raw_line: string;
  player_id: string;
  player_name: string;
  position: Position;
}

export interface BulkApplyResult {
  state: DraftState;
  applied: BulkParseMatchDTO[];
  already_drafted: string[];
  unresolved: { raw_line: string; candidates: BulkParseMatchDTO[] }[];
  failed: { raw_line: string; error: string }[];
}

export async function submitBulkPaste(
  text: string,
  order: "recent_first" | "oldest_first"
): Promise<BulkApplyResult> {
  const res = await fetch("/api/draft/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, order }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "failed to parse paste" }));
    throw new Error(body.error ?? "failed to parse paste");
  }
  return res.json() as Promise<BulkApplyResult>;
}
