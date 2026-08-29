/**
 * Deterministic bulk-paste parser for "copy the last N rows off the CBS
 * draft board and drop them in." No LLM involved (CLAUDE.md non-negotiable
 * #1: the live path never calls an LLM) — this is plain substring matching
 * against the precomputed player pool, so it's instant, free, and works
 * offline. CBS's exact column layout (pick #, team, player, position, NFL
 * team) isn't load-bearing here: we just check whether a known player's full
 * name appears as a substring of the pasted row, so it's robust to whatever
 * order CBS's columns happen to be in.
 */
import type { PlayerRecord, Position } from "@/types";
import { normalizeName } from "@/lib/store";

export interface BulkParseMatch {
  raw_line: string;
  player_id: string;
  player_name: string;
  position: Position;
}

export interface BulkParseResult {
  /** Confidently resolved, not-yet-drafted players, in chronological (oldest-first) order. */
  matched: BulkParseMatch[];
  /** Lines that matched a player already recorded as drafted — safely ignored, not errors. */
  already_drafted: string[];
  /** Lines that matched zero or multiple players — needs a human to resolve. */
  unresolved: { raw_line: string; candidates: BulkParseMatch[] }[];
}

function isNoiseLine(line: string): boolean {
  const letters = line.replace(/[^a-zA-Z]/g, "");
  return letters.length < 3;
}

const SUFFIX_RE = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i;

/** CBS often drops name suffixes (Jr., II, III...) that players.json keeps — match either form. */
function nameVariants(name: string): string[] {
  const stripped = name.replace(SUFFIX_RE, "").trim();
  return stripped === name ? [name] : [name, stripped];
}

/**
 * Parse pasted CBS draft-board text into player matches.
 * @param order "recent_first" (default — CBS shows newest pick on top) or
 *   "oldest_first". Output `matched` is always chronological (oldest first)
 *   since that's the order picks must be replayed in.
 */
export function parseBulkPaste(
  text: string,
  players: PlayerRecord[],
  draftedIds: ReadonlySet<string>,
  order: "recent_first" | "oldest_first" = "recent_first"
): BulkParseResult {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isNoiseLine(l));

  // Longest names first so a full "Josh Jacobs" match wins over a partial "Josh" collision.
  const byLength = [...players].sort((a, b) => b.name.length - a.name.length);

  const matched: BulkParseMatch[] = [];
  const already_drafted: string[] = [];
  const unresolved: { raw_line: string; candidates: BulkParseMatch[] }[] = [];

  for (const line of lines) {
    const normLine = normalizeName(line);
    const candidates = byLength.filter((p) => nameVariants(p.name).some((v) => normLine.includes(normalizeName(v))));

    if (candidates.length === 0) {
      unresolved.push({ raw_line: line, candidates: [] });
      continue;
    }

    // If the longest match's name is a strict substring of a longer candidate's
    // name that also matched, prefer the longer one (already sorted) and drop
    // shorter ones fully contained within it — avoids "Josh Allen" also
    // triggering a false "Josh" style partial elsewhere.
    const top = candidates[0];
    const topVariants = nameVariants(top.name).map(normalizeName);
    const overlapping = candidates.filter(
      (c) => c.player_id !== top.player_id && !topVariants.some((tv) => tv.includes(normalizeName(c.name)))
    );

    if (overlapping.length > 0) {
      unresolved.push({
        raw_line: line,
        candidates: [top, ...overlapping].map((p) => ({
          raw_line: line,
          player_id: p.player_id,
          player_name: p.name,
          position: p.position,
        })),
      });
      continue;
    }

    if (draftedIds.has(top.player_id)) {
      already_drafted.push(line);
      continue;
    }

    matched.push({
      raw_line: line,
      player_id: top.player_id,
      player_name: top.name,
      position: top.position,
    });
  }

  if (order === "recent_first") matched.reverse();

  return { matched, already_drafted, unresolved };
}
