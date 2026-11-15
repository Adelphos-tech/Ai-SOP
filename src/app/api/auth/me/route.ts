// ============================================================
// GET /api/auth/me
// ============================================================
// Returns the current consultant's session info, or 401 when
// there is no valid dvivid_session cookie. Used by AuthGuard and
// the top-bar profile on every page load.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getConsultantSession } from "@/lib/auth/consultant-session";

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
