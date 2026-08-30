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
  /** Lines that matched a player already recorded as drafted (or repeated within this same paste) — safely ignored, not errors. */
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
const ACTION_WORD_RE = /^(edit|draft|trade|remove|details|view player|redo|undo|drafted|on the clock)$/i;
const ROUND_HEADER_RE = /^round\s*\d{1,2}$/i;
/** Overall pick numbers pass 99 in round 9 of a 12-team draft, so this must accept 3 digits. */
const PICK_LABEL_RE = /^(?:pick\s*)?#?\d{1,3}(?:\.\d{1,2})?$/i;
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

/** "1.10" sorts after "1.9" only if the pick half is compared as an integer, not a decimal. */
function pickOrdinal(value: string): number {
  const [round, pick] = value.split(".").map(Number);
  return round * 100 + pick;
}

/**
 * True if consecutive "round.pick" values are strictly monotonic — a real draft
 * board reads in order. Either direction counts: CBS defaults to newest pick on
 * top, which reads descending.
 */
function isPlausiblePickSequence(values: string[]): boolean {
  if (values.length < 2) return false;
  const nums = values.map(pickOrdinal);
  const ascending = nums.every((n, i) => i === 0 || n > nums[i - 1]);
  const descending = nums.every((n, i) => i === 0 || n < nums[i - 1]);
  return ascending || descending;
}

/** Same franchise, different site abbreviations — map to players.json's codes. */
const TEAM_ALIASES: Record<string, string> = {
  JAX: "JAC", WSH: "WAS", LA: "LAR", SD: "LAC", OAK: "LV", STL: "LAR",
};
function normTeam(code: string): string {
  const u = code.toUpperCase();
  return TEAM_ALIASES[u] ?? u;
}
function normPos(code: string): string {
  const u = code.toUpperCase();
  return u === "DEF" || u === "D/ST" ? "DST" : u;
}

/** A player-name line plus the team/position context found in its pick block. */
export interface ParsedEntry {
  /** The player-name line (possibly abbreviated, e.g. "B. Robinson"). */
  line: string;
  /** Canonicalized NFL team codes found in this pick's block (e.g. "ATL"). */
  teams: Set<string>;
  /** Position codes found in this pick's block (e.g. "RB"), DST-normalized. */
  positions: Set<string>;
}

/**
 * Draft-board exports (CBS, FantasyPros, ESPN...) paste as a repeating block
 * per pick: fantasy team/owner name, pick number, player name (sometimes
 * abbreviated to "F. Lastname"), position, NFL team, bye week, action button
 * text. Structural lines (position code, NFL team code, bye week, pick number,
 * action words, round headers) are unambiguous and always safe to treat as
 * non-name lines regardless of source. The one guess — that the line right
 * before a pick-number line is the team/owner name — is only applied when at
 * least two pick-number lines form a strictly monotonic "round.pick" sequence,
 * so a coincidental decimal in an unrelated paste can't cause a real,
 * unrecognized player line to be silently discarded.
 *
 * We keep each name line's block context (the position + NFL team lines that
 * follow it, before the next name) so an abbreviated name like "B. Robinson"
 * that maps to two players — Bijan and Brian Robinson, both RB/ATL — can be
 * disambiguated by team/position/value instead of dropped as ambiguous.
 */
function extractEntries(lines: string[]): ParsedEntry[] {
  const pickIdx = new Set<number>();
  const pickValues: string[] = [];
  lines.forEach((l, i) => {
    if (PICK_NUMBER_RE.test(l)) {
      pickIdx.add(i);
      pickValues.push(l);
    }
  });
  const canGuessOwnerLines = isPlausiblePickSequence(pickValues);

  const isStructural = (l: string, i: number): boolean =>
    PICK_LABEL_RE.test(l) ||
    (canGuessOwnerLines && pickIdx.has(i + 1) && !pickIdx.has(i)) ||
    ACTION_WORD_RE.test(l) ||
    ROUND_HEADER_RE.test(l) ||
    BYE_RE.test(l) ||
    POSITION_CODES.has(l.toUpperCase()) ||
    NFL_TEAM_CODES.has(l.toUpperCase()) ||
    isPosTeamLine(l);

  const nameIdx = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => !isStructural(l, i) && !isNoiseLine(l))
    .map(({ i }) => i);

  return nameIdx.map((i, k) => {
    const teams = new Set<string>();
    const positions = new Set<string>();
    // Attribute the structural lines that follow this name (up to the next name
    // line) to this pick — CBS/FantasyPros/ESPN all emit name → position → team.
    const end = k + 1 < nameIdx.length ? nameIdx[k + 1] : lines.length;
    for (let j = i + 1; j < end; j++) {
      const l = lines[j].trim();
      const posTeam = POS_TEAM_RE.exec(l);
      if (
        posTeam &&
        POSITION_CODES.has(posTeam[1].toUpperCase()) &&
        NFL_TEAM_CODES.has(posTeam[2].toUpperCase())
      ) {
        positions.add(normPos(posTeam[1]));
        teams.add(normTeam(posTeam[2]));
        continue;
      }
      const up = l.toUpperCase();
      if (POSITION_CODES.has(up)) positions.add(normPos(up));
      else if (NFL_TEAM_CODES.has(up)) teams.add(normTeam(up));
    }
    return { line: lines[i], teams, positions };
  });
}

const ABBREVIATED_NAME_RE = /^([a-z])\.?\s+(.+)$/i;
const DST_MARKER_RE = /^(?:defense|dst|def)|(?:defense|dst|def)$/g;

