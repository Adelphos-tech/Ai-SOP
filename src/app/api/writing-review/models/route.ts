// ============================================================
// GET /api/writing-review/models
// Selectable Ryne humanizer models for every surface (document
// Studio + standalone module): verified defaults + docs
// auto-discovery + RYNE_EXTRA_MODELS. Auth-protected; fail-open —
// a discovery outage still returns the verified defaults.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { listRyneModels, VERIFIED_RYNE_MODELS, DEFAULT_RYNE_MODEL } from "@/lib/writing-review/ryne-models";

export async function GET(request: NextRequest) {
  try {
    await requireConsultantSession(request);
    const models = await listRyneModels().catch(() => VERIFIED_RYNE_MODELS);
    return NextResponse.json({ models, defaultModel: DEFAULT_RYNE_MODEL });
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}
