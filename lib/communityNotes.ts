/**
 * Loads data/community_notes.json once and caches it in module scope,
 * mirroring lib/players.ts. Advisory-only web-research annotations
 * (sleeper/bust/injury-watch tags) — never fed into optimizer.ts scoring,
 * VORP, or reason-code generation. Missing file / bad JSON degrades to "no
 * notes" rather than breaking the recommendation path.
 */

import fs from "node:fs";
import path from "node:path";

export interface CommunityNote {
  name: string;
  tag: string;
  note: string;
  sources: string[];
}

interface CommunityNotesFile {
  players: Record<string, CommunityNote>;
}

let cachedNotes: Record<string, CommunityNote> | null = null;

function loadNotes(): Record<string, CommunityNote> {
  if (cachedNotes) return cachedNotes;

  const filePath = path.join(process.cwd(), "data", "community_notes.json");
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as CommunityNotesFile;
      cachedNotes = parsed.players ?? {};
      return cachedNotes;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("communityNotes.ts: failed to parse data/community_notes.json, continuing without notes", err);
    }
  }

  cachedNotes = {};
  return cachedNotes;
}

export function getCommunityNote(playerId: string): CommunityNote | null {
  return loadNotes()[playerId] ?? null;
}

/** Test-only hook to reset the module cache between test files. */
export function __resetCommunityNotesCache(): void {
  cachedNotes = null;
}
