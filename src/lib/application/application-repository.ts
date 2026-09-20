// ============================================================
// APPLICATION REPOSITORY
// Phase SOP-AI-29
// ============================================================
// CRUD operations for students, applications, documents, versions
// ============================================================

import { randomUUID } from "crypto";
import { getDbPool } from "./db";
import {
  Student,
  Application,
  ApplicationDocument,
  DocumentVersion,
  CreateStudentInput,
  CreateApplicationInput,
  CreateDocumentInput,
  CreateDocumentVersionInput,
  SaveConsultantVersionInput,
  StudentProfileData,
  PromptSource,
  ReviewStatus,
  isUserSettablePromptSource,
  isValidDocumentType,
  isValidPromptSource,
} from "./application-types";

// ============================================================
// STUDENTS
// ============================================================

export async function createStudent(input: CreateStudentInput): Promise<Student> {
  const id = randomUUID();
  const pool = getDbPool();

  await pool.execute(
    `INSERT INTO students (id, external_ref_id, first_name, last_name, email, phone, country, profile_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.externalRefId || null,
      input.firstName,
      input.lastName,
      input.email,
      input.phone || null,
      input.country || null,
      input.profileData ? JSON.stringify(input.profileData) : null,
    ],
  );

  return getStudent(id) as Promise<Student>;
}

export async function getStudent(id: string): Promise<Student | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM students WHERE id = ?", [id]);
  const row = (rows as any[])[0];
  if (!row) return null;
  return rowToStudent(row);
}

export async function getStudentByEmail(email: string): Promise<Student | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM students WHERE email = ?", [email]);
  const row = (rows as any[])[0];
  if (!row) return null;
  return rowToStudent(row);
}

export async function searchStudents(query: string): Promise<Student[]> {
  const pool = getDbPool();
  const likeQuery = `%${query}%`;
  // Also search by concatenated first + last name
  const concatQuery = `%${query.replace(/\s+/g, "%")}%`;
  const [rows] = await pool.execute(
    `SELECT * FROM students
     WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
       OR CONCAT(first_name, ' ', last_name) LIKE ?
       OR CONCAT(first_name, ' ', last_name) LIKE ?
     ORDER BY last_name, first_name LIMIT 50`,
    [likeQuery, likeQuery, likeQuery, likeQuery, concatQuery],
  );
  return (rows as any[]).map(rowToStudent);
}

/**
 * List students with server-side pagination.
 * Returns students ordered by most recently updated first.
 */
export async function listStudents(options: {
  limit?: number;
  offset?: number;
  query?: string;
}): Promise<{ students: Student[]; total: number }> {
  const pool = getDbPool();
  const limit = Math.min(options.limit || 25, 100);
  const offset = options.offset || 0;
  const query = options.query?.trim();

  if (query) {
    const likeQuery = `%${query}%`;
    const concatQuery = `%${query.replace(/\s+/g, "%")}%`;
    const [rows] = await pool.execute(
      `SELECT * FROM students
       WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
         OR CONCAT(first_name, ' ', last_name) LIKE ?
         OR CONCAT(first_name, ' ', last_name) LIKE ?
       ORDER BY updated_at DESC, last_name, first_name
       LIMIT ${limit} OFFSET ${offset}`,
      [likeQuery, likeQuery, likeQuery, likeQuery, concatQuery],
    );
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM students
       WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
         OR CONCAT(first_name, ' ', last_name) LIKE ?
         OR CONCAT(first_name, ' ', last_name) LIKE ?`,
      [likeQuery, likeQuery, likeQuery, likeQuery, concatQuery],
    );
    return {
      students: (rows as any[]).map(rowToStudent),
      total: (countRows as any[])[0]?.total || 0,
    };
  }

  const [rows] = await pool.execute(
    `SELECT * FROM students ORDER BY updated_at DESC, last_name, first_name LIMIT ${limit} OFFSET ${offset}`,
  );
  const [countRows] = await pool.execute("SELECT COUNT(*) as total FROM students");
  return {
    students: (rows as any[]).map(rowToStudent),
    total: (countRows as any[])[0]?.total || 0,
  };
}

