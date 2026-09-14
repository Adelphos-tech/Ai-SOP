// ============================================================
// POST /api/auth/logout
// GET  /api/auth/me
// ============================================================
// POST: Destroys the current session and clears cookie.
// GET:  Returns the current consultant (or 401 if not logged in).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getConsultantSession,
  destroySession,
  clearSessionCookie,
} from "@/lib/auth/consultant-session";

export async function POST(request: NextRequest) {
  await destroySession(request);
  const response = NextResponse.json({ success: true });
  return clearSessionCookie(response);
}

export async function GET(request: NextRequest) {
  const session = await getConsultantSession(request);
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 },
    );
  }
  return NextResponse.json({
    authenticated: true,
    consultant: {
      id: session.consultant.id,
      email: session.consultant.email,
      name: session.consultant.name,
      role: session.consultant.role,
    },
    expiresAt: session.expiresAt.toISOString(),
  });
}
