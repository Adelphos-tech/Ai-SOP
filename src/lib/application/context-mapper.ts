// ============================================================
// VERIFIED APPLICATION CONTEXT ↔ DB MAPPING
// Phase SOP-AI-32
// ============================================================
// Maps between the runtime canonical VerifiedApplicationContext
// and the persistent reusable requirement entities.
// ============================================================

import { VerifiedApplicationContext } from "@/lib/requirements/application-context";
import { ApplicationIdentity, SourceRecord } from "@/lib/requirements/types";
import { AiUsagePolicy } from "@/lib/requirements/ai-policy-types";
import {
  Institution,
  Program,
  ApplicationRequirementSet,
  WritingRequirement,
  RequirementSource,
  CreateInstitutionInput,
  CreateProgramInput,
  CreateRequirementSetInput,
  CreateWritingRequirementInput,
  CreateRequirementSourceInput,
  computeRequirementSetHash,
} from "./requirements-types";

/**
 * Map a VerifiedApplicationContext to persistent DB inputs.
 * Returns the entities that should be created/updated in the database.
 */
export function contextToDbEntities(ctx: VerifiedApplicationContext): {
  institution: CreateInstitutionInput;
  program: Omit<CreateProgramInput, "institutionId">;
  requirementSet: Omit<CreateRequirementSetInput, "programId">;
  writingRequirements: Array<Omit<CreateWritingRequirementInput, "requirementSetId">>;
  sources: Array<Omit<CreateRequirementSourceInput, "requirementSetId">>;
} {
  const identity = ctx.applicationIdentity;

  // Extract domain from official sources
  const domains = ctx.officialSources
    .map(s => s.officialDomain)
    .filter((d, i, arr) => d && arr.indexOf(d) === i) as string[];
  const primaryDomain = domains[0] || undefined;
  const additionalDomains = domains.slice(1);

  const institution: CreateInstitutionInput = {
    canonicalName: identity.university,
    country: identity.country || undefined,
    officialDomain: primaryDomain || undefined,
    additionalOfficialDomains: additionalDomains.length > 0 ? additionalDomains : undefined,
    status: "ACTIVE",
  };

  const program: Omit<CreateProgramInput, "institutionId"> = {
    programName: identity.program,
    degree: identity.degreeLevel,
    country: identity.country,
  };

  // Map AI policy
  const aiPolicyStatus = ctx.aiPolicy?.status || null;

  const requirementSet: Omit<CreateRequirementSetInput, "programId"> = {
    intake: identity.intake,
    intakeYear: identity.intakeYear,
    verificationStatus: ctx.verificationStatus,
    aiPolicyStatus: aiPolicyStatus as any,
    aiPolicyData: ctx.aiPolicy ? { ...ctx.aiPolicy } : undefined,
    verifiedAt: ctx.verifiedAt || undefined,
    lastCheckedAt: ctx.createdAt || undefined,
    expiresAt: ctx.expiresAt || undefined,
    contentHash: ctx.contentHash || undefined,
  };

  // Map writing requirements from response components
  const writingRequirements: Array<Omit<CreateWritingRequirementInput, "requirementSetId">> =
    ctx.responseComponents.map((comp, idx) => ({
      documentType: "OTHER", // ResponseComponent doesn't have documentType directly
      officialTitle: comp.label || `Component ${idx + 1}`,
      promptText: comp.exactPrompt || "",
      promptSource: "OFFICIAL_VERIFIED",
      componentOrder: idx,
      required: true,
      wordMin: comp.wordLimit?.min || undefined,
      wordMax: comp.wordLimit?.max || undefined,
      verificationStatus: "VERIFIED",
    }));

  // Map sources
  const sources: Array<Omit<CreateRequirementSourceInput, "requirementSetId">> =
    ctx.officialSources.map((src: SourceRecord) => ({
      sourceUrl: src.url,
      officialDomain: src.officialDomain,
      sourceTitle: src.title,
      sourceScope: mapSourceScope(src),
      sourceType: src.sourceClass,
      retrievedAt: src.retrievedAt,
      contentHash: src.contentHash,
      status: mapSourceStatus(src.status),
    }));

  return { institution, program, requirementSet, writingRequirements, sources };
}

