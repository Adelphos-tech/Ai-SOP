// ============================================================
// POST /api/requirements/resolve-prompt
// Phase SOP-AI-32
// ============================================================
// Implements the full prompt resolution decision tree:
//
//   1. Did consultant/user provide a prompt?
//      → YES: use it (USER_PROVIDED_PORTAL_PROMPT or CONSULTANT_PROVIDED)
//      → NO:  continue
//
//   2. Check D-Vivid Requirements DB
//      → Already saved + fresh?
//        → YES: reuse (OFFICIAL_VERIFIED)
//        → NO:  continue
//
//   3. Crawl OFFICIAL university/program pages (discovery)
//      → Found useful info?
//        → YES: verify + save to DB → use for generation (OFFICIAL_VERIFIED)
//        → NO:  continue
//
//   4. DVIVID_DEFAULT_TEMPLATE for that document type
//      → Use default template → Generate
//
// This endpoint does NOT generate an SOP.
// It resolves the prompt source and returns the resolved prompt data.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  DocumentType,
  PromptSource,
  isValidDocumentType,
  isValidPromptSource,
} from "@/lib/application/application-types";
import { findRequirementSetByAppIdentity } from "@/lib/application/requirements-repository";
import { getDefaultTemplate } from "@/lib/application/default-templates";
import { RequirementLookupRequest } from "@/lib/application/requirements-types";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 120;

interface ResolvePromptRequest {
  // Application identity
  university: string;
  program: string;
  degree: string;
  intake: string;
  intakeYear: string;
  country?: string;

  // Document type to resolve
  documentType: string;

  // Did the user provide a manual prompt?
  manualPrompt?: string;
  manualPromptSource?: PromptSource; // USER_PROVIDED_PORTAL_PROMPT or CONSULTANT_PROVIDED

  // Whether to attempt discovery if DB miss
  attemptDiscovery?: boolean;
}

interface ResolvedPrompt {
  source: PromptSource;
  promptText: string;
  documentType: DocumentType;
  documentTitle?: string;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  specialInstructions?: string;
  facultyInstructions?: string;
  formattingInstructions?: string;
  writingRequirementId?: string;
  requirementSetId?: string;
  // How the prompt was resolved
  resolutionPath: "MANUAL" | "DB_REUSED" | "DISCOVERY_SAVED" | "DEFAULT_TEMPLATE";
  // Discovery info (if discovery was attempted)
  discoveryAttempted?: boolean;
  discoveryStatus?: string;
  discoveryError?: string;
}