export async function saveStudentProfile(studentId: string, profileData: StudentProfileData): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    "UPDATE students SET profile_data = ? WHERE id = ?",
    [JSON.stringify(profileData), studentId],
  );
}

/**
 * Get the current profile revision number.
 * Revisions are stored as `_revision` inside the profile JSON.
 * Returns 0 if no profile or no revision yet.
 */
export async function getStudentProfileRevision(studentId: string): Promise<number> {
  const profile = await getStudentProfile(studentId);
  if (!profile) return 0;
  const rev = (profile as any)._revision;
  return typeof rev === "number" ? rev : 0;
}

/**
 * Conditionally save a profile only if the expected revision matches.
 * Uses a transaction with SELECT FOR UPDATE to prevent lost updates.
 * Returns true if saved, false if revision mismatch (stale).
 *
 *   const saved = await saveStudentProfileConditional(studentId, newProfile, expectedRev);
 *   if (!saved) return 409;
 */
export async function saveStudentProfileConditional(
  studentId: string,
  profileData: StudentProfileData,
  expectedRevision: number,
  identitySync?: { firstName?: string; lastName?: string; email?: string },
): Promise<boolean> {
  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the row to serialize concurrent writes
    const [rows] = await conn.execute(
      "SELECT profile_data FROM students WHERE id = ? FOR UPDATE",
      [studentId],
    );
    const row = (rows as any[])[0];
    if (!row) {
      await conn.rollback();
      return false;
    }

    let currentProfile: any = {};
    if (row.profile_data) {
      currentProfile = typeof row.profile_data === "string"
        ? JSON.parse(row.profile_data)
        : row.profile_data;
    }

    const currentRev = typeof currentProfile._revision === "number" ? currentProfile._revision : 0;
    if (currentRev !== expectedRevision) {
      await conn.rollback();
      return false; // Stale — profile was modified by someone else
    }

    // Increment revision and save
    const newProfile = { ...profileData, _revision: currentRev + 1 };
    await conn.execute(
      "UPDATE students SET profile_data = ? WHERE id = ?",
      [JSON.stringify(newProfile), studentId],
    );

    // Keep students row identity in sync with explicit Student Details
    // edits — same transaction, so profile and identity never diverge.
    // Only non-empty values sync; CV apply intentionally does NOT pass
    // identitySync, so a parsed CV can never rename the student row.
    if (identitySync) {
      const sets: string[] = [];
      const params: any[] = [];
      const fn = String(identitySync.firstName ?? "").trim();
      const ln = String(identitySync.lastName ?? "").trim();
      const em = String(identitySync.email ?? "").trim();
      if (fn) { sets.push("first_name = ?"); params.push(fn); }
      if (ln) { sets.push("last_name = ?"); params.push(ln); }
      if (em) { sets.push("email = ?"); params.push(em); }
      if (sets.length > 0) {
        params.push(studentId);
        await conn.execute(`UPDATE students SET ${sets.join(", ")} WHERE id = ?`, params);
      }
    }

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getStudentProfile(studentId: string): Promise<StudentProfileData | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT profile_data FROM students WHERE id = ?", [studentId]);
  const row = (rows as any[])[0];
  if (!row || !row.profile_data) return null;
  return typeof row.profile_data === "string" ? JSON.parse(row.profile_data) : row.profile_data;
}