/**
 * players.json names defenses by full team ("Pittsburgh Steelers") but draft
 * boards write them as "Steelers D/ST", "Pittsburgh D/ST" or "PIT DST". These
 * go in the last rounds, so a paste that catches up on rounds 12-14 is mostly
 * defenses. Aliases are matched on the *whole* line (with the D/ST marker
 * stripped) rather than as substrings, so a bare city like "Washington" can't
 * be swallowed by a surname collision inside a longer row.
 */
function dstAliases(name: string, nflTeam: string): string[] {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return [normalizeName(name)];
  const nickname = words[words.length - 1];
  const city = words.slice(0, -1).join(" ");
  return [name, nickname, city, nflTeam].filter(Boolean).map(normalizeName);
}

/** A normalized line with any leading/trailing D/ST marker removed, for alias comparison. */
function dstKey(normLine: string): string {
  return normLine.replace(DST_MARKER_RE, "");
}

interface IndexedPlayer {
  player: PlayerRecord;
  /** Normalized full name plus the suffix-stripped form, for substring matching. */
  variants: string[];
  normName: string;
  firstInitial: string;
  normLast: string;
  dst: string[];
}

/**
 * Normalizing every player name once per parse instead of once per (line,
 * player) pair. A round-14 catch-up paste is ~1,200 lines against ~600
 * players, so the naive form burns ~700k string allocations on the pick clock.
 */
function indexPlayers(players: PlayerRecord[]): IndexedPlayer[] {
  return [...players]
    .sort((a, b) => b.name.length - a.name.length)
    .map((player) => {
      const words = player.name.replace(SUFFIX_RE, "").trim().split(/\s+/);
      return {
        player,
        variants: nameVariants(player.name).map(normalizeName),
        normName: normalizeName(player.name),
        firstInitial: words.length >= 2 ? words[0][0].toLowerCase() : "",
        normLast: words.length >= 2 ? normalizeName(words.slice(1).join(" ")) : "",
        dst: player.position === "DST" ? dstAliases(player.name, player.nfl_team) : [],
      };
    });
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
  const entries = extractEntries(rawLines);

  // Longest names first so a full "Josh Jacobs" match wins over a partial "Josh" collision.
  const index = indexPlayers(players);

  const matched: BulkParseMatch[] = [];
  const already_drafted: string[] = [];
  const unresolved: { raw_line: string; candidates: BulkParseMatch[] }[] = [];
  // A catch-up paste routinely overlaps picks entered earlier in the same
  // paste; without this the same player is applied twice and the second one
  // surfaces as a scary "failed" instead of a no-op.
  const seenInPaste = new Set<string>();

  for (const { line, teams, positions } of entries) {
    const normLine = normalizeName(line);
    const abbrev = ABBREVIATED_NAME_RE.exec(line.trim());
    const abbrevInitial = abbrev ? abbrev[1].toLowerCase() : "";
    const abbrevLast = abbrev ? normalizeName(abbrev[2]) : "";
    const dstLine = dstKey(normLine);

    const candidates = index.filter(
      (p) =>
        p.variants.some((v) => normLine.includes(v)) ||
        (abbrev !== null && p.normLast !== "" && p.firstInitial === abbrevInitial && p.normLast === abbrevLast) ||
        p.dst.includes(dstLine)
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
    const overlapping = candidates.filter(
      (c) => c.player.player_id !== top.player.player_id && !top.variants.some((tv) => tv.includes(c.normName))
    );
    let resolved = [top, ...overlapping];

    // Two distinct players still match this row (e.g. "B. Robinson" → Bijan and
    // Brian Robinson). Use the block's team, then position, to narrow — never
    // letting stale/missing context wipe out every candidate.
    if (resolved.length > 1 && teams.size > 0) {
      const byTeam = resolved.filter((p) => teams.has(normTeam(p.player.nfl_team)));
      if (byTeam.length > 0) resolved = byTeam;
    }
    if (resolved.length > 1 && positions.size > 0) {
      const byPos = resolved.filter((p) => positions.has(normPos(p.player.position)));
      if (byPos.length > 0) resolved = byPos;
    }

    if (resolved.length > 1) {
      // Same name, team AND position (Bijan vs Brian Robinson, both RB/ATL).
      // With no block context this is loose text a human should resolve; with
      // context it's a real draft row, so take the higher-value player still on
      // the board — the star is the overwhelmingly likely intent, and later
      // rows self-correct once he is marked drafted.
      if (teams.size === 0 && positions.size === 0) {
        unresolved.push({
          raw_line: line,
          candidates: resolved.map((p) => ({
            raw_line: line,
            player_id: p.player.player_id,
            player_name: p.player.name,
            position: p.player.position,
          })),
        });
        continue;
      }
      const available = resolved.filter(
        (p) => !draftedIds.has(p.player.player_id) && !seenInPaste.has(p.player.player_id)
      );
      const pool = available.length > 0 ? available : resolved;
      resolved = [
        pool.reduce((a, b) => (a.player.fundamental_rank <= b.player.fundamental_rank ? a : b)),
      ];
    }

    const chosen = resolved[0];
    if (draftedIds.has(chosen.player.player_id) || seenInPaste.has(chosen.player.player_id)) {
      already_drafted.push(line);
      continue;
    }

    seenInPaste.add(chosen.player.player_id);
    matched.push({
      raw_line: line,
      player_id: chosen.player.player_id,
      player_name: chosen.player.name,
      position: chosen.player.position,
    });
  }

  if (order === "recent_first") matched.reverse();

  return { matched, already_drafted, unresolved };
}
