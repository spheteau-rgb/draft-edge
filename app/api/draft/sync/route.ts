/**
 * POST /api/draft/sync — Sync picked players from scraper
 *
 * Input: { picked_player_names: ["Patrick Mahomes", "Travis Kelce", ...] }
 * Output: { recommendation, picks_applied, current_state }
 *
 * Workflow:
 * 1. User scrapes CBS draft results page
 * 2. Passes list of picked player names (in draft order)
 * 3. This endpoint:
 *    - Matches names to Draft Edge player IDs
 *    - Applies new picks to the draft state store
 *    - Returns the next recommendation
 *
 * This is the bridge between the scraper and the recommendation engine.
 */

import { NextResponse } from "next/server";
import type { DraftEvent, Recommendation } from "@/types";
import { getDraftStateStore } from "@/lib/store";
import { loadPlayerPool } from "@/lib/players";
import { getRecommendation } from "@/lib/optimizer";

interface SyncRequest {
  picked_player_names: string[];
}

interface SyncResponse {
  picks_applied: number;
  current_state: {
    current_pick: number;
    picked_count: number;
    next_player_names: string[];
  };
  recommendation: Recommendation;
  error?: string;
}

export async function POST(req: Request) {
  try {
    const body: SyncRequest = await req.json();
    const { picked_player_names } = body;

    if (!Array.isArray(picked_player_names)) {
      return NextResponse.json(
        { error: "picked_player_names must be an array" },
        { status: 400 }
      );
    }

    const store = getDraftStateStore();
    const { players } = loadPlayerPool();
    let state = await store.getState();

    // Already-picked player names (normalized for comparison)
    const alreadyPicked = new Set(
      state.picks.map((p) => normalizeName(p.player_name))
    );

    let picksApplied = 0;

    // Apply each picked player in order
    for (const playerName of picked_player_names) {
      const normalized = normalizeName(playerName);
      if (alreadyPicked.has(normalized)) {
        // Already applied, skip
        continue;
      }

      // Find the player in the pool (best-effort match)
      const matchedPlayer = players.find(
        (p) => normalizeName(p.name) === normalized
      );

      if (!matchedPlayer) {
        console.warn(`[sync] Could not match player: ${playerName}`);
        continue;
      }

      // Build a draft event for this pick
      const managerSlot = (state.current_pick % 12) || 12;
      const event: DraftEvent = {
        event_type: "draft_pick",
        source: "manual", // Scraper treats as manual entry
        source_event_id: `sync-${Date.now()}-${picksApplied}`,
        pick_number: state.current_pick,
        round: state.current_round,
        manager_slot: managerSlot,
        player_source_id: matchedPlayer.external_ids.cbs_id ?? null,
        player_id: matchedPlayer.player_id,
        player_name: matchedPlayer.name,
        position: matchedPlayer.position,
        nfl_team: matchedPlayer.nfl_team,
        observed_at: new Date().toISOString(),
      };

      // Apply the event
      state = await store.applyEvent(event);
      alreadyPicked.add(normalized);
      picksApplied++;
    }

    // Get the recommendation for the current state
    const recommendation = await getRecommendation(state, players);

    // Return response
    const response: SyncResponse = {
      picks_applied: picksApplied,
      current_state: {
        current_pick: state.current_pick,
        picked_count: state.picks.length,
        next_player_names: players
          .filter((p) => !state.drafted_player_ids.includes(p.player_id))
          .slice(0, 5)
          .map((p) => p.name),
      },
      recommendation,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[sync] Error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}
