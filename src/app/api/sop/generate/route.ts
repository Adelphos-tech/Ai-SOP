/**
 * @file route.ts
 * @description
 * POST /api/sop/generate
 *
 * Phase SOP-AI-34B BUGFIX: Removed legacy verified-requirements blockers.
 * Phase SOP-INFRA-37: Removed HTTP self-fetch. Now calls the shared
 *   generateApplicationDocument() service function directly.
 *
 * LEGACY_COMPATIBILITY_ROUTE
 *   This route bridges the legacy browser-side StudentProfile to the
 *   persistent Student → Application → Document → Version architecture.
 *   New callers should use /api/application/document/generate directly.
 *
 * Current product rule:
 *   Prompt supplied → use prompt
 *   Otherwise → check D-Vivid requirements DB
 *   Otherwise → crawl official university/program pages
 *   Otherwise → DVIVID_DEFAULT_TEMPLATE
 *
 * Lack of VERIFIED requirements must NOT block generation.
 * Only Fact Sheet approval is a required pre-generation gate.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createStudent,
  getStudentByEmail,
  saveStudentProfile,
  createApplication,
  listStudentApplications,
  createDocument,
  listApplicationDocuments,
} from "@/lib/application/application-repository";
import { getDefaultTemplate } from "@/lib/application/default-templates";
import { DocumentType, PromptSource } from "@/lib/application/application-types";
import { generateApplicationDocument } from "@/lib/application/generation-service";
import { randomUUID } from "crypto";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    // ===== AUTH =====
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    // If the caller already wrapped the payload (benchmark/internal), pass through.
    if (body.profile?.personalDetails) {
      return NextResponse.json({
        error: "LEGACY_WRAPPED_FORMAT_UNSUPPORTED",
        message: "This endpoint now uses the persistent architecture. Use /api/application/document/generate directly.",
      }, { status: 400 });
    }

    // Bare profile (student-facing UI).
    const profile = body;

    if (!profile.personalDetails) {
      return NextResponse.json({ error: "PROFILE_REQUIRED" }, { status: 400 });
    }

    // ===== CHECK FACT SHEET APPROVAL (the ONLY pre-generation gate) =====
    if (!profile.factSheetApproval?.approved) {
      return NextResponse.json({
        error: "FACT_SHEET_NOT_APPROVED",
        message: "Please approve your fact sheet before generating.",
      }, { status: 403 });
    }

    // ===== CREATE OR FIND STUDENT =====
    const firstName = profile.personalDetails.firstName || "Student";
    const lastName = profile.personalDetails.lastName || "";
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@dvivid.student`.replace(/\s+/g, "");

    let student = await getStudentByEmail(email);
    if (!student) {
      student = await createStudent({
        firstName,
        lastName,
        email,
        phone: undefined,
        country: profile.personalDetails.currentCountry || undefined,
      });
    }

    // ===== SAVE STUDENT PROFILE DATA =====
    // Map the legacy profile to the persistent profile data format
    const profileData: Record<string, unknown> = {
      personalData: {
        firstName: profile.personalDetails.firstName,
        lastName: profile.personalDetails.lastName,
        middleName: profile.personalDetails.middleName || "",
        dateOfBirth: profile.personalDetails.dateOfBirth || "",
        gender: profile.personalDetails.gender || "",
        nationality: profile.personalDetails.nationality || "",
        currentCity: profile.personalDetails.currentCity || "",
        currentCountry: profile.personalDetails.currentCountry || "",
        languages: profile.personalDetails.languages || "",
      },
      education: (profile.education || []).map((e: any) => ({
        id: e.id,
        degree: e.degree || e.level || "",
        institution: e.institution || "",
        specialization: e.specialization || "",
        startYear: e.startYear || "",
        endYear: e.endYear || "",
        cgpa: e.cgpa || "",
        cgpaScale: e.cgpaScale || "10",
        percentage: e.percentage || "",
        level: e.level || "",
        status: e.endYear ? "Completed" : "Ongoing",
      })),
      experience: (profile.experience || []).map((e: any) => ({
        id: e.id,
        role: e.role || "",
        organization: e.organization || "",
        type: e.type || "",
        startDate: e.startDate || "",
        endDate: e.endDate || "",
        location: e.location || "",
        currentlyWorking: e.currentlyWorking || false,
        responsibilities: e.responsibilities || e.description || "",
        keyAchievements: e.keyAchievements || "",
        skillsLearned: e.skillsLearned || "",
      })),
      projects: (profile.projects || []).map((p: any) => ({
        id: p.id,
        name: p.name || "",
        type: p.type || "",
        description: p.description || "",
        technologies: p.technologies || p.techStack || "",
        studentRole: p.studentRole || p.role || "",
        outcome: p.outcome || "",
        whatLearned: p.whatLearned || "",
      })),
      careerGoals: {
        whyField: profile.careerGoals?.whyField || "",
        whyProgram: profile.careerGoals?.whyProgram || "",
        shortTermGoals: profile.careerGoals?.shortTermGoals || "",
        longTermGoals: profile.careerGoals?.longTermGoals || "",
        desiredRole: profile.careerGoals?.desiredRole || "",
        industries: profile.careerGoals?.industries || "",
        returnHomeCountry: profile.careerGoals?.returnHomeCountry || "",
        returnPlans: profile.careerGoals?.returnPlans || "",
      },
      personalStory: {
        motivation: profile.personalStory?.motivation || "",
        influencingExperience: profile.personalStory?.influencingExperience || "",
        challenges: profile.personalStory?.challenges || "",
        proudOf: profile.personalStory?.proudOf || "",
        qualities: profile.personalStory?.qualities || "",
        leadershipExample: profile.personalStory?.leadershipExample || "",
        teamworkExample: profile.personalStory?.teamworkExample || "",
        outsideAcademics: profile.personalStory?.outsideAcademics || "",
        communityService: profile.personalStory?.communityService || "",
        familyBackground: profile.personalStory?.familyBackground || "",
      },
      englishTesting: {
        testType: profile.englishProficiency?.testType || "",
        status: profile.englishProficiency?.status || "",
        overallScore: profile.englishProficiency?.overallScore || "",
        reading: profile.englishProficiency?.reading || "",
        writing: profile.englishProficiency?.writing || "",
        speaking: profile.englishProficiency?.speaking || "",
        listening: profile.englishProficiency?.listening || "",
      },
      writingPreferences: {
        level: profile.writingPreferences?.sopWritingProfile?.level || "Natural Professional",
        tone: profile.writingPreferences?.sopWritingProfile?.tone || "Professional & Personal",
        sopLength: profile.writingPreferences?.sopWritingProfile?.sopLength || "900-1100",
        openingStyle: profile.writingPreferences?.sopWritingProfile?.openingStyle || "Let AI Choose Best Opening",
        personalization: profile.writingPreferences?.sopWritingProfile?.personalization || "Balanced",
        technicalDetail: profile.writingPreferences?.sopWritingProfile?.technicalDetail || "Medium",
      },
      factSheetApproval: {
        approved: true,
        approvedAt: profile.factSheetApproval?.approvedAt || new Date().toISOString(),
      },
    };

    await saveStudentProfile(student.id, profileData);

    // ===== CREATE OR FIND APPLICATION =====
    const app = profile.application || {};
    const universityName = app.targetUniversity || "Unknown University";
    const programName = app.targetProgram || "Unknown Program";
    const degree = app.degreeLevel || "Master";
    const country = app.targetCountry || "Unknown";
    const intake = app.intake || "Fall";
    const intakeYear = app.intakeYear || new Date().getFullYear().toString();

    // Check if an application with the same details already exists
    const existingApps = await listStudentApplications(student.id);
    let application = existingApps.find(
      (a) =>
        a.universityName === universityName &&
        a.programName === programName &&
        a.intake === intake &&
        a.intakeYear === intakeYear,
    );

    if (!application) {
      application = await createApplication({
        studentId: student.id,
        universityName,
        programName,
        degree,
        country,
        intake,
        intakeYear,
      });
    }

    // ===== CREATE OR FIND SOP DOCUMENT =====
    const documentType: DocumentType = "STATEMENT_OF_PURPOSE";
    const existingDocs = await listApplicationDocuments(application.id);
    let document = existingDocs.find((d) => d.documentType === documentType);

    // Determine prompt source and text:
    // 1. Manual prompt (sopQuestion) → CONSULTANT_PROVIDED
    // 2. No manual prompt → DVIVID_DEFAULT_TEMPLATE
    const manualPrompt = (app.sopQuestion || "").trim();
    const defaultTemplate = getDefaultTemplate(documentType);

    let promptText: string;
    let promptSource: PromptSource;

    if (manualPrompt) {
      promptText = manualPrompt;
      promptSource = "CONSULTANT_PROVIDED";
    } else {
      promptText = defaultTemplate?.promptText || "Describe your academic background, research interests, and career goals. Explain why you are applying to this program and how it aligns with your future plans.";
      promptSource = "DVIVID_DEFAULT_TEMPLATE";
    }

    const wordMin = app.wordRequirement === "Known" && app.minWords ? parseInt(app.minWords, 10) : undefined;
    const wordMax = app.wordRequirement === "Known" && app.maxWords ? parseInt(app.maxWords, 10) : undefined;
    const characterLimit = app.maxCharacters ? parseInt(app.maxCharacters, 10) : undefined;

    if (!document) {
      if (promptSource === "DVIVID_DEFAULT_TEMPLATE") {
        // DVIVID_DEFAULT_TEMPLATE is server-controlled, insert directly
        const { getDbPool } = await import("@/lib/application/db");
        const pool = getDbPool();
        const { randomUUID } = await import("crypto");
        const docId = randomUUID();
        await pool.execute(
          `INSERT INTO application_documents (id, application_id, document_type, document_title, prompt_text, prompt_source, word_min, word_max, character_limit, requirements_status, generation_status, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', 'NOT_STARTED', 'DRAFT', NOW(), NOW())`,
          [docId, application.id, documentType, "Statement of Purpose", promptText, promptSource, wordMin || null, wordMax || null, characterLimit || null],
        );
        document = { id: docId, applicationId: application.id, documentType, documentTitle: "Statement of Purpose", promptText, promptSource, wordMin, wordMax, characterLimit } as any;
      } else {
        document = await createDocument({
          applicationId: application.id,
          documentType,
          documentTitle: "Statement of Purpose",
          promptText,
          promptSource,
          wordMin,
          wordMax,
          characterLimit,
        });
      }
    }

    const docId = document!.id;

    // ===== CALL THE SHARED GENERATION SERVICE =====
    // Phase SOP-INFRA-37: No HTTP self-fetch. Call the shared
    // generateApplicationDocument() function directly.
    const requestId = (req.headers.get("x-request-id") || randomUUID()) as string;

    const genResult = await generateApplicationDocument({
      studentId: student.id,
      applicationId: application.id,
      documentId: docId,
      requestId,
    });

    if (!genResult.ok) {
      return NextResponse.json(genResult.body, { status: genResult.status });
    }

    // ===== RETURN RESULT WITH WORKSPACE URL =====
    const workspaceUrl = `/students/${student.id}/applications/${application.id}/documents/${docId}`;

    return NextResponse.json({
      ...genResult.body,
      workspaceUrl,
      studentId: student.id,
      applicationId: application.id,
      documentId: docId,
    });

  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("SOP generation bridge error:", error);
    // Sanitize error — do not expose internal paths, ports, or stack traces
    const safeMessage = (error?.message || "An unexpected error occurred during generation.")
      .replace(/127\.0\.0\.1:\d+/g, "[internal]")
      .replace(/localhost:\d+/g, "[internal]")
      .replace(/\/opt\/[^\s'"]+/g, "[path]")
      .replace(/ERR_SSL_\w+/g, "[ssl-error]")
      .substring(0, 500);
    return NextResponse.json(
      { error: safeMessage },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "SOP generation endpoint (bridged to persistent architecture). POST with profile to generate.",
  });
}