function mapSourceScope(src: SourceRecord): RequirementSource["sourceScope"] {
  if (src.programMatch) return "PROGRAM";
  if (src.intakeMatch) return "INTAKE_SPECIFIC";
  if (src.degreeLevelMatch) return "APPLICATION";
  return "UNIVERSITY";
}

function mapSourceStatus(status: string): RequirementSource["status"] {
  switch (status) {
    case "ACTIVE": return "ACTIVE";
    case "STALE": return "STALE";
    case "INACCESSIBLE": return "INACCESSIBLE";
    case "CONFLICTING": return "CONFLICTING";
    default: return "ACTIVE";
  }
}

/**
 * Map persistent DB entities back to a canonical VerifiedApplicationContext.
 */
export function dbEntitiesToContext(
  institution: Institution,
  program: Program,
  requirementSet: ApplicationRequirementSet,
  writingRequirements: WritingRequirement[],
  sources: RequirementSource[],
): VerifiedApplicationContext {
  const identity: ApplicationIdentity = {
    country: institution.country || "",
    university: institution.canonicalName,
    program: program.programName,
    degreeLevel: program.degree,
    intake: requirementSet.intake,
    intakeYear: requirementSet.intakeYear,
  };

  // Map writing requirements back to response components
  const responseComponents = writingRequirements.map((wr, idx) => ({
    componentId: `comp-${idx}`,
    label: wr.officialTitle,
    exactPrompt: wr.promptText,
    pageLimit: { type: "PER_DOCUMENT" as const, min: null, max: wr.pageLimit || null },
    wordLimit: { min: wr.wordMin || null, max: wr.wordMax || null },
    characterLimit: { min: null, max: wr.characterLimit || null },
    requiredTopics: [],
    sourceId: `src-${idx}`,
    status: wr.verificationStatus,
    verifiedAt: wr.createdAt,
  })) as any[]; // Cast to match ResponseComponent type

  // Map sources back
  const officialSources: SourceRecord[] = sources.map((s, idx) => ({
    sourceId: `src-${idx}`,
    sourceClass: (s.sourceType as any) || "OFFICIAL_UNIVERSITY_WEBPAGE",
    title: s.sourceTitle || "",
    officialOrganization: institution.canonicalName,
    officialDomain: s.officialDomain || "",
    url: s.sourceUrl,
    retrievedAt: s.retrievedAt || "",
    publishedOrUpdatedAt: null,
    programMatch: s.sourceScope === "PROGRAM",
    degreeLevelMatch: s.sourceScope === "APPLICATION",
    intakeMatch: s.sourceScope === "INTAKE_SPECIFIC",
    countryMatch: true,
    httpStatus: 200,
    contentHash: s.contentHash || "",
    status: s.status as any,
    priority: "PRIMARY" as const,
  }));

  // Map AI policy
  const aiPolicy: AiUsagePolicy = requirementSet.aiPolicyData
    ? requirementSet.aiPolicyData as unknown as AiUsagePolicy
    : ({
        status: (requirementSet.aiPolicyStatus as any) || "AI_POLICY_NOT_FOUND",
        generationAllowed: false,
        editingAllowed: null,
        proofreadingAllowed: null,
        brainstormingAllowed: null,
        translationAllowed: null,
        applicationAiMode: "UNKNOWN" as any,
        sources: [],
        verifiedAt: requirementSet.verifiedAt || "",
        cacheKey: "",
    } as unknown as AiUsagePolicy);

  const applicationId = `${identity.country}__${identity.university}__${identity.program}__${identity.degreeLevel}__${identity.intake}__${identity.intakeYear}`
    .toLowerCase()
    .replace(/\s+/g, "_");

  return {
    applicationId,
    schemaVersion: "1.1.0",
    applicationIdentity: identity,
    brief: {
      applicationIdentity: identity,
      documents: writingRequirements.map((wr, idx) => ({
        documentType: wr.documentType as any,
        documentTypeLabel: wr.officialTitle,
        required: wr.required,
        officialPrompt: {
          rawText: wr.promptText,
          status: wr.verificationStatus as any,
          provenance: null,
        },
        wordLimit: {
          min: wr.wordMin || null,
          max: wr.wordMax || null,
          status: wr.verificationStatus as any,
          provenance: null,
        },
        characterLimit: {
          min: null,
          max: wr.characterLimit || null,
          status: wr.verificationStatus as any,
          provenance: null,
        },
        requiredTopics: [],
        formatInstructions: [],
        additionalQuestions: [],
      })),
      countryGuidance: { items: [], priority: "SECONDARY", sourceId: null },
      sources: officialSources,
      verification: {
        status: requirementSet.verificationStatus as any,
        verifiedAt: requirementSet.verifiedAt || "",
        conflicts: [],
        blockingIssues: [],
      },
      cacheKey: requirementSet.contentHash || "",
      createdAt: requirementSet.createdAt,
      expiresAt: requirementSet.expiresAt || null,
    },
    aiPolicy,
    responseComponents,
    facultyContext: [],
    officialSources,
    verificationStatus: requirementSet.verificationStatus as any,
    verifiedAt: requirementSet.verifiedAt || "",
    contentHash: requirementSet.contentHash || "",
    cacheKey: requirementSet.contentHash || "",
    createdAt: requirementSet.createdAt,
    expiresAt: requirementSet.expiresAt || null,
    fromFixture: false,
  };
}