function rowToStudent(row: any): Student {
  return {
    id: row.id,
    externalRefId: row.external_ref_id || undefined,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone || undefined,
    country: row.country || undefined,
    profileData: row.profile_data
      ? typeof row.profile_data === "string" ? JSON.parse(row.profile_data) : row.profile_data
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// APPLICATIONS
// ============================================================

export async function createApplication(input: CreateApplicationInput): Promise<Application> {
  // Validate student exists
  const student = await getStudent(input.studentId);
  if (!student) {
    throw new Error(`Student not found: ${input.studentId}`);
  }

  const id = randomUUID();
  const pool = getDbPool();

  await pool.execute(
    `INSERT INTO applications (id, student_id, university_name, program_name, degree, department, country, intake, intake_year, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
    [
      id,
      input.studentId,
      input.universityName,
      input.programName,
      input.degree,
      input.department || null,
      input.country,
      input.intake,
      input.intakeYear,
    ],
  );

  return getApplication(id) as Promise<Application>;
}

export async function getApplication(id: string): Promise<Application | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM applications WHERE id = ?", [id]);
  const row = (rows as any[])[0];
  if (!row) return null;
  return rowToApplication(row);
}

export async function listStudentApplications(studentId: string, limit = 100, offset = 0): Promise<Application[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM applications WHERE student_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [studentId, limit, offset],
  );
  return (rows as any[]).map(rowToApplication);
}

/**
 * Delete an application and ALL data owned by it — atomically.
 *
 * FK cascades cover application_documents → document_versions, but
 * generation_runs / generation_stage_responses have NO FK constraints,
 * so they are deleted explicitly in dependency order.
 *
 * Shared program-level data (application_requirement_sets,
 * writing_requirements, requirement_sources, institutions, programs)
 * is NEVER touched — it is library data, not application-owned.
 * The student's profile_data is untouched by design.
 */
export async function deleteApplicationCascade(applicationId: string): Promise<boolean> {
  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the application row
    const [appRows] = await conn.execute(
      "SELECT id FROM applications WHERE id = ? FOR UPDATE",
      [applicationId],
    );
    if (!(appRows as any[])[0]) {
      await conn.rollback();
      return false;
    }

    // 1. Stage responses — via runs and via documents (no FK on either)
    await conn.execute(
      `DELETE gsr FROM generation_stage_responses gsr
       JOIN generation_runs gr ON gsr.run_id = gr.id
       WHERE gr.application_id = ?`,
      [applicationId],
    );
    await conn.execute(
      `DELETE gsr FROM generation_stage_responses gsr
       JOIN application_documents d ON gsr.document_id = d.id
       WHERE d.application_id = ?`,
      [applicationId],
    );

    // 2. Generation runs (no FK)
    await conn.execute("DELETE FROM generation_runs WHERE application_id = ?", [applicationId]);

    // 3. Document versions → documents (explicit; mirrors FK cascade)
    await conn.execute(
      `DELETE dv FROM document_versions dv
       JOIN application_documents d ON dv.document_id = d.id
       WHERE d.application_id = ?`,
      [applicationId],
    );
    await conn.execute("DELETE FROM application_documents WHERE application_id = ?", [applicationId]);

    // 4. The application itself
    await conn.execute("DELETE FROM applications WHERE id = ?", [applicationId]);

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * List all applications across all students, with student info joined.
 * Used by the cross-student Applications listing page.
 */
export async function listAllApplications(limit = 200, offset = 0): Promise<Array<Application & {
  studentFirstName: string;
  studentLastName: string;
  studentEmail: string;
  documentCount: number;
}>> {
  const pool = getDbPool();
  const [rows] = await pool.query(
    `SELECT a.*, s.first_name AS student_first_name, s.last_name AS student_last_name, s.email AS student_email,
       (SELECT COUNT(*) FROM application_documents d WHERE d.application_id = a.id) AS document_count
     FROM applications a
     JOIN students s ON s.id = a.student_id
     ORDER BY a.updated_at DESC, a.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return (rows as any[]).map(row => ({
    ...rowToApplication(row),
    studentFirstName: row.student_first_name || "",
    studentLastName: row.student_last_name || "",
    studentEmail: row.student_email || "",
    documentCount: Number(row.document_count) || 0,
  }));
}

function rowToApplication(row: any): Application {
  return {
    id: row.id,
    studentId: row.student_id,
    universityName: row.university_name,
    programName: row.program_name,
    degree: row.degree,
    department: row.department || undefined,
    country: row.country,
    intake: row.intake,
    intakeYear: row.intake_year,
    applicationContextId: row.application_context_id || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// DOCUMENTS
// ============================================================

export async function createDocument(input: CreateDocumentInput): Promise<ApplicationDocument> {
  // Validate application exists
  const app = await getApplication(input.applicationId);
  if (!app) {
    throw new Error(`Application not found: ${input.applicationId}`);
  }

  // Validate document type
  if (!isValidDocumentType(input.documentType)) {
    throw new Error(`Invalid document type: ${input.documentType}`);
  }

  // Validate prompt source — prevent false OFFICIAL_VERIFIED
  if (!isValidPromptSource(input.promptSource)) {
    throw new Error(`Invalid prompt source: ${input.promptSource}`);
  }
  if (input.promptSource === "OFFICIAL_VERIFIED" && !isUserSettablePromptSource(input.promptSource)) {
    throw new Error("OFFICIAL_VERIFIED prompt source can only be set by the server, not by users");
  }
  if (input.promptSource === "DVIVID_DEFAULT_TEMPLATE" && !isUserSettablePromptSource(input.promptSource)) {
    throw new Error("DVIVID_DEFAULT_TEMPLATE prompt source is server-controlled, applied by the resolve-prompt flow");
  }

  const id = randomUUID();
  const pool = getDbPool();

  await pool.execute(
    `INSERT INTO application_documents
     (id, application_id, document_type, document_title, prompt_text, prompt_source,
      word_min, word_max, character_limit, page_limit,
      special_instructions, faculty_instructions, formatting_instructions,
      requirements_status, generation_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', 'NOT_STARTED')`,
    [
      id,
      input.applicationId,
      input.documentType,
      input.documentTitle,
      input.promptText,
      input.promptSource,
      input.wordMin || null,
      input.wordMax || null,
      input.characterLimit || null,
      input.pageLimit || null,
      input.specialInstructions || null,
      input.facultyInstructions || null,
      input.formattingInstructions || null,
    ],
  );

  return getDocument(id) as Promise<ApplicationDocument>;
}

/**
 * Phase SOP-AI-33: Server-side function to create an officially-verified document.
 * This bypasses the user-settable prompt source check because it is called
 * only by server-side flows (e.g., requirements resolution, official discovery).
 */
export async function createOfficialDocument(input: CreateDocumentInput): Promise<ApplicationDocument> {
  if (!input.applicationId || !input.documentType || !input.documentTitle) {
    throw new Error("applicationId, documentType, and documentTitle are required");
  }

  if (!isValidDocumentType(input.documentType)) {
    throw new Error(`Invalid document type: ${input.documentType}`);
  }

  if (!isValidPromptSource(input.promptSource)) {
    throw new Error(`Invalid prompt source: ${input.promptSource}`);
  }

  const id = randomUUID();
  const pool = getDbPool();

  await pool.execute(
    `INSERT INTO application_documents
     (id, application_id, document_type, document_title, prompt_text, prompt_source,
      word_min, word_max, character_limit, page_limit,
      special_instructions, faculty_instructions, formatting_instructions,
      requirements_status, generation_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', 'NOT_STARTED')`,
    [
      id,
      input.applicationId,
      input.documentType,
      input.documentTitle,
      input.promptText,
      input.promptSource,
      input.wordMin || null,
      input.wordMax || null,
      input.characterLimit || null,
      input.pageLimit || null,
      input.specialInstructions || null,
      input.facultyInstructions || null,
      input.formattingInstructions || null,
    ],
  );

  return getDocument(id) as Promise<ApplicationDocument>;
}

export async function getDocument(id: string): Promise<ApplicationDocument | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM application_documents WHERE id = ?", [id]);
  const row = (rows as any[])[0];
  if (!row) return null;
  return rowToDocument(row);
}

export async function listApplicationDocuments(applicationId: string, limit = 100, offset = 0): Promise<ApplicationDocument[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM application_documents WHERE application_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
    [applicationId, limit, offset],
  );
  return (rows as any[]).map(rowToDocument);
}

export async function updateDocumentStatus(
  id: string,
  requirementsStatus?: string,
  generationStatus?: string,
): Promise<void> {
  const pool = getDbPool();
  const updates: string[] = [];
  const params: any[] = [];
  if (requirementsStatus) {
    updates.push("requirements_status = ?");
    params.push(requirementsStatus);
  }
  if (generationStatus) {
    updates.push("generation_status = ?");
    params.push(generationStatus);
  }
  if (updates.length === 0) return;
  params.push(id);
  await pool.execute(
    `UPDATE application_documents SET ${updates.join(", ")} WHERE id = ?`,
    params,
  );
}

/**
 * Phase SOP-INFRA-36: Atomically acquire generation lock.
 * Uses conditional UPDATE to prevent race conditions.
 * Returns true if this caller acquired the lock (affectedRows === 1).
 * Also handles stale generation recovery: if a generation has been
 * stuck in GENERATING for more than STALE_TIMEOUT_MS, it allows a new one.
 */
const STALE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function acquireGenerationLock(documentId: string): Promise<boolean> {
  const pool = getDbPool();
  // Try atomic conditional update: only set GENERATING if not already GENERATING
  const [result] = await pool.execute(
    `UPDATE application_documents
     SET generation_status = 'GENERATING', generation_started_at = NOW()
     WHERE id = ?
       AND (generation_status != 'GENERATING'
            OR generation_started_at IS NULL
            OR generation_started_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE))`,
    [documentId],
  );
  return (result as any).affectedRows === 1;
}

function rowToDocument(row: any): ApplicationDocument {
  return {
    id: row.id,
    applicationId: row.application_id,
    documentType: row.document_type,
    documentTitle: row.document_title,
    promptText: row.prompt_text,
    promptSource: row.prompt_source as PromptSource,
    wordMin: row.word_min || undefined,
    wordMax: row.word_max || undefined,
    characterLimit: row.character_limit || undefined,
    pageLimit: row.page_limit || undefined,
    specialInstructions: row.special_instructions || undefined,
    facultyInstructions: row.faculty_instructions || undefined,
    formattingInstructions: row.formatting_instructions || undefined,
    requirementsStatus: row.requirements_status,
    generationStatus: row.generation_status,
    reviewStatus: (row.review_status || "DRAFT") as ReviewStatus,
    currentVersionId: row.current_version_id || undefined,
    approvedVersionId: row.approved_version_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// DOCUMENT VERSIONS
// ============================================================

export async function createDocumentVersion(input: CreateDocumentVersionInput): Promise<DocumentVersion> {
  // Validate document exists
  const doc = await getDocument(input.documentId);
  if (!doc) {
    throw new Error(`Document not found: ${input.documentId}`);
  }

  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the document row to serialize concurrent version creation
    await conn.execute(
      "SELECT id FROM application_documents WHERE id = ? FOR UPDATE",
      [input.documentId],
    );

    // Get next version number within the transaction
    const [countResult] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM document_versions WHERE document_id = ?",
      [input.documentId],
    );
    const versionNumber = ((countResult as any[])[0]?.cnt || 0) + 1;

    const id = randomUUID();

    await conn.execute(
      `INSERT INTO document_versions
       (id, document_id, version_number, content, content_format, created_by_type,
        parent_version_id, model, generation_id, student_facts_hash, requirements_hash, cost_usd, cost_inr)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.documentId,
        versionNumber,
        input.content,
        input.contentFormat || "MARKDOWN",
        input.createdByType,
        input.parentVersionId || null,
        input.model || null,
        input.generationId || null,
        input.studentFactsHash || null,
        input.requirementsHash || null,
        input.costUsd || null,
        input.costInr || null,
      ],
    );

    // Update current version on document — same transaction
    await conn.execute(
      "UPDATE application_documents SET current_version_id = ? WHERE id = ?",
      [id, input.documentId],
    );

    await conn.commit();
    return getDocumentVersion(id) as Promise<DocumentVersion>;
  } catch (err: any) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getDocumentVersion(id: string): Promise<DocumentVersion | null> {
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT * FROM document_versions WHERE id = ?", [id]);
  const row = (rows as any[])[0];
  if (!row) return null;
  return rowToVersion(row);
}

export async function listDocumentVersions(documentId: string, limit = 100, offset = 0): Promise<DocumentVersion[]> {
  const pool = getDbPool();
  const [rows] = await pool.execute(
    "SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number ASC LIMIT ? OFFSET ?",
    [documentId, limit, offset],
  );
  return (rows as any[]).map(rowToVersion);
}

function rowToVersion(row: any): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    content: row.content,
    contentFormat: row.content_format,
    createdByType: row.created_by_type,
    parentVersionId: row.parent_version_id || undefined,
    model: row.model || undefined,
    generationId: row.generation_id || undefined,
    studentFactsHash: row.student_facts_hash || undefined,
    requirementsHash: row.requirements_hash || undefined,
    costUsd: row.cost_usd ? Number(row.cost_usd) : undefined,
    costInr: row.cost_inr ? Number(row.cost_inr) : undefined,
    createdAt: row.created_at,
  };
}

// ============================================================
// PHASE SOP-AI-34: CONSULTANT REVIEW WORKFLOW
// ============================================================

/**
 * Validate that a document belongs to an application that belongs to a student.
 * Returns the document if valid, throws if cross-student access is attempted.
 */
export async function validateDocumentOwnership(
  documentId: string,
  applicationId: string,
  studentId: string,
): Promise<ApplicationDocument> {
  const doc = await getDocument(documentId);
  if (!doc) {
    throw new Error("Document not found");
  }
  if (doc.applicationId !== applicationId) {
    throw new Error("Document does not belong to this application");
  }
  const app = await getApplication(applicationId);
  if (!app) {
    throw new Error("Application not found");
  }
  if (app.studentId !== studentId) {
    throw new Error("Application does not belong to this student");
  }
  return doc;
}

/**
 * Validate that a version belongs to a document.
 */
export async function validateVersionOwnership(
  versionId: string,
  documentId: string,
): Promise<DocumentVersion> {
  const version = await getDocumentVersion(versionId);
  if (!version) {
    throw new Error("Version not found");
  }
  if (version.documentId !== documentId) {
    throw new Error("Version does not belong to this document");
  }
  return version;
}

/**
 * Phase SOP-AI-34: Save a consultant-edited version.
 * Server assigns version number (MAX + 1) and createdByType = CONSULTANT_EDITED.
 * Does NOT modify any existing version.
 * Sets currentVersionId to the new version.
 * If the document was previously APPROVED, reviewStatus returns to IN_REVIEW.
 */
export async function saveConsultantVersion(
  input: SaveConsultantVersionInput,
): Promise<DocumentVersion> {
  // Validate document exists
  const doc = await getDocument(input.documentId);
  if (!doc) {
    throw new Error(`Document not found: ${input.documentId}`);
  }

  // Validate content is not empty
  if (!input.content || !input.content.trim()) {
    throw new Error("Content cannot be empty or whitespace-only");
  }

  // Validate base version belongs to this document if provided
  if (input.baseVersionId) {
    await validateVersionOwnership(input.baseVersionId, input.documentId);
  }

  // Check for duplicate content (byte-for-byte identical to base version)
  if (input.baseVersionId) {
    const baseVersion = await getDocumentVersion(input.baseVersionId);
    if (baseVersion && baseVersion.content === input.content) {
      throw new Error("No changes to save — content is identical to the selected version");
    }
  }

  // Get next version number server-side — transaction with row lock
  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock document row to serialize concurrent version creation
    await conn.execute(
      "SELECT id FROM application_documents WHERE id = ? FOR UPDATE",
      [input.documentId],
    );

    const [countResult] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM document_versions WHERE document_id = ?",
      [input.documentId],
    );
    const versionNumber = ((countResult as any[])[0]?.cnt || 0) + 1;

    const id = randomUUID();

    await conn.execute(
      `INSERT INTO document_versions
       (id, document_id, version_number, content, content_format, created_by_type, parent_version_id)
       VALUES (?, ?, ?, ?, ?, 'CONSULTANT_EDITED', ?)`,
      [
        id,
        input.documentId,
        versionNumber,
        input.content,
        input.contentFormat || "MARKDOWN",
        input.baseVersionId || null,
      ],
    );

    // Update current version and review status on document — same transaction
    // If document was APPROVED, new edit returns to IN_REVIEW
    const newReviewStatus = doc.reviewStatus === "APPROVED" ? "IN_REVIEW" : (doc.reviewStatus || "IN_REVIEW");
    await conn.execute(
      "UPDATE application_documents SET current_version_id = ?, review_status = ? WHERE id = ?",
      [id, newReviewStatus, input.documentId],
    );

    await conn.commit();
    return getDocumentVersion(id) as Promise<DocumentVersion>;
  } catch (err: any) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Phase SOP-AI-34: Approve a specific version.
 * Sets approvedVersionId and reviewStatus = APPROVED.
 * Does NOT alter version text.
 * Validates hard constraints (word min/max, character limit) before approval.
 */
export interface ApprovalWarning {
  code: string;
  message: string;
}

/** Compute non-blocking approval warnings. Consultant has final
 * authority — these inform, never block. */
export function computeApprovalWarnings(
  doc: Pick<ApplicationDocument, "wordMin" | "wordMax" | "characterLimit">,
  content: string,
): ApprovalWarning[] {
  const warnings: ApprovalWarning[] = [];
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const charCount = content.length;
  if (doc.wordMin && wordCount < doc.wordMin) {
    warnings.push({
      code: "WORD_COUNT_BELOW_MINIMUM",
      message: `${wordCount} words is ${doc.wordMin - wordCount} below the recommended minimum of ${doc.wordMin}`,
    });
  }
  if (doc.wordMax && wordCount > doc.wordMax) {
    warnings.push({
      code: "WORD_COUNT_ABOVE_MAXIMUM",
      message: `${wordCount} words is ${wordCount - doc.wordMax} above the recommended maximum of ${doc.wordMax}`,
    });
  }
  if (doc.characterLimit && charCount > doc.characterLimit) {
    warnings.push({
      code: "CHARACTER_LIMIT_EXCEEDED",
      message: `${charCount} characters exceeds the recommended limit of ${doc.characterLimit}`,
    });
  }
  return warnings;
}

export async function approveDocumentVersion(
  documentId: string,
  versionId: string,
): Promise<{ document: ApplicationDocument; version: DocumentVersion; warningsOverridden: ApprovalWarning[] }> {
  // Validate version belongs to document — real hard block
  const version = await validateVersionOwnership(versionId, documentId);
  const doc = await getDocument(documentId);
  if (!doc) {
    throw new Error("Document not found");
  }
  // Empty/corrupted version — real hard block
  if (!version.content || !version.content.trim()) {
    throw new Error("Cannot approve an empty version");
  }

  // Word/character constraints are WARNING ONLY — the consultant may
  // always override. Computed for audit, never thrown.
  const warnings = computeApprovalWarnings(doc, version.content);

  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock document row to serialize concurrent approvals
    await conn.execute(
      "SELECT id FROM application_documents WHERE id = ? FOR UPDATE",
      [documentId],
    );

    await conn.execute(
      "UPDATE application_documents SET approved_version_id = ?, review_status = 'APPROVED' WHERE id = ?",
      [versionId, documentId],
    );

    await conn.commit();
  } catch (err: any) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const updatedDoc = await getDocument(documentId);
  return { document: updatedDoc!, version, warningsOverridden: warnings };
}
