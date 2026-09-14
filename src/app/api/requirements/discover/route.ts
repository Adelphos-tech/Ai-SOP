/**
 * @file route.ts
 * @description
 * POST /api/requirements/discover
 *
 * Official requirements discovery endpoint.
 * Performs automatic discovery of official application requirements
 * from university sources.
 *
 * This endpoint performs DISCOVERY ONLY.
 * It does NOT generate an SOP.
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverRequirements } from "@/lib/requirements/discovery-pipeline";
import { ApplicationDiscoveryInput } from "@/lib/requirements/discovery-types";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";
import { ResourceBusyError } from "@/lib/concurrency/resource-limiter";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json() as ApplicationDiscoveryInput;

    if (!body.university || !body.program || !body.country) {
      return NextResponse.json(
        { error: "university, program, and country are required" },
        { status: 400 }
      );
    }

    const result = await discoverRequirements(body);

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: error.message, code: "CRAWL_BUSY" },
        { status: 503 },
      );
    }
    console.error("Discovery error:", error?.message);
    return NextResponse.json(
      { error: error?.message || "Discovery failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Official requirements discovery endpoint. Use POST with application identity.",
  });
}