/**
 * Save a discovered/verified requirement set to the persistent DB.
 * This is the future function that discovery will call.
 */
export async function saveDiscoveredRequirementSet(
  ctx: VerifiedApplicationContext,
): Promise<{
  institutionId: string;
  programId: string;
  requirementSetId: string;
}> {
  const {
    createInstitution,
    findInstitutionByName,
    createProgram,
    findProgram,
    createRequirementSet,
    findRequirementSet,
    updateRequirementSet,
    createWritingRequirement,
    createRequirementSource,
    listWritingRequirements,
  } = await import("./requirements-repository");

  const entities = contextToDbEntities(ctx);

  // Find or create institution
  let institution = await findInstitutionByName(entities.institution.canonicalName);
  if (!institution) {
    institution = await createInstitution(entities.institution);
  }

  // Find or create program
  let program = await findProgram(institution.id, entities.program.programName, entities.program.degree);
  if (!program) {
    program = await createProgram({ ...entities.program, institutionId: institution.id });
  }

  // Find or create requirement set
  let reqSet = await findRequirementSet(program.id, entities.requirementSet.intake, entities.requirementSet.intakeYear);
  if (!reqSet) {
    reqSet = await createRequirementSet({ ...entities.requirementSet, programId: program.id });
  } else {
    // Update existing
    await updateRequirementSet(reqSet.id, entities.requirementSet);
    reqSet = await (await import("./requirements-repository")).getRequirementSet(reqSet.id) as ApplicationRequirementSet;
  }

  // Create writing requirements (replace existing)
  const existing = await listWritingRequirements(reqSet.id);
  // Note: We don't delete existing in this function — caller should handle if needed
  for (const wr of entities.writingRequirements) {
    await createWritingRequirement({ ...wr, requirementSetId: reqSet.id });
  }

  // Create sources
  for (const src of entities.sources) {
    await createRequirementSource({ ...src, requirementSetId: reqSet.id });
  }

  return {
    institutionId: institution.id,
    programId: program.id,
    requirementSetId: reqSet.id,
  };
}
