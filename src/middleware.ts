import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// `/` must redirect with a real server-side 307. When the page-level
// redirect() ran on the statically prerendered route, Next delivered it as
// a client-side RSC redirect that raced with AuthGuard's own post-401
// router.replace and crashed the app router (React error #310).
export function middleware(request: NextRequest) {
  return NextResponse.redirect(new URL("/students", request.url), 307);
}

export const config = { matcher: "/" };
