/**
 * POST /api/draft/undo -> revert last pick (docs/06). Wired to lib/store.ts,
 * which pops the last non-undo event from its log and rebuilds state from
 * what remains (deployment-engineer swaps the in-memory store for a
 * KV-backed one behind the same interface — docs/09).
 */
import { NextResponse } from "next/server";
import { getDraftStateStore } from "@/lib/store";

export async function POST() {
  const store = getDraftStateStore();
  const state = await store.undo();
  return NextResponse.json(state);
}
