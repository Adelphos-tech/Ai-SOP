// ============================================================
// APPLICATION-SCOPED INTAKE CONTEXT
// ============================================================
// Fixes cross-application contamination: application-specific
// intake fields (motivation, country questions, career goals,
// program requirements) were stored in shared students.profile_data,
// so Application B's save overwrote Application A's values.
//
// Scope map (domain meaning, not storage convenience):
//   STUDENT_SCOPE     — reusable facts (personalData, education,
//                       experience, projects, subjects, skills,
//                       achievements, research, publications,
//                       noWorkExperience, personalStory, preferences,
//                       writingPreferences, englishTesting,
//                       factSheetApproval, projectClarifications,
//                       + any unknown passthrough key)
//   APPLICATION_SCOPE — per-application context, stored in
//                       applications.context_data (this file's keys)
//   DOCUMENT_SCOPE    — per-document requirements, already owned by
//                       application_documents columns (unchanged)
//
// Version cutover (applications.application_context_version):
//   1 LEGACY    — app-scope reads fall back to shared profile_data
//                 (identical to pre-migration behavior)
//   2 APP_SCOPED— reads context_data only; no shared fallback;
//                 intake writes never touch shared app-scope keys
// ============================================================

/**
 * Intake profile keys that belong to one application only.
 * `application` is the legacy StudentProfile blob written by the old
 * /api/sop/generate path (targetUniversity, sopQuestion, …) — it is
 * application-specific domain data even though it lived in the shared
 * profile.
 */
export const APPLICATION_SCOPE_FIELDS = [
  "fieldMotivation",
  "mastersMotivation",
  "countryQuestionnaire",
  "careerGoals",
  "subjectRequirements",
  "universityRequirements",
  "application",
] as const;

export type ApplicationScopeField = (typeof APPLICATION_SCOPE_FIELDS)[number];

/**
 * Documented student-scope keys. Resolution treats every key NOT in
 * APPLICATION_SCOPE_FIELDS as student scope, so this list is reference
 * documentation for auditors — the complement rule is authoritative.
 */
export const STUDENT_SCOPE_FIELDS = [
  "personalData", "personalDetails", "education", "englishTesting",
  "englishProficiency", "experience", "projects", "subjects", "skills",
  "achievements", "research", "publications", "noWorkExperience",
  "personalStory", "stories", "preferences", "writingPreferences",
  "factSheetApproval", "projectClarifications",
] as const;

export const DOCUMENT_SCOPE_FIELDS = [
  "promptText", "promptSource", "wordMin", "wordMax", "characterLimit",
  "pageLimit", "specialInstructions", "facultyInstructions",
  "formattingInstructions", "mandatoryTopics", "additionalQuestions",
] as const;

export const APPLICATION_CONTEXT_VERSION = {
  LEGACY: 1,
  APP_SCOPED: 2,
} as const;

export type ContextFieldSource =
  | "APPLICATION_EXPLICIT"   // entered/edited for this application
  | "LEGACY_SHARED"          // seeded from shared profile_data during migration
  | "VERIFIED_REQUIREMENT"   // reserved: officially verified requirement values
  | "DEFAULT";               // reserved: template defaults

export interface ApplicationContextData {
  fields: Record<string, unknown>;
  provenance: Record<string, ContextFieldSource>;
  seededAt?: string;
  updatedAt?: string;
}

export type ApplicationContextSource =
  | "APPLICATION_CONTEXT"       // version 2 — applications.context_data
  | "LEGACY_SHARED_PROFILE";    // version 1 — shared students.profile_data

export interface ResolvedApplicationContext {
  /** Effective profile: student-scope keys + this application's app-scope keys. */
  profile: any;
  applicationContextSource: ApplicationContextSource;
  /** True when app-scope values came from the shared student profile
   *  (legacy fallback — the value may have been written by ANOTHER
   *  application's intake save). False for scoped applications. */
  crossApplicationFallbackUsed: boolean;
  provenance: Record<string, ContextFieldSource>;
}

function isAppScopeKey(key: string): boolean {
  return (APPLICATION_SCOPE_FIELDS as readonly string[]).includes(key);
}

/** Deterministic serialization — object keys sorted recursively so
 *  value equality is immune to DB JSON key normalization. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys
    .map(k => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`)
    .join(",")}}`;
}

/** Extract only the application-scope keys from a profile blob. */
export function extractApplicationScopeFields(profile: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!profile || typeof profile !== "object") return out;
  for (const k of APPLICATION_SCOPE_FIELDS) {
    if (profile[k] !== undefined) out[k] = profile[k];
  }
  return out;
}

/** Return a profile with all application-scope keys removed. */
export function stripApplicationScopeFields(profile: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!profile || typeof profile !== "object") return out;
  for (const [k, v] of Object.entries(profile)) {
    if (!isAppScopeKey(k)) out[k] = v;
  }
  return out;
}

