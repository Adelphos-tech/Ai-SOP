// ============================================================
// GET/PUT /api/application/profile
// Phase SOP-AI-30
// ============================================================
// GET: Load student profile from server (includes _revision)
// PUT: Save student profile to server (conditional on revision)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getStudent,
  getStudentProfile,
  getStudentProfileRevision,
  saveStudentProfile,
  saveStudentProfileConditional,
  getApplication,
  saveApplicationContext,
} from "@/lib/application/application-repository";
import {
  resolveApplicationContext,
  extractApplicationScopeFields,
  stripApplicationScopeFields,
  buildContextDataForSave,
} from "@/lib/application/application-context";
import { getProfileReadiness } from "@/lib/application/intake-completion";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function GET(request: NextRequest) {
  try {
    // Auth
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    const applicationId = searchParams.get("applicationId");

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    await authorizeStudentAccess(consultant, studentId);

    const student = await getStudent(studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const profile = await getStudentProfile(studentId);
    const revision = await getStudentProfileRevision(studentId);

    // Application-aware read: resolve the effective intake profile —
    // student-scope keys from students.profile_data, application-scope
    // keys from THIS application's context (v2) or the shared legacy
    // fallback (v1).
    if (applicationId) {
      const application = await getApplication(applicationId);
      if (!application || application.studentId !== studentId) {
        return NextResponse.json({ error: "Application not found" }, { status: 404 });
      }
      const resolved = resolveApplicationContext(application, profile || {});
      return NextResponse.json({
        student,
        profile: resolved.profile,
        hasServerProfile: profile !== null,
        revision,
        applicationContextId: application.id,
        applicationContextVersion: application.applicationContextVersion ?? 1,
        applicationContextSource: resolved.applicationContextSource,
        crossApplicationFallbackUsed: resolved.crossApplicationFallbackUsed,
      });
    }

    return NextResponse.json({
      student,
      profile,
      hasServerProfile: profile !== null,
      revision,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Profile load error:", error);
    return NextResponse.json(
      { error: "Failed to load profile.", code: "PROFILE_LOAD_FAILED" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Auth
    let consultant;
    try {
      consultant = await requireConsultantSession(request);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const body = await request.json();

    if (!body.studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }
    if (!body.profileData) {
      return NextResponse.json({ error: "profileData is required" }, { status: 400 });
    }

    await authorizeStudentAccess(consultant, body.studentId);

    // Validate student exists
    const student = await getStudent(body.studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Application-aware save: the intake page is per-application, so when
    // applicationId is present the submitted profile is SPLIT by scope —
    // student facts → students.profile_data (revision-conditional),
    // application context → applications.context_data (auto-migrating a
    // LEGACY app to APP_SCOPED with a LEGACY_SHARED seed). App-scope keys
    // already in profile_data are preserved untouched so other LEGACY
    // applications keep their fallback.
    const application = body.applicationId
      ? await getApplication(body.applicationId)
      : null;
    if (body.applicationId && (!application || application.studentId !== body.studentId)) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    const studentScopeFields = application
      ? stripApplicationScopeFields(body.profileData)
      : body.profileData;
    const appScopeFields = application
      ? extractApplicationScopeFields(body.profileData)
      : {};

    let savedContextData: ReturnType<typeof buildContextDataForSave> | null = null;

    // Conditional save: if expectedRevision provided, use conditional write
    if (typeof body.expectedRevision === "number") {
      // An explicit profile save IS the deliberate Student Details edit —
      // sync the students row identity from personalData atomically.
      const pd = body.profileData?.personalData || {};
      // For app-aware saves, merge student-scope fields over the CURRENT
      // profile so shared app-scope residue stays untouched.
      let profileToSave = studentScopeFields;
      if (application) {
        const existing = (await getStudentProfile(body.studentId)) || {};
        profileToSave = { ...existing, ...studentScopeFields };
      }
      const saved = await saveStudentProfileConditional(
        body.studentId,
        profileToSave,
        body.expectedRevision,
        { firstName: pd.firstName, lastName: pd.lastName, email: pd.email },
      );
      if (!saved) {
        return NextResponse.json(
          { error: "Profile was modified by another session. Please refresh and retry.", code: "PROFILE_CHANGED" },
          { status: 409 },
        );
      }
      if (application) {
        savedContextData = buildContextDataForSave(
          application,
          appScopeFields,
          profileToSave,
        );
        await saveApplicationContext(application.id, savedContextData);
      }
      const newRevision = await getStudentProfileRevision(body.studentId);
      // Canonical readiness from the SAVED row — never the request body.
      const savedProfile = await getStudentProfile(body.studentId);
      const readiness = getProfileReadiness(
        application
          ? resolveApplicationContext(
              { ...application, applicationContextVersion: 2, contextData: savedContextData },
              savedProfile,
            ).profile
          : savedProfile,
        application || undefined,
      );
      return NextResponse.json({
        success: true,
        revision: newRevision,
        applicationContextId: application?.id,
        applicationContextVersion: application ? 2 : undefined,
        readiness: {
          complete: readiness.canGenerate,
          missingSections: readiness.weakAreas,
          missingCount: readiness.weakAreas.length,
        },
      });
    }

    // Non-conditional save (backward compatible) — increment revision
    const currentRev = await getStudentProfileRevision(body.studentId);
    let profileToSave = { ...studentScopeFields, _revision: currentRev + 1 };
    if (application) {
      const existing = (await getStudentProfile(body.studentId)) || {};
      profileToSave = { ...existing, ...profileToSave };
      savedContextData = buildContextDataForSave(application, appScopeFields, profileToSave);
    }
    await saveStudentProfile(body.studentId, profileToSave);
    if (application && savedContextData) {
      await saveApplicationContext(application.id, savedContextData);
    }

    const savedProfile = await getStudentProfile(body.studentId);
    const readiness = getProfileReadiness(
      application
        ? resolveApplicationContext(
            { ...application, applicationContextVersion: 2, contextData: savedContextData },
            savedProfile,
          ).profile
        : savedProfile,
      application || undefined,
    );
    return NextResponse.json({
      success: true,
      revision: currentRev + 1,
      applicationContextId: application?.id,
      applicationContextVersion: application ? 2 : undefined,
      readiness: {
        complete: readiness.canGenerate,
        missingSections: readiness.weakAreas,
        missingCount: readiness.weakAreas.length,
      },
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("Profile save error:", error);
    return NextResponse.json(
      { error: "Failed to save profile.", code: "PROFILE_SAVE_FAILED" },
      { status: 500 },
    );
  }
}
