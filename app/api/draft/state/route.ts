/**
 * GET /api/draft/state -> canonical state (picks, on-the-clock, your next
 * pick) (docs/06). Wired to lib/store.ts. State is server-side only — never
 * trust device-local state (CLAUDE.md).
 */
import { NextResponse } from "next/server";
import { getDraftStateStore } from "@/lib/store";

export async function GET() {
  const store = getDraftStateStore();
  const state = await store.getState();
  return NextResponse.json(state);
}
