/**
 * Deterministic bulk-paste parser for "copy the last N rows off a draft
 * board (CBS, FantasyPros, ESPN, whatever) and drop them in." No LLM
 * involved (CLAUDE.md non-negotiable #1: the live path never calls an LLM)
 * — this is plain substring matching against the precomputed player pool,
 * so it's instant, free, and works offline. No site's exact column layout
 * is load-bearing: we check whether a known player's full (or abbreviated)
 * name appears in a pasted row, so it's robust to whatever order/format a
 * given site's export happens to use.
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

const NFL_TEAM_CODES = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
  "HOU", "IND", "JAC", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS", "FA",
]);
const POSITION_CODES = new Set(["QB", "RB", "WR", "TE", "K", "DST", "DEF", "D/ST"]);
const ACTION_WORD_RE = /^(edit|draft|trade|remove|details|view player)$/i;
const ROUND_HEADER_RE = /^round\s*\d{1,2}$/i;
const PICK_LABEL_RE = /^(?:pick\s*)?#?\d{1,2}(?:\.\d{1,2})?$/i;
/** Strict "round.pick" form (CBS/FantasyPros), e.g. "1.01" — used to anchor block detection. */
const PICK_NUMBER_RE = /^\d{1,2}\.\d{1,2}$/;
const BYE_RE = /^\(?bye[:\s]*\d{1,2}\)?$/i;
/** Combined "POS - TEAM" or "POS/TEAM" tokens some sites emit as a single line, e.g. "RB - ATL". */
const POS_TEAM_RE = /^([A-Z/]{1,4})\s*[-/]\s*([A-Z]{2,4})$/i;

function isPosTeamLine(line: string): boolean {
  const m = POS_TEAM_RE.exec(line.trim());
  if (!m) return false;
  return POSITION_CODES.has(m[1].toUpperCase()) && NFL_TEAM_CODES.has(m[2].toUpperCase());
}

/** True if consecutive "round.pick" values strictly increase — a real draft board reads in order. */
function isPlausiblePickSequence(values: string[]): boolean {
  if (values.length < 2) return false;
  const nums = values.map(Number);
  return nums.every((n, i) => i === 0 || n > nums[i - 1]);
}

/**
 * Draft-board exports (CBS, FantasyPros, ESPN...) paste as a repeating block
 * per pick: fantasy team/owner name, pick number, player name (sometimes
 * abbreviated to "F. Lastname"), position, NFL team, bye week, action button
 * text. Only the player-name line is useful to us. Structural lines
 * (position code, NFL team code, bye week, pick number, action words, round
 * headers) are unambiguous and always safe to drop regardless of source.
 * The one guess — that the line right before a pick-number line is the
 * team/owner name — is only applied when at least two pick-number lines
 * form a strictly increasing "round.pick" sequence, so a coincidental
 * decimal number in an unrelated paste format can't cause a real,
 * unrecognized player line to be silently discarded.
 */
function stripDraftBoardStructure(lines: string[]): string[] {
  const pickIdx = new Set<number>();
  const pickValues: string[] = [];
  lines.forEach((l, i) => {
    if (PICK_NUMBER_RE.test(l)) {
      pickIdx.add(i);
      pickValues.push(l);
    }
  });
  const canGuessOwnerLines = isPlausiblePickSequence(pickValues);

  const drop = new Set<number>();
  lines.forEach((l, i) => {
    if (
      PICK_LABEL_RE.test(l) ||
      (canGuessOwnerLines && pickIdx.has(i + 1) && !pickIdx.has(i)) ||
      ACTION_WORD_RE.test(l) ||
      ROUND_HEADER_RE.test(l) ||
      BYE_RE.test(l) ||
      POSITION_CODES.has(l.toUpperCase()) ||
      NFL_TEAM_CODES.has(l.toUpperCase()) ||
      isPosTeamLine(l)
    ) {
      drop.add(i);
    }
  });
  return lines.filter((_, i) => !drop.has(i));
}

/** Matches CBS's abbreviated "F. Lastname" form (e.g. "B. Robinson") against a full player name. */
function abbreviatedNameMatches(line: string, playerName: string): boolean {
  const m = /^([a-z])\.?\s+(.+)$/i.exec(line.trim());
  if (!m) return false;
  const [, initial, lastPart] = m;
  const words = playerName.replace(SUFFIX_RE, "").trim().split(/\s+/);
  if (words.length < 2) return false;
  const first = words[0];
  const last = words.slice(1).join(" ");
  return first[0].toLowerCase() === initial.toLowerCase() && normalizeName(last) === normalizeName(lastPart);
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
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const lines = stripDraftBoardStructure(rawLines).filter((l) => !isNoiseLine(l));

  // Longest names first so a full "Josh Jacobs" match wins over a partial "Josh" collision.
  const byLength = [...players].sort((a, b) => b.name.length - a.name.length);

  const matched: BulkParseMatch[] = [];
  const already_drafted: string[] = [];
  const unresolved: { raw_line: string; candidates: BulkParseMatch[] }[] = [];

  for (const line of lines) {
    const normLine = normalizeName(line);
    const candidates = byLength.filter(
      (p) =>
        nameVariants(p.name).some((v) => normLine.includes(normalizeName(v))) ||
        abbreviatedNameMatches(line, p.name)
    );

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
