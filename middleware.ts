/**
 * Auth gate (CLAUDE.md non-negotiable #4). Every request except /unlock,
 * its API route, and Next internals must carry the draft_edge_auth cookie
 * set by POST /api/unlock, or gets redirected to /unlock. Deliberately
 * simple — one shared secret, one httpOnly cookie, no accounts.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "draft_edge_auth";
const PUBLIC_PATHS = ["/unlock", "/api/unlock"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/sw.js")
  ) {
    return NextResponse.next();
  }

  const expected = process.env.APP_SHARED_SECRET;
  const cookie = request.cookies.get(COOKIE_NAME)?.value;

  if (!expected || cookie !== expected) {
    const url = request.nextUrl.clone();
    url.pathname = "/unlock";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
