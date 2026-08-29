/**
 * GET /api/health -> providers + freshness + model version (docs/06).
 * Minimal real wiring: players.json build time (file mtime) + model_version
 * from config/model.yaml + whether the player pool came from the real
 * precompute output or the dev fixture. CBS status stays "unknown" until
 * deployment-engineer wires the live poll (docs/09) — this never blocks the
 * live pick path either way.
 */
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { SystemHealth } from "@/types";
import { loadModelConfig } from "@/lib/config";
import { loadPlayerPool } from "@/lib/players";

export async function GET() {
  const config = loadModelConfig();
  const { source } = loadPlayerPool();

  let buildTime = "";
  try {
    const filePath = path.join(process.cwd(), "data", "players.json");
    buildTime = fs.statSync(filePath).mtime.toISOString();
  } catch {
    // players.json not present (dev fixture in use) — leave buildTime blank.
  }

  const health: SystemHealth = {
    providers: [
      {
        provider: "fantasypros",
        status: source === "players.json" ? "healthy" : "unknown",
        last_success_at: buildTime || null,
        latency_ms: null,
      },
      { provider: "cbs_api", status: "unknown", last_success_at: null, latency_ms: null },
      { provider: "manual", status: "healthy", last_success_at: null, latency_ms: null },
    ],
    players_json_build_time: buildTime,
    model_version: config.model_version,
    data_freshness: source === "players.json" ? "GREEN" : "RED",
  };
  return NextResponse.json(health);
}
