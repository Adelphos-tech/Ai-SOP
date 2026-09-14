// ============================================================
// REQUIREMENTS KNOWLEDGE BASE REPOSITORY
// Phase SOP-AI-32
// ============================================================
// CRUD + lookup for institutions, programs, requirement sets,
// writing requirements, and sources.
// ============================================================

import { randomUUID } from "crypto";
import { getDbPool } from "./db";
import {
  Institution,
  CreateInstitutionInput,
  Program,
  CreateProgramInput,
  ApplicationRequirementSet,
  CreateRequirementSetInput,
  WritingRequirement,
  CreateWritingRequirementInput,
  RequirementSource,
  CreateRequirementSourceInput,
  RequirementLookupRequest,
  RequirementLookupResponse,
  RequirementLookupResult,
  isRequirementSetFresh,
  computeRequirementSetHash,
} from "./requirements-types";

// --- Helpers ---

function toMysqlTimestamp(iso?: string | null): string | null {
  if (!iso) return null;
  // Convert ISO 8601 to MySQL TIMESTAMP format: "2026-09-11 10:42:28"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function rowToInstitution(row: any): Institution {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    country: row.country || undefined,
    officialDomain: row.official_domain || undefined,
    additionalOfficialDomains: row.additional_official_domains
      ? (typeof row.additional_official_domains === "string"
          ? JSON.parse(row.additional_official_domains)
          : row.additional_official_domains)
      : undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProgram(row: any): Program {
  return {
    id: row.id,
    institutionId: row.institution_id,
    programName: row.program_name,
    degree: row.degree,
    department: row.department || undefined,
    school: row.school || undefined,
    campus: row.campus || undefined,
    country: row.country || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRequirementSet(row: any): ApplicationRequirementSet {
  return {
    id: row.id,
    programId: row.program_id,
    intake: row.intake,
    intakeYear: row.intake_year,
    applicationCycle: row.application_cycle || undefined,
    verificationStatus: row.verification_status,
    aiPolicyStatus: row.ai_policy_status || null,
    aiPolicyData: row.ai_policy_data
      ? (typeof row.ai_policy_data === "string"
          ? JSON.parse(row.ai_policy_data)
          : row.ai_policy_data)
      : undefined,
    verifiedAt: row.verified_at ? row.verified_at.toISOString ? row.verified_at.toISOString() : String(row.verified_at) : undefined,
    lastCheckedAt: row.last_checked_at ? row.last_checked_at.toISOString ? row.last_checked_at.toISOString() : String(row.last_checked_at) : undefined,
    expiresAt: row.expires_at ? row.expires_at.toISOString ? row.expires_at.toISOString() : String(row.expires_at) : undefined,
    contentHash: row.content_hash || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWritingRequirement(row: any): WritingRequirement {
  return {
    id: row.id,
    requirementSetId: row.requirement_set_id,
    documentType: row.document_type,
    officialTitle: row.official_title,
    promptText: row.prompt_text,
    promptSource: row.prompt_source,
    componentOrder: row.component_order,
    required: !!row.required,
    wordMin: row.word_min ?? undefined,
    wordMax: row.word_max ?? undefined,
    characterLimit: row.character_limit ?? undefined,
    pageLimit: row.page_limit ?? undefined,
    specialInstructions: row.special_instructions || undefined,
    facultyInstructions: row.faculty_instructions || undefined,
    formattingInstructions: row.formatting_instructions || undefined,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRequirementSource(row: any): RequirementSource {
  return {
    id: row.id,
    requirementSetId: row.requirement_set_id,
    writingRequirementId: row.writing_requirement_id || undefined,
    sourceUrl: row.source_url,
    officialDomain: row.official_domain || undefined,
    sourceTitle: row.source_title || undefined,
    sourceScope: row.source_scope,
    sourceType: row.source_type || undefined,
    retrievedAt: row.retrieved_at ? String(row.retrieved_at) : undefined,
    verifiedAt: row.verified_at ? String(row.verified_at) : undefined,
    contentHash: row.content_hash || undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

// --- Institution CRUD ---

export async function createInstitution(input: CreateInstitutionInput): Promise<Institution> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO institutions (id, canonical_name, country, official_domain, additional_official_domains, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.canonicalName,
      input.country || null,
      input.officialDomain || null,
      input.additionalOfficialDomains ? JSON.stringify(input.additionalOfficialDomains) : null,
      input.status || "ACTIVE",
    ],
  );
  const [rows] = await pool.execute("SELECT * FROM institutions WHERE id = ?", [id]);
  return rowToInstitution((rows as any[])[0]);
}

export async function getInstitution(id: string): Promise<Institution | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM institutions WHERE id = ?", [id]);
  const arr = rows as any[];
  return arr.length > 0 ? rowToInstitution(arr[0]) : null;
}

export async function findInstitutionByName(name: string): Promise<Institution | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM institutions WHERE LOWER(canonical_name) = LOWER(?) LIMIT 1",
    [name.trim()],
  );
  const arr = rows as any[];
  return arr.length > 0 ? rowToInstitution(arr[0]) : null;
}

export async function searchInstitutions(query: string): Promise<Institution[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM institutions WHERE canonical_name LIKE ? OR official_domain LIKE ? ORDER BY canonical_name LIMIT 50",
    [`%${query}%`, `%${query}%`],
  );
  return (rows as any[]).map(rowToInstitution);
}

// --- Program CRUD ---

export async function createProgram(input: CreateProgramInput): Promise<Program> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO programs (id, institution_id, program_name, degree, department, school, campus, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.institutionId,
      input.programName,
      input.degree,
      input.department || null,
      input.school || null,
      input.campus || null,
      input.country || null,
    ],
  );
  const [rows] = await pool.execute("SELECT * FROM programs WHERE id = ?", [id]);
  return rowToProgram((rows as any[])[0]);
}

export async function getProgram(id: string): Promise<Program | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM programs WHERE id = ?", [id]);
  const arr = rows as any[];
  return arr.length > 0 ? rowToProgram(arr[0]) : null;
}

