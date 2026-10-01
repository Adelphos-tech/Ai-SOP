// ============================================================
// POST /api/application/cv-apply
// ============================================================
// Merges parsed CV data into the student profile.
//
// Security:
//   - Requires authenticated consultant session
//   - Authorizes student access
//   - Optimistic concurrency: requires profileRevision from parse time
//   - Returns 409 PROFILE_CHANGED if profile was modified after parse
//   - Only fills empty fields (merge mode) unless overwrite: true
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getStudent,
  getStudentProfile,
  getStudentProfileRevision,
  saveStudentProfileConditional,
} from "@/lib/application/application-repository";
import { randomUUID } from "crypto";
import { mergePersonalData, mergeCvSkills, removeCvDerivedSkills } from "@/lib/application/cv-merge";
import { emitEvent } from "@/lib/observability/events";
import { classifyIdentityMatch } from "@/lib/application/identity-check";
import { getProfileReadiness } from "@/lib/application/intake-completion";
import {
  requireConsultantSession,
  authorizeStudentAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function POST(request: NextRequest) {
  try {
    // ===== AUTH =====
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
    if (!body.parsedCV) {
      return NextResponse.json({ error: "parsedCV is required" }, { status: 400 });
    }

    // ===== AUTHORIZATION =====
    await authorizeStudentAccess(consultant, body.studentId);

    const student = await getStudent(body.studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // ===== IDENTITY CHECK =====
    // Compare the CV's identity evidence against the students ROW
    // (first_name/last_name/email) — NOT profile_data.personalData,
    // which a previous wrong-person apply may have corrupted.
    // A CONFLICT must never silently merge into the canonical profile.
    const identity = classifyIdentityMatch(student, body.parsedCV?.personalData);
    if (identity.status === "CONFLICT") {
      if (body.identityConflictOverride !== true) {
        return NextResponse.json(
          {
            error: `The uploaded CV appears to belong to ${identity.cvIdentity.name || "a different person"}${identity.cvIdentity.email ? ` (${identity.cvIdentity.email})` : ""}, while the selected student is ${identity.studentIdentity.name || "unknown"}${identity.studentIdentity.email ? ` (${identity.studentIdentity.email})` : ""}. Please verify the student or choose another CV.`,
            code: "CV_IDENTITY_CONFLICT",
            identityStatus: identity.status,
            studentIdentity: identity.studentIdentity,
            cvIdentity: identity.cvIdentity,
          },
          { status: 409 },
        );
      }
      // Explicit consultant override — audit metadata only: ids and
      // counts, never names/emails (PII).
      emitEvent("cv_identity_conflict_override", {
        studentId: body.studentId,
        actorId: consultant.id,
        status: identity.status,
      }, "warn");
    }

    // ===== OPTIMISTIC CONCURRENCY CHECK =====
    // The client must send profileRevision from when the CV was parsed.
    // If the profile changed since then, reject with 409.
    const expectedRevision = typeof body.profileRevision === "number" ? body.profileRevision : null;
    if (expectedRevision === null) {
      return NextResponse.json(
        { error: "profileRevision is required (from CV parse response).", code: "MISSING_REVISION" },
        { status: 400 },
      );
    }

    const currentRevision = await getStudentProfileRevision(body.studentId);
    if (currentRevision !== expectedRevision) {
      return NextResponse.json(
        {
          error: "The student profile changed after this CV was parsed. Review the latest information before importing.",
          code: "PROFILE_CHANGED",
          currentRevision,
          expectedRevision,
        },
        { status: 409 },
      );
    }

    // ===== MERGE =====
    const existingProfile = await getStudentProfile(body.studentId) || {};
    // Stable identity for THIS apply — any skills it writes carry this
    // importId in skillProvenance so a later replaceCvDerived can
    // remove exactly them without touching manual entries.
    const cvImportId = `cv-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const parsed = body.parsedCV;
    const overwrite = body.overwrite === true;

    const merged: any = { ...existingProfile };

    // ===== REPLACE-PREVIOUS-CV-IMPORT MODE =====
    // Removes items provably imported by a prior CV apply (id "cv-*")
    // BEFORE merging the new CV. Manual and unknown-provenance entries
    // are always preserved — this mode repairs a corrupted profile
    // (e.g. a wrong-person CV applied earlier) without destroying
    // consultant-entered data. Skills are removed via skillProvenance
    // (cv-* importId), so prior-CV skills do not linger.
    if (body.replaceCvDerived === true) {
      for (const key of ["education", "experience", "projects", "achievements"] as const) {
        if (Array.isArray(merged[key])) {
          merged[key] = merged[key].filter(
            (item: any) => !String(item?.id ?? "").startsWith("cv-"),
          );
        }
      }
      // Skills: drop only entries whose provenance importId is cv-*.
      // Skills with no provenance record are treated as manual and kept.
      merged.skills = removeCvDerivedSkills(merged.skills, existingProfile.skillProvenance as any);
      emitEvent("cv_replace_derived", {
        studentId: body.studentId,
        actorId: consultant.id,
        removedCvItems:
          (existingProfile.education || []).length - merged.education.length +
          (existingProfile.experience || []).length - merged.experience.length +
          (existingProfile.projects || []).length - merged.projects.length +
          (existingProfile.achievements || []).length - merged.achievements.length,
      }, "warn");
    }

    // ===== Personal Data =====
    merged.personalData = mergePersonalData(merged.personalData, parsed.personalData, overwrite);

    // ===== Education =====
    if (Array.isArray(parsed.education) && parsed.education.length > 0) {
      const existingEdu = merged.education || [];
      if (overwrite || existingEdu.length === 0) {
        merged.education = parsed.education.map((e: any) => ({
          id: e.id || randomUUID(),
          level: mapDegreeToLevel(e.degree),
          institution: e.institution || "",
          degree: e.degree || "",
          specialization: e.specialization || "",
          startYear: e.startYear || "",
          endYear: e.endYear || "",
          cgpa: e.cgpa || "",
          cgpaScale: e.cgpaScale || "10",
          percentage: "",
          backlogs: "",
          status: e.endYear ? "Completed" : "Ongoing",
        }));
      } else {
        for (const newEdu of parsed.education) {
          const isDuplicate = existingEdu.some((e: any) =>
            e.institution?.toLowerCase() === newEdu.institution?.toLowerCase() &&
            e.degree?.toLowerCase() === newEdu.degree?.toLowerCase()
          );
          if (!isDuplicate) {
            existingEdu.push({
              id: newEdu.id || randomUUID(),
              level: mapDegreeToLevel(newEdu.degree),
              institution: newEdu.institution || "",
              degree: newEdu.degree || "",
              specialization: newEdu.specialization || "",
              startYear: newEdu.startYear || "",
              endYear: newEdu.endYear || "",
              cgpa: newEdu.cgpa || "",
              cgpaScale: newEdu.cgpaScale || "10",
              percentage: "",
              backlogs: "",
              status: newEdu.endYear ? "Completed" : "Ongoing",
            });
          }
        }
        merged.education = existingEdu;
      }
    }

    // ===== Experience =====
    if (Array.isArray(parsed.experience) && parsed.experience.length > 0) {
      const existingExp = merged.experience || [];
      if (overwrite || existingExp.length === 0) {
        merged.experience = parsed.experience.map((e: any) => ({
          id: e.id || randomUUID(),
          type: e.type || "Full-time Job",
          organization: e.organization || "",
          role: e.role || "",
          location: e.location || "",
          startDate: e.startDate || "",
          endDate: e.endDate || "",
          currentlyWorking: e.currentlyWorking || false,
          responsibilities: e.responsibilities || "",
          achievements: "",
          skillsUsed: "",
          keyLearning: "",
          relevanceToMasters: "",
        }));
      } else {
        for (const newExp of parsed.experience) {
          const isDuplicate = existingExp.some((e: any) =>
            e.organization?.toLowerCase() === newExp.organization?.toLowerCase() &&
            e.role?.toLowerCase() === newExp.role?.toLowerCase()
          );
          if (!isDuplicate) {
            existingExp.push({
              id: newExp.id || randomUUID(),
              type: newExp.type || "Full-time Job",
              organization: newExp.organization || "",
              role: newExp.role || "",
              location: newExp.location || "",
              startDate: newExp.startDate || "",
              endDate: newExp.endDate || "",
              currentlyWorking: newExp.currentlyWorking || false,
              responsibilities: newExp.responsibilities || "",
              achievements: "",
              skillsUsed: "",
              keyLearning: "",
              relevanceToMasters: "",
            });
          }
        }
        merged.experience = existingExp;
      }
    }

    // ===== Projects =====
    if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
      const existingProj = merged.projects || [];
      if (overwrite || existingProj.length === 0) {
        merged.projects = parsed.projects.map((p: any) => ({
          id: p.id || randomUUID(),
          name: p.name || "",
          type: p.type || "Academic",
          description: p.description || "",
          role: p.role || "",
          technologies: p.technologies || "",
          outcome: "",
          whatLearned: "",
        }));
      } else {
        for (const newProj of parsed.projects) {
          const isDuplicate = existingProj.some((p: any) =>
            p.name?.toLowerCase() === newProj.name?.toLowerCase()
          );
          if (!isDuplicate) {
            existingProj.push({
              id: newProj.id || randomUUID(),
              name: newProj.name || "",
              type: newProj.type || "Academic",
              description: newProj.description || "",
              role: newProj.role || "",
              technologies: newProj.technologies || "",
              outcome: "",
              whatLearned: "",
            });
          }
        }
        merged.projects = existingProj;
      }
    }

    // ===== Skills =====
    // Canonical shape stays string[]. Provenance lives beside it:
    //   profile.skillProvenance[category][normalizedSkill] = importId
    // importId is "cv-..." for CV-applied entries; absence = manual.
    // Dedupe normalizes case/trim/whitespace only — "C"/"C++"/".NET"
    // remain distinct.
    if (parsed.skills) {
      const sm = mergeCvSkills(merged.skills, existingProfile.skillProvenance as any, parsed.skills, {
        overwrite, importId: cvImportId,
      });
      merged.skills = sm.skills;
      merged.skillProvenance = sm.skillProvenance;
    }

    // ===== Achievements + Certifications → canonical achievements[] =====
    // Certifications map to type "Certification"; explicit awards/honors
    // sections map to "Award". Append + dedupe by title; manual entries
    // are never overwritten.
    const parsedAchievements: Array<{ type: string; title: string }> = [
      ...(Array.isArray(parsed.certifications) ? parsed.certifications : [])
        .map((c: string) => ({ type: "Certification", title: c })),
      ...(Array.isArray(parsed.achievements) ? parsed.achievements : [])
        .map((a: string) => ({ type: "Award", title: a })),
    ].filter(a => typeof a.title === "string" && a.title.trim().length > 0);
    if (parsedAchievements.length > 0) {
      const existingAch = merged.achievements || [];
      const existingTitles = new Set(existingAch.map((a: any) => (a.title || "").trim().toLowerCase()));
      for (const pa of parsedAchievements) {
        const key = pa.title.trim().toLowerCase();
        if (!existingTitles.has(key)) {
          existingAch.push({ id: `cv-${randomUUID()}`, type: pa.type, title: pa.title.trim(), description: "", year: "" });
          existingTitles.add(key);
        }
      }
      merged.achievements = existingAch;
    }

    // ===== CONDITIONAL SAVE (optimistic concurrency) =====
    const saved = await saveStudentProfileConditional(body.studentId, merged, expectedRevision);
    if (!saved) {
      // Race: profile changed between our check and save
      return NextResponse.json(
        {
          error: "The student profile changed after this CV was parsed. Review the latest information before importing.",
          code: "PROFILE_CHANGED",
        },
        { status: 409 },
      );
    }

    const newRevision = await getStudentProfileRevision(body.studentId);

    // Return canonical readiness computed from the SAVED profile —
    // callers never re-derive it from request bodies.
    const savedProfile = await getStudentProfile(body.studentId);
    const readiness = getProfileReadiness(savedProfile);

    return NextResponse.json({
      success: true,
      readiness: {
        complete: readiness.canGenerate,
        missingSections: readiness.weakAreas,
        missingCount: readiness.weakAreas.length,
      },
      appliedFields: {
        personalData: !!(parsed.personalData?.firstName || parsed.personalData?.email),
        education: (parsed.education || []).length,
        experience: (parsed.experience || []).length,
        projects: (parsed.projects || []).length,
        skills: Object.values(parsed.skills || {}).flat().length,
        achievements: parsedAchievements.length,
      },
      revision: newRevision,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("CV apply error:", error);
    // Stable code + safe copy — raw DB/Zod detail stays in server logs.
    return NextResponse.json(
      { error: "Failed to apply CV data.", code: "CV_APPLY_FAILED" },
      { status: 500 },
    );
  }
}

function mapDegreeToLevel(degree: string): string {
  if (!degree) return "";
  const d = degree.toLowerCase();
  if (d.includes("phd") || d.includes("doctorate")) return "PhD";
  if (d.includes("m.tech") || d.includes("mtech") || d.includes("m.e") || d.includes("master")) return "Master's";
  if (d.includes("b.tech") || d.includes("btech") || d.includes("b.e") || d.includes("bachelor")) return "Bachelor's";
  if (d.includes("diploma")) return "Diploma";
  if (d.includes("12th") || d.includes("senior secondary") || d.includes("higher secondary")) return "12th";
  if (d.includes("10th") || d.includes("secondary") || d.includes("sslc") || d.includes("ssc")) return "10th";
  return "";
}

// Skills merge/provenance helpers live in @/lib/application/cv-merge
// (mergeCvSkills, removeCvDerivedSkills, normSkill).
