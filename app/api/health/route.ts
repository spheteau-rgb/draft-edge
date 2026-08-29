/**
 * GET /api/health -> providers + freshness + model version (docs/06).
 * STUB: deployment-engineer / integration-doctor wire this to real provider
 * pings (FantasyPros cache age, CBS poll status, players.json build time)
 * plus KV `providers:health`. Never blocks the live pick path.
 */
import { NextResponse } from "next/server";
import type { SystemHealth } from "@/types";

export async function GET() {
  const placeholder: SystemHealth = {
    providers: [
      { provider: "fantasypros", status: "unknown", last_success_at: null, latency_ms: null },
      { provider: "cbs_api", status: "unknown", last_success_at: null, latency_ms: null },
      { provider: "manual", status: "healthy", last_success_at: null, latency_ms: null },
    ],
    players_json_build_time: "",
    model_version: "0.0.0-scaffold",
    data_freshness: "RED",
  };
  return NextResponse.json(placeholder);
}