/** Parse the applications.context_data JSON column. */
export function parseContextData(raw: unknown): ApplicationContextData | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    return {
      fields: (obj as any).fields && typeof (obj as any).fields === "object" ? (obj as any).fields : {},
      provenance: (obj as any).provenance && typeof (obj as any).provenance === "object" ? (obj as any).provenance : {},
      seededAt: (obj as any).seededAt,
      updatedAt: (obj as any).updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the effective intake profile for one application.
 *
 * APP_SCOPED (v2): student-scope keys come from students.profile_data;
 * app-scope keys come ONLY from applications.context_data — shared
 * app-scope values are stripped so a stale shared value can never
 * shadow this application's context.
 *
 * LEGACY (v1): the shared profile is returned as-is — the same values
 * the application has always read. crossApplicationFallbackUsed=YES.
 * 
 * Country Questions fix: for v2 applications, validate that the
 * countryQuestionnaire.countryCode in context_data matches the
 * application's country. If not, treat Country Questions as empty.
 */
export function resolveApplicationContext(
  application: { applicationContextVersion?: number; contextData?: unknown; country?: string } | null | undefined,
  studentProfile: any,
): ResolvedApplicationContext {
  const version = application?.applicationContextVersion ?? APPLICATION_CONTEXT_VERSION.LEGACY;
  const ctx = application?.contextData ? parseContextData(application.contextData) : null;

  if (version >= APPLICATION_CONTEXT_VERSION.APP_SCOPED) {
    const appScopeFields = ctx?.fields || {};
    
    // Country Questions cross-application fix:
    // If the stored countryQuestionnaire countryCode doesn't match
    // the application's country, discard it.
    let validatedAppFields = { ...appScopeFields };
    if (appScopeFields.countryQuestionnaire && application?.country) {
      const storedCountryCode = (appScopeFields.countryQuestionnaire as any)?.countryCode;
      const appCountryCode = application.country; // application.country is the country code
      if (storedCountryCode && storedCountryCode !== appCountryCode) {
        // Country mismatch — treat Country Questions as unset for this application
        delete validatedAppFields.countryQuestionnaire;
      }
    }

    return {
      profile: { ...stripApplicationScopeFields(studentProfile), ...validatedAppFields },
      applicationContextSource: "APPLICATION_CONTEXT",
      crossApplicationFallbackUsed: false,
      provenance: ctx?.provenance || {},
    };
  }

  // LEGACY — identical to pre-migration reads; shared app-scope values
  // remain the fallback until the application's first scoped save.
  const sharedAppFields = extractApplicationScopeFields(studentProfile);
  const provenance: Record<string, ContextFieldSource> = {};
  for (const k of Object.keys(sharedAppFields)) provenance[k] = "LEGACY_SHARED";
  return {
    profile: studentProfile || {},
    applicationContextSource: "LEGACY_SHARED_PROFILE",
    crossApplicationFallbackUsed: true,
    provenance,
  };
}

/**
 * Build the next context_data object for an application-aware intake
 * save. Deterministic migration semantics:
 *
 *   v1 → first save: seed fields from the CURRENT shared student
 *        profile marked LEGACY_SHARED (that is the only value the
 *        application provably had — no fabricated history), then
 *        overlay submitted fields. A submitted value that differs from
 *        its seed is APPLICATION_EXPLICIT; an identical value keeps
 *        LEGACY_SHARED.
 *   v2 → overlay submitted fields; changed or new keys become
 *        APPLICATION_EXPLICIT, unchanged keys keep their provenance.
 *
 * Returns the serialized context_data + whether the version must
 * advance to APP_SCOPED.
 */
export function buildContextDataForSave(
  application: { applicationContextVersion?: number; contextData?: unknown },
  submittedAppFields: Record<string, unknown>,
  sharedStudentProfile: any,
): ApplicationContextData {
  const version = application.applicationContextVersion ?? APPLICATION_CONTEXT_VERSION.LEGACY;
  const existing = parseContextData(application.contextData);
  const fields: Record<string, unknown> = { ...(existing?.fields || {}) };
  const provenance: Record<string, ContextFieldSource> = { ...(existing?.provenance || {}) };
  const now = new Date().toISOString();
  let seededAt = existing?.seededAt;

  if (version < APPLICATION_CONTEXT_VERSION.APP_SCOPED || !existing) {
    // Legacy seed: snapshot the shared values this application reads today.
    const seed = extractApplicationScopeFields(sharedStudentProfile);
    for (const [k, v] of Object.entries(seed)) {
      if (fields[k] === undefined) {
        fields[k] = v;
        provenance[k] = "LEGACY_SHARED";
      }
    }
    seededAt = seededAt || now;
  }

  for (const [k, v] of Object.entries(submittedAppFields)) {
    if (v === undefined) continue;
    // Canonical (key-sorted) comparison — MySQL normalizes JSON key
    // order, so a naive stringify falsely reports seeded values as
    // changed and mislabels LEGACY_SHARED seeds as APPLICATION_EXPLICIT.
    const changed = canonicalJson(v) !== canonicalJson(fields[k]);
    fields[k] = v;
    if (changed) {
      provenance[k] = "APPLICATION_EXPLICIT";
    } else {
      provenance[k] = provenance[k] || "LEGACY_SHARED";
    }
  }

  return { fields, provenance, seededAt, updatedAt: now };
}
