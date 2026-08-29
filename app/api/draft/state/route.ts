/**
 * GET /api/draft/state -> canonical state (picks, on-the-clock, your next
 * pick) (docs/06). Wired to lib/store.ts. State is server-side only — never
 * trust device-local state (CLAUDE.md).
 */
import { NextResponse } from "next/server";
import { getDraftStateStore } from "@/lib/store";

// Draft state changes constantly (KV-backed) and must never be served from
// Next.js's static/CDN cache — every poll needs the live value or a pick
// entered on one device won't show up on another (CLAUDE.md).
export const dynamic = "force-dynamic";

export async function GET() {
  const store = getDraftStateStore();
  const state = await store.getState();
  return NextResponse.json(state);
}
