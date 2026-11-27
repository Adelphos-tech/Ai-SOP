// ============================================================
// GET /api/standalone-studio/config
// Detector connectivity, run limits and the humanizer model
// registry for the standalone module. Auth-protected; the model
// list falls back to verified defaults if discovery fails.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { listDetectorDescriptors, listDetectorStatuses } from "@/lib/writing-review/detectors";
import { listRyneModels, VERIFIED_RYNE_MODELS, DEFAULT_RYNE_MODEL } from "@/lib/writing-review/ryne-models";
import { STANDALONE_MAX_WORDS } from "@/lib/writing-review/standalone";

export async function GET(request: NextRequest) {
  try {
    await requireConsultantSession(request);
    const models = await listRyneModels().catch(() => VERIFIED_RYNE_MODELS);
    return NextResponse.json({
      detectors: listDetectorStatuses(),
      detectionConfig: {
        runnable: listDetectorDescriptors()
          .filter(d => d.integration === "RYNE_AI_SCORE" && d.configured && !d.disabledReason)
          .map(d => d.detector),
        maxDetectorsPerRun: Number(process.env.RYNE_MAX_DETECTORS_PER_RUN ?? 3),
        pricingUnverified: true,
        reservationCeilingUsd: (() => {
          const n = Number(process.env.RYNE_UNVERIFIED_PRICE_CEILING_USD);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        configured: listDetectorDescriptors().some(d => d.configured),
      },
      models,
      defaultModel: DEFAULT_RYNE_MODEL,
      maxWords: STANDALONE_MAX_WORDS,
    });
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}
