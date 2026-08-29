/**
 * POST /api/unlock -> validate the shared secret and set an httpOnly cookie
 * gating the rest of the app (CLAUDE.md non-negotiable #4: "simple shared-
 * secret/password gate so the public URL isn't open to all"). One user, one
 * night — deliberately trivial, no session store, no user accounts.
 */
import { NextResponse } from "next/server";

const COOKIE_NAME = "draft_edge_auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { secret?: string } | null;
  const expected = process.env.APP_SHARED_SECRET;

  if (!expected) {
    // Misconfigured deployment (no secret set) — fail closed, never open.
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  if (!body?.secret || body.secret !== expected) {
    return NextResponse.json({ error: "incorrect passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days — this is a season-long draft-night tool, not a bank
  });
  return res;
}
