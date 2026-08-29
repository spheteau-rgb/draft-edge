/**
 * POST /api/draft/reset -> wipe the draft back to pick 1 (docs/06). For
 * running practice/mock drafts back to back without redeploying. Confirmed
 * client-side before this is ever called (irreversible: drops the whole log).
 */
import { NextResponse } from "next/server";
import { getDraftStateStore } from "@/lib/store";

export async function POST() {
  const store = getDraftStateStore();
  const state = await store.reset();
  return NextResponse.json(state);
}
