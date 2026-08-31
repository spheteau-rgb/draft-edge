/**
 * Screenshot -> structured rows (docs/10 §2.4).
 *
 * This is the ONE place a model is allowed to run, and it runs at ingest time,
 * never on the recommendation path (CLAUDE.md non-negotiable #1). Its only job
 * is transcription: read what CBS printed and type it out. It does not rank,
 * judge, or infer anything the pixels do not say.
 *
 * Nothing here is trusted downstream. Names come back exactly as printed and are
 * matched against the player pool by resolveRows(), which sends anything
 * ambiguous to `unresolved` rather than guessing.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SnapshotRow, TeamSnapshot, TransactionRow } from "@/lib/season/snapshot";

/** Which CBS screen this image is. Classified by the model, correctable by the user. */
export type ScreenKind = "MY_ROSTER" | "OPPONENT_ROSTER" | "FREE_AGENTS" | "TRANSACTIONS" | "UNKNOWN";

export interface TranscriptionResult {
  kind: ScreenKind;
  /** Team header fields, only for the two roster screens. */
  team?: Pick<TeamSnapshot, "team_name" | "owner" | "record" | "faab_remaining" | "cbs_proj_week_total">;
  players: SnapshotRow[];
  transactions: TransactionRow[];
  /** Anything the model could not read cleanly. Shown to the user, never silently dropped. */
  notes: string[];
}

const MODEL = "claude-sonnet-4-5";

const SYSTEM = `You transcribe CBS Sports fantasy football screenshots into JSON. You are an OCR step, not an analyst.

Rules:
- Copy names EXACTLY as printed, including abbreviations ("M. Stafford") and suffixes ("Jr."). Never expand, correct, or complete a name.
- Copy every visible player row. Do not skip, summarize, reorder, or deduplicate.
- If a field is not visible, omit it. Never estimate a number.
- DST rows use position "DST" and the team name as printed. Kickers are "K".
- Return ONLY the JSON object, no prose and no markdown fence.

Classify the screen as one of:
- MY_ROSTER: a team roster with lineup slots ("Mama There Goes That Man" is the user's team)
- OPPONENT_ROSTER: a roster for any other team
- FREE_AGENTS: the Add Player / available-players list
- TRANSACTIONS: a league transaction log or waiver results
- UNKNOWN: anything else

Schema:
{
  "kind": "MY_ROSTER" | "OPPONENT_ROSTER" | "FREE_AGENTS" | "TRANSACTIONS" | "UNKNOWN",
  "team": { "team_name": string, "owner"?: string, "record"?: string, "faab_remaining"?: number, "cbs_proj_week_total"?: number },
  "players": [{
    "name": string,
    "position": "QB"|"RB"|"WR"|"TE"|"K"|"DST",
    "nfl_team": string,
    "slot"?: "QB"|"RB"|"WR"|"TE"|"RWT"|"K"|"DST"|"BENCH",
    "section"?: "ACTIVE"|"RESERVE"|"IR"|"PRACTICE_SQUAD",
    "injury"?: "Q"|"D"|"O"|"IR"|"PUP"|"SUSP",
    "opponent"?: string,
    "kickoff"?: string,
    "cbs_proj_week"?: number,
    "cbs_proj_season"?: number
  }],
  "transactions": [{ "team": string, "action": "ADD"|"DROP"|"TRADE", "player": string, "bid"?: number, "result"?: "WON"|"LOST" }],
  "notes": [string]
}

"team" is only for roster screens; omit it otherwise. Use [] for lists with nothing in them.`;

/** CBS prints flex as "RB/WR/TE"; the lineup engine calls that slot RWT. */
const SLOT_ALIASES: Record<string, string> = {
  "RB/WR/TE": "RWT",
  "W/R/T": "RWT",
  FLEX: "RWT",
  "D/ST": "DST",
  DEF: "DST",
};

function normalizeSlot(slot: unknown): SnapshotRow["slot"] {
  if (typeof slot !== "string") return undefined;
  const upper = slot.trim().toUpperCase();
  return (SLOT_ALIASES[upper] ?? upper) as SnapshotRow["slot"];
}

function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

export function isTranscriptionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * @param imageBase64 raw base64, no data: prefix
 * @param mediaType e.g. "image/png"
 */
export async function transcribeScreenshot(
  imageBase64: string,
  mediaType: string
): Promise<TranscriptionResult> {
  if (!isTranscriptionConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not set — screenshot transcription is unavailable.");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
              data: imageBase64,
            },
          },
          { type: "text", text: "Transcribe this screen." },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    throw new Error("Could not read that screenshot — the transcription came back malformed.");
  }

  const players = Array.isArray(parsed.players) ? (parsed.players as SnapshotRow[]) : [];
  return {
    kind: (typeof parsed.kind === "string" ? parsed.kind : "UNKNOWN") as ScreenKind,
    team: (parsed.team as TranscriptionResult["team"]) ?? undefined,
    players: players
      .filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
      .map((p) => ({ ...p, slot: normalizeSlot(p.slot) })),
    transactions: Array.isArray(parsed.transactions) ? (parsed.transactions as TransactionRow[]) : [],
    notes: Array.isArray(parsed.notes) ? (parsed.notes as string[]).filter((n) => typeof n === "string") : [],
  };
}
