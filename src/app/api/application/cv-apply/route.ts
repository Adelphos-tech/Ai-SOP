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
import { mergePersonalData } from "@/lib/application/cv-merge";
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
    const parsed = body.parsedCV;
    const overwrite = body.overwrite === true;

    const merged: any = { ...existingProfile };

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
    if (parsed.skills) {
      const existingSkills = merged.skills || {};
      merged.skills = {
        technical: mergeArrays(existingSkills.technical, parsed.skills.technical, overwrite),
        programming: mergeArrays(existingSkills.programming, parsed.skills.programming, overwrite),
        tools: mergeArrays(existingSkills.tools, parsed.skills.tools, overwrite),
        domain: mergeArrays(existingSkills.domain, parsed.skills.domain, overwrite),
        soft: mergeArrays(existingSkills.soft, parsed.skills.soft, overwrite),
        software: mergeArrays(existingSkills.software, parsed.skills.software, overwrite),
      };
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
          existingAch.push({ id: randomUUID(), type: pa.type, title: pa.title.trim(), description: "", year: "" });
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
    return NextResponse.json(
      { error: error?.message || "Failed to apply CV data." },
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

function mergeArrays(existing: string[] | undefined, parsed: string[] | undefined, overwrite: boolean): string[] {
  if (!parsed || parsed.length === 0) return existing || [];
  if (overwrite || !existing || existing.length === 0) return Array.from(new Set(parsed));
  return Array.from(new Set([...existing, ...parsed]));
}
