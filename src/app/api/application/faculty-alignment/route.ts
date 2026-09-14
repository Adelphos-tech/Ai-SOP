/**
 * @file route.ts
 * @description
 * POST /api/application/faculty-alignment
 *
 * Approve or reject a faculty alignment proposal.
 *
 * The browser submits:
 *   - applicationIdentity
 *   - alignmentId
 *   - action: "approve" | "reject"
 *
 * Backend verifies:
 *   - The alignment proposal exists for this application identity
 *   - The proposal was created from verified official sources
 *   - Student interest evidence exists
 *   - The proposal is in PROPOSED status (not already approved/rejected)
 *
 * On approve → status = STUDENT_APPROVED, approvedAt = now
 * On reject → status = REJECTED, rejectedAt = now
 *
 * Security: The backend does NOT trust arbitrary faculty data
 * submitted by the browser. It only looks up the existing proposal
 * by alignmentId and verifies its provenance.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

const ARTIFACT_BASE = path.join(
  process.cwd(),
  "logs",
  "requirements",
  "ai-permitted-live-test"
);

interface FacultyAlignmentRequest {
  applicationIdentity: {
    university: string;
    department: string;
    program: string;
    degree: string;
    intake: string;
  };
  alignmentId: string;
  action: "approve" | "reject";
}

function errorResponse(status: number, reason: string) {
  return NextResponse.json({ success: false, reason }, { status });
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

    const body = (await req.json()) as FacultyAlignmentRequest;

    // ===== 1. Validate input =====
    if (!body.alignmentId || !body.action) {
      return errorResponse(400, "MISSING_FIELDS: alignmentId and action are required.");
    }
    if (!["approve", "reject"].includes(body.action)) {
      return errorResponse(400, "INVALID_ACTION: action must be 'approve' or 'reject'.");
    }

    // ===== 2. Validate application identity =====
    const ai = body.applicationIdentity;
    if (!ai || !ai.university || !ai.department || !ai.program || !ai.degree || !ai.intake) {
      return errorResponse(400, "INVALID_APPLICATION_IDENTITY: all identity fields are required.");
    }

    // ===== 3. Verify application identity matches the selected application =====
    if (
      ai.university !== "Massachusetts Institute of Technology" ||
      ai.department !== "Civil and Environmental Engineering" ||
      ai.program !== "Master of Engineering in Civil and Environmental Engineering" ||
      ai.degree !== "MEng" ||
      ai.intake !== "Fall 2027"
    ) {
      return errorResponse(403, "APPLICATION_IDENTITY_MISMATCH: this alignment API only serves the MIT CEE MEng Fall 2027 application.");
    }

    // ===== 4. Load proposals =====
    const proposalsPath = path.join(ARTIFACT_BASE, "faculty-alignment-proposals.json");
    let proposalsData: any;
    try {
      proposalsData = JSON.parse(await fs.readFile(proposalsPath, "utf-8"));
    } catch {
      return errorResponse(500, "PROPOSALS_NOT_FOUND: could not load faculty alignment proposals.");
    }

    // ===== 5. Find the proposal =====
    const proposal = proposalsData.proposals.find(
      (p: any) => p.alignmentId === body.alignmentId
    );
    if (!proposal) {
      return errorResponse(404, "PROPOSAL_NOT_FOUND: no faculty alignment proposal found for the given alignmentId.");
    }

    // ===== 6. Verify proposal provenance =====
    if (!proposal.officialProgramFactSource || proposal.officialProgramFactSource.length === 0) {
      return errorResponse(400, "UNVERIFIED_SOURCE: proposal lacks verified official faculty evidence.");
    }

    // Check that all sources are official MIT domains
    for (const srcId of proposal.officialProgramFactSource) {
      if (!srcId.startsWith("MIT-SRC-")) {
        return errorResponse(400, "UNVERIFIED_SOURCE: proposal includes a non-MIT source.");
      }
    }

    if (!proposal.studentInterestEvidence || proposal.studentInterestEvidence.length === 0) {
      return errorResponse(400, "NO_STUDENT_EVIDENCE: proposal lacks student interest evidence.");
    }

    // ===== 7. Check current status =====
    if (proposal.status !== "PROPOSED") {
      return errorResponse(409, `ALREADY_${proposal.status}: this proposal has already been ${proposal.status.toLowerCase()}.`);
    }

    // ===== 8. Update status =====
    const now = new Date().toISOString();
    if (body.action === "approve") {
      proposal.status = "STUDENT_APPROVED";
      proposal.approvedAt = now;
    } else {
      proposal.status = "REJECTED";
      proposal.rejectedAt = now;
    }

    // ===== 9. Persist =====
    await fs.writeFile(proposalsPath, JSON.stringify(proposalsData, null, 2));

    // ===== 10. Update gate result =====
    const gatePath = path.join(ARTIFACT_BASE, "faculty-alignment-gate-result.json");
    try {
      const gateData = JSON.parse(await fs.readFile(gatePath, "utf-8"));
      const gateProposal = gateData.facultyProposals.proposals.find(
        (p: any) => p.alignmentId === body.alignmentId
      );
      if (gateProposal) {
        gateProposal.status = proposal.status;
      }
      gateData.facultyProposals.proposed = gateData.facultyProposals.proposals.filter(
        (p: any) => p.status === "PROPOSED"
      ).length;
      gateData.facultyProposals.studentApproved = gateData.facultyProposals.proposals.filter(
        (p: any) => p.status === "STUDENT_APPROVED"
      ).length;
      gateData.facultyProposals.rejected = gateData.facultyProposals.proposals.filter(
        (p: any) => p.status === "REJECTED"
      ).length;

      // Re-evaluate the gate
      if (gateData.facultyProposals.studentApproved > 0) {
        gateData.generationContractGate.facultyRequirementSatisfied = true;
        gateData.generationContractGate.readyForGeneration = true;
        gateData.generationContractGate.blockingReason = null;
        gateData.gateStatus = "CLEARED";
      } else {
        gateData.generationContractGate.facultyRequirementSatisfied = false;
        gateData.generationContractGate.readyForGeneration = false;
        gateData.generationContractGate.blockingReason =
          "MISSING_REQUIRED_STUDENT_INFORMATION: No student-approved faculty alignment exists.";
        gateData.gateStatus = "BLOCKED";
      }

      await fs.writeFile(gatePath, JSON.stringify(gateData, null, 2));
    } catch {
      // Gate result update is best-effort
    }

    return NextResponse.json({
      success: true,
      alignmentId: proposal.alignmentId,
      facultyName: proposal.facultyName,
      status: proposal.status,
      timestamp: now,
    });
  } catch (e: any) {
    if (e instanceof AuthError) return authErrorResponse(e);
    console.error("[faculty-alignment]", e);
    return errorResponse(500, "INTERNAL_ERROR");
  }
}