export async function POST(req: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json() as ResolvePromptRequest;

    // Validate required fields
    if (!body.university || !body.program || !body.degree || !body.intake || !body.intakeYear) {
      return NextResponse.json(
        { error: "university, program, degree, intake, and intakeYear are required" },
        { status: 400 },
      );
    }

    if (!body.documentType || !isValidDocumentType(body.documentType)) {
      return NextResponse.json(
        { error: `Invalid or missing documentType: ${body.documentType}` },
        { status: 400 },
      );
    }

    const documentType = body.documentType as DocumentType;

    // ============================================================
    // STEP 1: Did consultant/user provide a prompt?
    // ============================================================
    if (body.manualPrompt && body.manualPrompt.trim().length > 0) {
      const source = body.manualPromptSource || "CONSULTANT_PROVIDED";
      if (!isValidPromptSource(source) || source === "OFFICIAL_VERIFIED" || source === "DVIVID_DEFAULT_TEMPLATE") {
        return NextResponse.json(
          { error: `Invalid manual prompt source: ${source}. Must be USER_PROVIDED_PORTAL_PROMPT, CONSULTANT_PROVIDED, or CUSTOM.` },
          { status: 400 },
        );
      }

      const resolved: ResolvedPrompt = {
        source,
        promptText: body.manualPrompt,
        documentType,
        resolutionPath: "MANUAL",
      };
      return NextResponse.json({ resolved: resolved });
    }

    // ============================================================
    // STEP 2: Check D-Vivid Requirements DB
    // ============================================================
    const lookupReq: RequirementLookupRequest = {
      university: body.university,
      program: body.program,
      degree: body.degree,
      intake: body.intake,
      intakeYear: body.intakeYear,
    };

    const dbResult = await findRequirementSetByAppIdentity(lookupReq);

    if (dbResult.result === "EXACT_FRESH_MATCH" && dbResult.writingRequirements) {
      // Find a writing requirement matching the requested document type
      const matchingWR = dbResult.writingRequirements.find(
        wr => wr.documentType === documentType,
      );

      if (matchingWR) {
        const resolved: ResolvedPrompt = {
          source: "OFFICIAL_VERIFIED",
          promptText: matchingWR.promptText,
          documentType,
          documentTitle: matchingWR.officialTitle,
          wordMin: matchingWR.wordMin || undefined,
          wordMax: matchingWR.wordMax || undefined,
          characterLimit: matchingWR.characterLimit || undefined,
          pageLimit: matchingWR.pageLimit || undefined,
          specialInstructions: matchingWR.specialInstructions || undefined,
          facultyInstructions: matchingWR.facultyInstructions || undefined,
          formattingInstructions: matchingWR.formattingInstructions || undefined,
          writingRequirementId: matchingWR.id,
          requirementSetId: dbResult.requirementSet?.id,
          resolutionPath: "DB_REUSED",
        };
        return NextResponse.json({ resolved: resolved });
      }
    }

    // ============================================================
    // STEP 3: Crawl OFFICIAL university/program pages (discovery)
    // ============================================================
    if (body.attemptDiscovery !== false) {
      try {
        const { discoverRequirements } = await import("@/lib/requirements/discovery-pipeline");
        const discoveryInput = {
          university: body.university,
          program: body.program,
          degree: body.degree,
          intake: body.intake,
          intakeYear: body.intakeYear,
          country: body.country || "USA",
        };

        const discoveryResult = await discoverRequirements(discoveryInput);

        if (discoveryResult.status === "VERIFIED" && discoveryResult.context) {
          // Discovery found useful information — save to DB and use
          const { saveDiscoveredRequirementSet } = await import("@/lib/application/context-mapper");
          const { listWritingRequirements, getRequirementSet } = await import("@/lib/application/requirements-repository");
          const saved = await saveDiscoveredRequirementSet(discoveryResult.context);
          const savedReqSet = await getRequirementSet(saved.requirementSetId);
          const savedWRs = await listWritingRequirements(saved.requirementSetId);

          // Find matching writing requirement from saved data
          const matchingWR = savedWRs.find(
            wr => wr.documentType === documentType,
          );

          if (matchingWR) {
            const resolved: ResolvedPrompt = {
              source: "OFFICIAL_VERIFIED",
              promptText: matchingWR.promptText,
              documentType,
              documentTitle: matchingWR.officialTitle,
              wordMin: matchingWR.wordMin || undefined,
              wordMax: matchingWR.wordMax || undefined,
              characterLimit: matchingWR.characterLimit || undefined,
              pageLimit: matchingWR.pageLimit || undefined,
              specialInstructions: matchingWR.specialInstructions || undefined,
              facultyInstructions: matchingWR.facultyInstructions || undefined,
              formattingInstructions: matchingWR.formattingInstructions || undefined,
              writingRequirementId: matchingWR.id,
              requirementSetId: saved.requirementSetId,
              resolutionPath: "DISCOVERY_SAVED",
              discoveryAttempted: true,
              discoveryStatus: discoveryResult.status,
            };
            return NextResponse.json({ resolved: resolved });
          }
        }

        // Discovery attempted but no useful info found for this document type
        // Fall through to default template
        const template = getDefaultTemplate(documentType);
        const resolved: ResolvedPrompt = {
          source: "DVIVID_DEFAULT_TEMPLATE",
          promptText: template.promptText,
          documentType,
          documentTitle: template.label,
          wordMin: template.wordMin,
          wordMax: template.wordMax,
          pageLimit: template.pageLimit,
          specialInstructions: template.specialInstructions,
          formattingInstructions: template.formattingInstructions,
          resolutionPath: "DEFAULT_TEMPLATE",
          discoveryAttempted: true,
          discoveryStatus: discoveryResult.status,
          discoveryError: discoveryResult.error || undefined,
        };
        return NextResponse.json({ resolved: resolved });

      } catch (err: any) {
        // Discovery failed — fall through to default template
        const template = getDefaultTemplate(documentType);
        const resolved: ResolvedPrompt = {
          source: "DVIVID_DEFAULT_TEMPLATE",
          promptText: template.promptText,
          documentType,
          documentTitle: template.label,
          wordMin: template.wordMin,
          wordMax: template.wordMax,
          pageLimit: template.pageLimit,
          specialInstructions: template.specialInstructions,
          formattingInstructions: template.formattingInstructions,
          resolutionPath: "DEFAULT_TEMPLATE",
          discoveryAttempted: true,
          discoveryStatus: "DISCOVERY_ERROR",
          discoveryError: err?.message || "Discovery failed",
        };
        return NextResponse.json({ resolved: resolved });
      }
    }

    // ============================================================
    // STEP 4: DVIVID_DEFAULT_TEMPLATE
    // ============================================================
    const template = getDefaultTemplate(documentType);
    const resolved: ResolvedPrompt = {
      source: "DVIVID_DEFAULT_TEMPLATE",
      promptText: template.promptText,
      documentType,
      documentTitle: template.label,
      wordMin: template.wordMin,
      wordMax: template.wordMax,
      pageLimit: template.pageLimit,
      specialInstructions: template.specialInstructions,
      formattingInstructions: template.formattingInstructions,
      resolutionPath: "DEFAULT_TEMPLATE",
      discoveryAttempted: false,
    };
    return NextResponse.json({ resolved: resolved });

  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("resolve-prompt error:", error?.message);
    return NextResponse.json(
      { error: error?.message || "Failed to resolve prompt" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Prompt resolution endpoint. POST with application identity and document type to resolve the prompt source.",
    flow: [
      "1. Manual prompt? → USE IT (USER_PROVIDED_PORTAL_PROMPT or CONSULTANT_PROVIDED)",
      "2. Check D-Vivid Requirements DB → Already saved? → REUSE (OFFICIAL_VERIFIED)",
      "3. Crawl official pages → Found? → VERIFY + SAVE → USE (OFFICIAL_VERIFIED)",
      "4. No useful info? → DVIVID_DEFAULT_TEMPLATE",
    ],
  });
}
