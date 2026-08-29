/**
 * Loads data/players.json once and caches it in module scope (docs/09:
 * "runtime reads it once and caches in module scope; never refetches per
 * request"). Falls back to the small dev fixture (lib/fixtures/mockPlayers)
 * if the precompute output doesn't exist yet, so /lib and the API routes
 * never block on the data-engineer's pipeline. Zero code changes needed
 * once data/players.json lands — same PlayerRecord[] shape.
 */

import fs from "node:fs";
import path from "node:path";
import type { PlayerRecord } from "@/types";
import { MOCK_PLAYERS } from "@/lib/fixtures/mockPlayers";

let cachedPlayers: PlayerRecord[] | null = null;
let cachedSource: "players.json" | "fixture" | null = null;

export function loadPlayerPool(): { players: PlayerRecord[]; source: "players.json" | "fixture" } {
  if (cachedPlayers && cachedSource) return { players: cachedPlayers, source: cachedSource };

  const filePath = path.join(process.cwd(), "data", "players.json");
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as PlayerRecord[];
      cachedPlayers = parsed;
      cachedSource = "players.json";
      return { players: cachedPlayers, source: cachedSource };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("players.ts: failed to parse data/players.json, falling back to fixture", err);
    }
  }

  cachedPlayers = MOCK_PLAYERS;
  cachedSource = "fixture";
  return { players: cachedPlayers, source: cachedSource };
}

/** Test-only hook to reset the module cache between test files. */
export function __resetPlayerPoolCache(): void {
  cachedPlayers = null;
  cachedSource = null;
}