export async function findProgram(
  institutionId: string,
  programName: string,
  degree: string,
): Promise<Program | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT * FROM programs
     WHERE institution_id = ? AND LOWER(program_name) = LOWER(?) AND LOWER(degree) = LOWER(?)
     LIMIT 1`,
    [institutionId, programName.trim(), degree.trim()],
  );
  const arr = rows as any[];
  return arr.length > 0 ? rowToProgram(arr[0]) : null;
}

export async function listInstitutionPrograms(institutionId: string): Promise<Program[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM programs WHERE institution_id = ? ORDER BY program_name",
    [institutionId],
  );
  return (rows as any[]).map(rowToProgram);
}

// --- Requirement Set CRUD ---

export async function createRequirementSet(input: CreateRequirementSetInput): Promise<ApplicationRequirementSet> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO application_requirement_sets
     (id, program_id, intake, intake_year, application_cycle, verification_status, ai_policy_status, ai_policy_data, verified_at, last_checked_at, expires_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.programId,
      input.intake,
      input.intakeYear,
      input.applicationCycle || null,
      input.verificationStatus || "UNKNOWN",
      input.aiPolicyStatus || null,
      input.aiPolicyData ? JSON.stringify(input.aiPolicyData) : null,
      toMysqlTimestamp(input.verifiedAt),
      toMysqlTimestamp(input.lastCheckedAt),
      toMysqlTimestamp(input.expiresAt),
      input.contentHash || null,
    ],
  );
  const [rows] = await pool.execute("SELECT * FROM application_requirement_sets WHERE id = ?", [id]);
  return rowToRequirementSet((rows as any[])[0]);
}

export async function getRequirementSet(id: string): Promise<ApplicationRequirementSet | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM application_requirement_sets WHERE id = ?", [id]);
  const arr = rows as any[];
  return arr.length > 0 ? rowToRequirementSet(arr[0]) : null;
}

export async function findRequirementSet(
  programId: string,
  intake: string,
  intakeYear: string,
): Promise<ApplicationRequirementSet | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    `SELECT * FROM application_requirement_sets
     WHERE program_id = ? AND LOWER(intake) = LOWER(?) AND intake_year = ?
     LIMIT 1`,
    [programId, intake.trim(), intakeYear.trim()],
  );
  const arr = rows as any[];
  return arr.length > 0 ? rowToRequirementSet(arr[0]) : null;
}

export async function listRequirementSets(limit = 50): Promise<ApplicationRequirementSet[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM application_requirement_sets ORDER BY updated_at DESC LIMIT ?",
    [limit],
  );
  return (rows as any[]).map(rowToRequirementSet);
}

export async function updateRequirementSet(
  id: string,
  updates: Partial<CreateRequirementSetInput>,
): Promise<void> {
  const pool = getDbPool();
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.verificationStatus !== undefined) { fields.push("verification_status = ?"); values.push(updates.verificationStatus); }
  if (updates.aiPolicyStatus !== undefined) { fields.push("ai_policy_status = ?"); values.push(updates.aiPolicyStatus); }
  if (updates.aiPolicyData !== undefined) { fields.push("ai_policy_data = ?"); values.push(JSON.stringify(updates.aiPolicyData)); }
  if (updates.verifiedAt !== undefined) { fields.push("verified_at = ?"); values.push(toMysqlTimestamp(updates.verifiedAt)); }
  if (updates.lastCheckedAt !== undefined) { fields.push("last_checked_at = ?"); values.push(toMysqlTimestamp(updates.lastCheckedAt)); }
  if (updates.expiresAt !== undefined) { fields.push("expires_at = ?"); values.push(toMysqlTimestamp(updates.expiresAt)); }
  if (updates.contentHash !== undefined) { fields.push("content_hash = ?"); values.push(updates.contentHash); }
  if (fields.length === 0) return;
  values.push(id);
  await pool.execute(
    `UPDATE application_requirement_sets SET ${fields.join(", ")} WHERE id = ?`,
    values,
  );
}

// --- Writing Requirement CRUD ---

export async function createWritingRequirement(input: CreateWritingRequirementInput): Promise<WritingRequirement> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO writing_requirements
     (id, requirement_set_id, document_type, official_title, prompt_text, prompt_source, component_order, required, word_min, word_max, character_limit, page_limit, special_instructions, faculty_instructions, formatting_instructions, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.requirementSetId,
      input.documentType,
      input.officialTitle,
      input.promptText,
      input.promptSource || "OFFICIAL_VERIFIED",
      input.componentOrder || 0,
      input.required !== false,
      input.wordMin || null,
      input.wordMax || null,
      input.characterLimit || null,
      input.pageLimit || null,
      input.specialInstructions || null,
      input.facultyInstructions || null,
      input.formattingInstructions || null,
      input.verificationStatus || "UNKNOWN",
    ],
  );
  const [rows] = await pool.execute("SELECT * FROM writing_requirements WHERE id = ?", [id]);
  return rowToWritingRequirement((rows as any[])[0]);
}

export async function getWritingRequirement(id: string): Promise<WritingRequirement | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM writing_requirements WHERE id = ?", [id]);
  const arr = rows as any[];
  return arr.length > 0 ? rowToWritingRequirement(arr[0]) : null;
}

export async function listWritingRequirements(requirementSetId: string): Promise<WritingRequirement[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM writing_requirements WHERE requirement_set_id = ? ORDER BY component_order, created_at",
    [requirementSetId],
  );
  return (rows as any[]).map(rowToWritingRequirement);
}

// --- Requirement Source CRUD ---

export async function createRequirementSource(input: CreateRequirementSourceInput): Promise<RequirementSource> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO requirement_sources
     (id, requirement_set_id, writing_requirement_id, source_url, official_domain, source_title, source_scope, source_type, retrieved_at, verified_at, content_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.requirementSetId,
      input.writingRequirementId || null,
      input.sourceUrl,
      input.officialDomain || null,
      input.sourceTitle || null,
      input.sourceScope || "UNIVERSITY",
      input.sourceType || null,
      toMysqlTimestamp(input.retrievedAt),
      toMysqlTimestamp(input.verifiedAt),
      input.contentHash || null,
      input.status || "ACTIVE",
    ],
  );
  const [rows] = await pool.execute("SELECT * FROM requirement_sources WHERE id = ?", [id]);
  return rowToRequirementSource((rows as any[])[0]);
}

export async function listRequirementSources(requirementSetId: string): Promise<RequirementSource[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM requirement_sources WHERE requirement_set_id = ? ORDER BY created_at",
    [requirementSetId],
  );
  return (rows as any[]).map(rowToRequirementSource);
}

// --- Lookup ---

export async function findRequirementSetByAppIdentity(
  req: RequirementLookupRequest,
): Promise<RequirementLookupResponse> {
  const pool = getDbPool();

  // Find institution by name
  const [instRows] = await pool.execute(
    "SELECT * FROM institutions WHERE LOWER(canonical_name) = LOWER(?) LIMIT 1",
    [req.university.trim()],
  );
  const instArr = instRows as any[];
  if (instArr.length === 0) {
    return { result: "NOT_FOUND" };
  }
  const institution = rowToInstitution(instArr[0]);

  // Find program
  const [progRows] = await pool.execute(
    `SELECT * FROM programs
     WHERE institution_id = ? AND LOWER(program_name) = LOWER(?) AND LOWER(degree) = LOWER(?)
     LIMIT 1`,
    [institution.id, req.program.trim(), req.degree.trim()],
  );
  const progArr = progRows as any[];
  if (progArr.length === 0) {
    return { result: "NOT_FOUND", institution };
  }
  const program = rowToProgram(progArr[0]);

  // Find requirement set
  const reqSet = await findRequirementSet(program.id, req.intake, req.intakeYear);
  if (!reqSet) {
    return { result: "NOT_FOUND", institution, program };
  }

  // Check freshness
  const fresh = isRequirementSetFresh(reqSet);
  const writingRequirements = await listWritingRequirements(reqSet.id);
  const sources = await listRequirementSources(reqSet.id);

  let result: RequirementLookupResult;
  if (fresh) {
    result = "EXACT_FRESH_MATCH";
  } else {
    result = "STALE_MATCH";
  }

  return {
    result,
    requirementSet: reqSet,
    institution,
    program,
    writingRequirements,
    sources,
  };
}

// --- Application linkage ---

export async function linkApplicationToRequirementSet(
  applicationId: string,
  requirementSetId: string,
): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    "UPDATE applications SET requirement_set_id = ? WHERE id = ?",
    [requirementSetId, applicationId],
  );
}

export async function getApplicationRequirementSet(
  applicationId: string,
): Promise<{ requirementSet: ApplicationRequirementSet; writingRequirements: WritingRequirement[]; sources: RequirementSource[] } | null> {
  const pool = getDbPool();
  const [appRows] = await pool.execute(
    "SELECT requirement_set_id FROM applications WHERE id = ?",
    [applicationId],
  );
  const appArr = appRows as any[];
  if (appArr.length === 0 || !appArr[0].requirement_set_id) return null;

  const reqSet = await getRequirementSet(appArr[0].requirement_set_id);
  if (!reqSet) return null;

  const writingRequirements = await listWritingRequirements(reqSet.id);
  const sources = await listRequirementSources(reqSet.id);

  return { requirementSet: reqSet, writingRequirements, sources };
}

// --- Document linkage ---

export async function linkDocumentToWritingRequirement(
  documentId: string,
  writingRequirementId: string,
): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    "UPDATE application_documents SET writing_requirement_id = ? WHERE id = ?",
    [writingRequirementId, documentId],
  );
}
