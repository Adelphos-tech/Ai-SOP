# API Contract Matrix — server-12b

**Codebase:** Next.js 14 App Router (`src/app/api/**/route.ts`)
**Generated:** exhaustive read of all route files + supporting libs (`consultant-session.ts`, `application-repository.ts`, `requirements-repository.ts`, `generation-service.ts`, `document-export.ts`, `application-context-repository.ts`, `discovery-pipeline.ts`, `search-provider.ts`, `html-extractor.ts`, `renderer.ts`, `rate-limiter.ts`, `openai-client.ts`, `application-types.ts`).

- **Total route files:** 27
- **Total exported HTTP methods:** 41
- **Error envelope variants observed:** `{ error }`, `{ error, code }`, `{ success: false, reason }`, `{ error, blockingIssues[, missingRequiredInformation] }`, `{ authenticated: false }` — see *Inconsistencies* at the end.

## CRITICAL AUTH NOTE

`requireConsultantSession()` in `src/lib/auth/consultant-session.ts` (lines 252–270) is **hard-bypassed**: it returns a dummy `{ id: "system", role: "ADMIN", isActive: true }` consultant **without checking any cookie/session**. Every route that "requires auth" is currently **effectively unauthenticated**. `authorizeStudentAccess()` (lines 311–327) only validates that `studentId` is a UUID (else throws `AuthError` 400 `INVALID_STUDENT_ID`) and that the consultant `isActive` (never false under the bypass). There is **no per-student ownership check** anywhere — single-org policy.

Throughout this document, `AUTH: bypassed` means the route calls `requireConsultantSession` but the call cannot fail today.

## Summary Table

| # | Method(s) | Route | Purpose | DB Tables |
|---|-----------|-------|---------|-----------|
| 1 | POST | /api/application/create | Create application for existing student | students, applications |
| 2 | POST | /api/application/cv-apply | Merge parsed CV into student profile (optimistic concurrency) | students |
| 3 | POST | /api/application/cv-upload | Upload + parse CV file (PDF/DOCX/TXT) | students + filesystem |
| 4 | POST | /api/application/document/export | Export document version as PDF/DOCX | students, applications, application_documents, document_versions |
| 5 | POST, GET | /api/application/document/generate | Canonical AI document generation | students, applications, application_documents, document_versions, writing_requirements, application_requirement_sets |
| 6 | POST, GET | /api/application/document | Create / read document(s) | application_documents, applications |
| 7 | POST | /api/application/faculty-alignment | Approve/reject faculty alignment (MIT-only, file-backed) | none (JSON files) |
| 8 | GET | /api/application/list | List applications / documents | applications, application_documents |
| 9 | GET, PUT | /api/application/profile | Read / save student profile w/ revision | students |
| 10 | POST | /api/application/save | Create student+application+document in one call | students, applications, application_documents |
| 11 | POST, GET | /api/application/student | Create / lookup / search / list students | students |
| 12 | POST | /api/application/version/approve | Approve a document version | applications, application_documents, document_versions |
| 13 | POST, GET | /api/application/version | Create / list document versions | document_versions, application_documents, applications |
| 14 | POST | /api/auth/login | Consultant login (sets session cookie) | consultants, consultant_sessions |
| 15 | POST, GET | /api/auth/session | Logout (POST) / current user (GET) | consultant_sessions, consultants |
| 16 | POST, GET | /api/benchmark/run | Run SOP pipeline on a benchmark case file | none (fs read + OpenAI) |
| 17 | GET | /api/metrics | Process/resource-limiter metrics | none |
| 18 | POST, GET | /api/requirements/discover | Crawl official pages for requirements | none DB (file cache + external HTTP + OpenAI) |
| 19 | GET | /api/requirements/library | List/search requirement sets | institutions, programs, application_requirement_sets, writing_requirements, requirement_sources |
| 20 | GET | /api/requirements/lookup | Lookup saved requirements by identity | institutions, programs, application_requirement_sets, writing_requirements |
| 21 | POST, GET | /api/requirements/resolve-prompt | Prompt-resolution decision tree | application_requirement_sets, writing_requirements (+ institutions, programs, requirement_sources on discovery) |
| 22 | POST, GET | /api/requirements/resolve | Resolve requirements brief + persist context | none DB (files + external fetch) |
| 23 | POST | /api/requirements/save | Persist verified requirement set | institutions, programs, application_requirement_sets, writing_requirements, requirement_sources |
| 24 | POST, GET | /api/requirements/verify | Pre-generation gate check | none (pure function) |
| 25 | POST, GET | /api/sop/generate-application | Generic 6-stage document generation | none (OpenAI) |
| 26 | POST, GET | /api/sop/generate-mit-cee | MIT CEE adapter over generic pipeline | none (fs artifacts + OpenAI) |
| 27 | POST, GET | /api/sop/generate | Legacy bridge → persistent architecture | students, applications, application_documents, document_versions |

---

## POST /api/application/create

**File:** `src/app/api/application/create/route.ts` (Phase SOP-AI-30)

AUTH: bypassed (requireConsultantSession returns dummy consultant)
AUTHZ: `authorizeStudentAccess(consultant, body.studentId)` — UUID-format check only
PATH PARAMS: none
QUERY: none
BODY:
  studentId: string (required) — must exist + pass UUID regex (via authz)
  universityName: string (required)
  programName: string (required)
  degree: string (required)
  department: string (optional)
  country: string (optional, default "")
  intake: string (optional, default "")
  intakeYear: string (optional, default "")
SUCCESS: 200 `{ success: true, application, student, totalApplications }`
ERRORS:
  400 — `{ error: "studentId is required" }` — missing studentId
  400 — `{ error: "universityName, programName, and degree are required" }` — missing fields
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — non-UUID studentId (from authz)
  404 — `{ error: "Student not found" }` — student does not exist
  4xx/5xx — `{ error, code }` — AuthError passthrough via `authErrorResponse`
  500 — `{ error }` — uncaught
SIDE EFFECTS: INSERT into `applications`; SELECT `students`, SELECT `applications` (list)
EXTERNAL: none
DB TABLES: students, applications

---

## POST /api/application/cv-apply

**File:** `src/app/api/application/cv-apply/route.ts`

AUTH: bypassed
AUTHZ: `authorizeStudentAccess(consultant, body.studentId)`
PATH PARAMS: none
QUERY: none
BODY:
  studentId: string (required)
  parsedCV: object (required) — structured CV from cv-upload (personalData, education[], experience[], projects[], skills{technical,programming,tools,domain,soft})
  profileRevision: number (required) — must equal current `students.profile_data._revision`
  overwrite: boolean (optional, default false) — false = fill empty fields only
SUCCESS: 200 `{ success: true, appliedFields: { personalData, education, experience, projects, skills }, revision }`
ERRORS:
  400 — `{ error: "studentId is required" }` / `{ error: "parsedCV is required" }`
  400 — `{ error, code: "MISSING_REVISION" }` — profileRevision not a number
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — authz UUID check
  404 — `{ error: "Student not found" }`
  409 — `{ error, code: "PROFILE_CHANGED", currentRevision, expectedRevision }` — stale revision (pre-check)
  409 — `{ error, code: "PROFILE_CHANGED" }` — lost update race in conditional save
  500 — `{ error }` — uncaught (logs "CV apply error:")
SIDE EFFECTS: UPDATE `students.profile_data` via `SELECT ... FOR UPDATE` transaction (conditional on revision); dedup merge for education (institution+degree), experience (org+role), projects (name); skill arrays merged w/ dedup
EXTERNAL: none (crypto.randomUUID only)
DB TABLES: students

---

## POST /api/application/cv-upload

**File:** `src/app/api/application/cv-upload/route.ts` — `export const maxDuration = 60`

AUTH: bypassed
AUTHZ: `authorizeStudentAccess(consultant, studentId)` (multipart field)
PATH PARAMS: none
QUERY: none
MULTIPART (formData):
  file: File (required) — ext must be .pdf/.docx/.txt; ≤10 MB; PDF magic bytes `%PDF`; DOCX ZIP structure + zip-bomb check via `validateDocx`
  studentId: string (required) — UUID
HEADERS: `content-length` checked pre-body (>10 MB+1 KB → 413); `x-forwarded-for`/`x-real-ip` for rate-limit key
RATE LIMIT: 30 uploads / 15 min / IP (in-memory) → 429 + `Retry-After` header
SUCCESS: 200 `{ success: true, filename, savedFilename, fileHash, uploadedAt, reused: boolean, parsed, profileRevision }`
ERRORS:
  413 — `{ error, code: "FILE_TOO_LARGE" }` — Content-Length > 10 MB + 1 KB
  429 — `{ error, code: "RATE_LIMITED" }` (+ Retry-After header) — per-IP rate limit
  400 — `{ error: "No file provided" }` / `{ error: "studentId is required" }`
  400 — `{ error }` — bad extension / not-%PDF / invalid DOCX / file.size > 10 MB
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — authz
  404 — `{ error: "Student not found" }`
  503 — `{ error, code: "CV_PARSE_BUSY" }` — cvParseLimiter saturated (ResourceBusyError)
  400 — `{ error: userMessage, code }` — parse failure; code ∈ IMAGE_ONLY_PDF | CORRUPT_OR_UNREADABLE_PDF | INSUFFICIENT_TEXT | PARSE_FAILED
  400 — `{ error: safeMessage, code }` — catch-all (unexpected errors also return **400, not 500**; parser stack never exposed; structured log `cv_upload_error`)
SIDE EFFECTS: writes `<SOP_CV_STORAGE>/<studentId>/<sha256>.bin` + `<sha256>.meta.json` (default `/opt/sop-ai-data/cv`, outside deployment tree); SHA-256 dedup → same file returns `reused:true` with cached parse; structured JSON logging (no CV text); concurrency-limited parse
EXTERNAL: filesystem (private storage); rule-based parser `parseCVFile` (no AI calls)
DB TABLES: students (getStudent, getStudentProfileRevision → profile_data)

---

## POST /api/application/document/export

**File:** `src/app/api/application/document/export/route.ts` (Phase SOP-AI-34A)

AUTH: bypassed
AUTHZ: `authorizeStudentAccess(consultant, body.studentId)` + `validateDocumentOwnership(documentId, applicationId, studentId)` + `validateVersionOwnership(versionId, documentId)`
PATH PARAMS: none
QUERY: none
BODY:
  studentId: string (required)
  applicationId: string (required)
  documentId: string (required)
  versionId: string (required)
  format: "PDF"|"DOCX" (optional, default "PDF"; case-insensitive, anything≠DOCX→PDF)
  mode: "PREVIEW"|"FINAL" (optional, default "PREVIEW"; anything≠FINAL→PREVIEW)
SUCCESS: 200 — binary body; headers `Content-Type` = application/pdf or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; `Content-Disposition: attachment; filename="..."`; `Content-Length`
ERRORS:
  400 — `{ error }` — missing studentId/applicationId/documentId/versionId
  400 — `{ error: "Approve a document version before final export." }` — FINAL w/o approvedVersionId
  400 — `{ error: "Final export must use the approved version." }` — versionId ≠ approvedVersionId
  400 — `{ error: "Final export blocked: N pages exceeds the limit of M." }` — FINAL+PDF page count > doc.pageLimit
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — authz
  403 — `{ error }` — validateDocumentOwnership failure
  403 — `{ error }` — validateVersionOwnership failure ("Version access denied")
  404 — `{ error: "Document not found" }` / `{ error: "Student or application not found" }`
  503 — `{ error, code: "EXPORT_BUSY" }` — ResourceBusyError (exportLimiter)
  500 — `{ error }` — uncaught
SIDE EFFECTS: none persistent (renders PDF via pdf-lib / DOCX via docx lib; `countPdfPages` re-renders PDF for page-limit check under exportLimiter)
EXTERNAL: pdf-lib, docx (no puppeteer for export)
DB TABLES: students, applications, application_documents, document_versions (all read-only)

---

## POST /api/application/document/generate

**File:** `src/app/api/application/document/generate/route.ts` (Phase SOP-AI-33 / SOP-INFRA-37) — `maxDuration = 300`

AUTH: bypassed
AUTHZ: `authorizeStudentAccess(consultant, body.studentId)`
PATH PARAMS: none
QUERY: none
HEADERS: `x-request-id` (optional; else randomUUID)
BODY:
  studentId: string (required)
  applicationId: string (required)
  documentId: string (required)
SUCCESS: passthrough of `generateApplicationDocument()` result — 200 `{ status: "success", generationId, documentType, version: { id, versionNumber, content, wordCount, model, costUsd, costInr, factReview, compliance }, pipeline: { stages, duration, cost{...}, promptResolution{source,path,mergedWithDefault} } }`
ERRORS (from service, surfaced verbatim):
  400 — `{ error }` — missing studentId/applicationId/documentId; also context-load failures (e.g., relationship mismatch, document not found) carry their own status from `loadDocumentGenerationContext`
  403 — `{ error: "GENERATION_BLOCKED", message, blockReasons, completenessIssues }` — pre-generation completeness block
  409 — `{ error: "GENERATION_ALREADY_IN_PROGRESS", message }` — generation lock conflict
  500 — `{ error: "PIPELINE_ERROR"|err, generationId, stages, partialCost }` — pipeline error (doc marked FAILED)
  503 — `{ error: "OPENAI_API_KEY_REQUIRED", message }` — OPENAI_API_KEY not set
  503 — `{ error, code: "RENDER_BUSY" }` — ResourceBusyError (releases generation lock)
  500 — `{ error: sanitized }` — uncaught; message sanitized (strips 127.0.0.1:port, localhost:port, /opt/*, /home/*, ERR_SSL_*, ≤500 chars); releases lock
SIDE EFFECTS: atomic generation lock on `application_documents` (SELECT FOR UPDATE); six-stage OpenAI pipeline; INSERT `document_versions` (createdByType=AI_GENERATED, studentFactsHash, requirementsHash, costUsd/costInr); UPDATE `application_documents.generation_status` → GENERATED/FAILED; structured JSON logs w/ requestId
EXTERNAL: OpenAI API (6-stage pipeline)
DB TABLES: students, applications, application_documents, document_versions, writing_requirements, application_requirement_sets

## GET /api/application/document/generate

AUTH: none (no session call)
SUCCESS: 200 `{ status: "ok", message: "Document generation endpoint. POST with { studentId, applicationId, documentId } to generate." }`
ERRORS: none
SIDE EFFECTS: none — health/info ping
EXTERNAL: none
DB TABLES: none

---

## POST /api/application/document

**File:** `src/app/api/application/document/route.ts` (Phase SOP-AI-29)

AUTH: bypassed
AUTHZ: **NONE** — no `authorizeStudentAccess` call and no ownership check on `applicationId` (inconsistency: GET enforces it, POST does not)
PATH PARAMS: none
QUERY: none
BODY:
  applicationId: string (required) — existence NOT verified before insert
  documentType: string (required) — must be in DOCUMENT_TYPE_LABELS: STATEMENT_OF_PURPOSE | ESSAY | SUPPLEMENTAL_QUESTION | MOA | PERSONAL_STATEMENT | STATEMENT_OF_ACADEMIC_PURPOSE | LETTER_OF_MOTIVATION | VISA_SOP | COVER_LETTER | LETTER_OF_RECOMMENDATION | CUSTOM
  promptText: string (required)
  promptSource: string (optional, default "CONSULTANT_PROVIDED") — must be in PromptSource set; "OFFICIAL_VERIFIED" or "DVIVID_DEFAULT_TEMPLATE" rejected with **403** unless `writingRequirementId` also supplied (any value passes the check)
  documentTitle: string (optional, defaults to documentType)
  writingRequirementId: string (optional) — links document→writing requirement after create
  wordMin, wordMax, characterLimit, pageLimit: number (optional)
  specialInstructions, facultyInstructions, formattingInstructions: string (optional)
SUCCESS: 200 `{ success: true, document }`
ERRORS:
  400 — `{ error }` — missing required fields / invalid documentType / invalid promptSource
  403 — `{ error }` — OFFICIAL_VERIFIED or DVIVID_DEFAULT_TEMPLATE without writingRequirementId
  500 — `{ error }` — uncaught
SIDE EFFECTS: INSERT `application_documents`; optional UPDATE `application_documents.writing_requirement_id` via `linkDocumentToWritingRequirement`
EXTERNAL: none
DB TABLES: application_documents

## GET /api/application/document

AUTH: bypassed
AUTHZ: `authorizeStudentAccess` only **if `studentId` query param present**; ownership re-verified against document's/application's studentId (403). Without studentId → **any document readable by id** (no authz at all)
QUERY:
  id: string (optional) — fetch single document
  applicationId: string (optional) — list documents for application
  studentId: string (optional) — enables authz + ownership validation
SUCCESS: 200 `{ document }` or `{ documents: [...] }`
ERRORS:
  400 — `{ error: "Provide id or applicationId parameter" }` — neither param
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — non-UUID studentId
  403 — `{ error: "Document does not belong to this student" }` / `{ error: "Application does not belong to this student" }`
  404 — `{ error: "Document not found" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: application_documents, applications

---

## POST /api/application/faculty-alignment

**File:** `src/app/api/application/faculty-alignment/route.ts`

AUTH: bypassed
AUTHZ: none (no student linkage — file-backed proposals)
PATH PARAMS: none
QUERY: none
BODY:
  applicationIdentity: { university, department, program, degree, intake } (required — **hardcoded equality check**: must be exactly MIT / "Civil and Environmental Engineering" / "Master of Engineering in Civil and Environmental Engineering" / "MEng" / "Fall 2027")
  alignmentId: string (required)
  action: "approve" | "reject" (required)
SUCCESS: 200 `{ success: true, alignmentId, facultyName, status: "STUDENT_APPROVED"|"REJECTED", timestamp }`
ERRORS (all use `{ success: false, reason }` envelope):
  400 — MISSING_FIELDS — alignmentId/action absent
  400 — INVALID_ACTION — action not approve/reject
  400 — INVALID_APPLICATION_IDENTITY — missing identity fields
  403 — APPLICATION_IDENTITY_MISMATCH — identity ≠ hardcoded MIT CEE MEng Fall 2027
  500 — PROPOSALS_NOT_FOUND — proposals JSON unreadable
  404 — PROPOSAL_NOT_FOUND — alignmentId not in proposals
  400 — UNVERIFIED_SOURCE — missing/non-`MIT-SRC-*` officialProgramFactSource
  400 — NO_STUDENT_EVIDENCE — no studentInterestEvidence
  409 — ALREADY_<STATUS> — proposal.status ≠ PROPOSED
  500 — INTERNAL_ERROR — uncaught
SIDE EFFECTS: reads/writes `logs/requirements/ai-permitted-live-test/faculty-alignment-proposals.json`; best-effort update of `faculty-alignment-gate-result.json` (recomputes gate counts, sets gateStatus CLEARED/BLOCKED, generationContractGate.readyForGeneration)
EXTERNAL: filesystem only
DB TABLES: none

---

## GET /api/application/list

**File:** `src/app/api/application/list/route.ts` (Phase SOP-AI-29)

AUTH: bypassed
AUTHZ: `authorizeStudentAccess` only if `studentId` param present; **no-param call lists ALL applications across all students**
QUERY:
  studentId: string (optional) — enables authz + scopes list
  applicationId: string (optional, precedence over studentId) — returns single app + documents
  limit: number (optional, default 100, **clamped ≤200**)
  offset: number (optional, default 0, **clamped ≥0**)
SUCCESS: 200 `{ application, documents }` | `{ applications: [...] }`
ERRORS:
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — non-UUID studentId
  403 — `{ error: "Application does not belong to this student" }` — studentId mismatch
  404 — `{ error: "Application not found" }` — bad applicationId
  500 — `{ error }` — uncaught
SIDE EFFECTS: none (read-only; listAllApplications joins document_count)
EXTERNAL: none
DB TABLES: applications, application_documents

---

## GET /api/application/profile

**File:** `src/app/api/application/profile/route.ts` (Phase SOP-AI-30)

AUTH: bypassed
AUTHZ: `authorizeStudentAccess(consultant, studentId)`
QUERY:
  studentId: string (required) — UUID
SUCCESS: 200 `{ student, profile, hasServerProfile: boolean, revision }`
ERRORS:
  400 — `{ error: "studentId is required" }`
  400 — `{ error, code: "INVALID_STUDENT_ID" }`
  404 — `{ error: "Student not found" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: students

## PUT /api/application/profile

AUTH: bypassed
AUTHZ: `authorizeStudentAccess(consultant, body.studentId)`
BODY:
  studentId: string (required)
  profileData: object (required) — full profile document; no field-level validation
  expectedRevision: number (optional) — presence triggers conditional (optimistic) save; **absence → unconditional overwrite** with `_revision` incremented (backward-compat footgun)
SUCCESS: 200 `{ success: true, revision }`
ERRORS:
  400 — `{ error: "studentId is required" }` / `{ error: "profileData is required" }`
  400 — `{ error, code: "INVALID_STUDENT_ID" }`
  404 — `{ error: "Student not found" }`
  409 — `{ error, code: "PROFILE_CHANGED" }` — conditional save failed
  500 — `{ error }` — uncaught
SIDE EFFECTS: UPDATE `students.profile_data` (conditional SELECT FOR UPDATE or plain update)
EXTERNAL: none
DB TABLES: students

---

## POST /api/application/save

**File:** `src/app/api/application/save/route.ts` (Phase SOP-AI-29)

AUTH: bypassed
AUTHZ: `authorizeStudentAccess` only if `body.student.id` provided (existing student reuse)
PATH PARAMS: none
QUERY: none
BODY:
  student: { id?, firstName*, lastName*, email*, phone?, country?, externalRefId?, profileData? } (required fields marked *)
  application: { universityName*, programName*, degree*, department?, country?, intake?, intakeYear? }
  document: { documentType*, promptText*, promptSource?, documentTitle?, wordMin?, wordMax?, characterLimit?, pageLimit?, specialInstructions?, facultyInstructions?, formattingInstructions? }
  Validation: documentType ∈ enum; promptSource ∈ enum (default CONSULTANT_PROVIDED); **OFFICIAL_VERIFIED → 403 always** ("can only be set by the server"). Note: `isUserSettablePromptSource` imported but NOT used.
SUCCESS: 200 `{ success: true, studentId, applicationId, documentId, student, application, document, duplicateEmailWarning: boolean }`
ERRORS:
  400 — `{ error }` — missing student/application/document fields; invalid documentType; invalid promptSource
  403 — `{ error: "OFFICIAL_VERIFIED prompt source can only be set by the server" }`
  404 — `{ error: "Student not found" }` — body.student.id given but missing
  500 — `{ error }` — uncaught
SIDE EFFECTS: get-or-create student by email (dedup → duplicateEmailWarning), INSERT applications, INSERT application_documents — **"one transaction" per comment but actually sequential inserts, not a DB transaction**
EXTERNAL: none
DB TABLES: students, applications, application_documents

---

## POST /api/application/student

**File:** `src/app/api/application/student/route.ts` (canonical New Applicant flow)

AUTH: bypassed
AUTHZ: none (new-student creation)
BODY:
  firstName: string (required)
  lastName: string (required)
  email: string (required) — no format validation
  phone, country, externalRefId: string (optional)
  profileData: object (optional)
SUCCESS: 200 `{ student, duplicate: boolean }` — email dedup returns existing student with duplicate:true
ERRORS:
  400 — `{ error: "firstName, lastName, and email are required" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: get-or-create by email; INSERT students
EXTERNAL: none
DB TABLES: students

## GET /api/application/student

AUTH: bypassed
AUTHZ: `authorizeStudentAccess` only when `id` param given; **email lookup, name search, and full list have NO per-record authz**
QUERY:
  id: string (optional) — fetch by id (+authz)
  email: string (optional) — lookup by email
  q: string (optional) — name search
  profile: "true" (optional) — include profile_data w/ id lookup
  list: "true" (optional) — paginated list mode
  limit: number (optional, default 25 — **no upper clamp**)
  offset: number (optional, default 0)
SUCCESS: 200 `{ student }` | `{ student, profile }` | `{ students, total, limit, offset }`
ERRORS:
  400 — `{ error: "Provide id, email, list=true, or q parameter" }`
  400 — `{ error, code: "INVALID_STUDENT_ID" }` — non-UUID id
  404 — `{ error: "Student not found" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: students

---

## POST /api/application/version/approve

**File:** `src/app/api/application/version/approve/route.ts` (Phase SOP-AI-34)

AUTH: bypassed
AUTHZ: `authorizeStudentAccess` + `validateDocumentOwnership(documentId, applicationId, studentId)`; hard constraints (word/char limits) enforced inside `approveDocumentVersion`
BODY:
  documentId: string (required)
  versionId: string (required)
  studentId: string (required)
  applicationId: string (required)
SUCCESS: 200 `{ success: true, document, version }`
ERRORS:
  400 — `{ error }` — missing fields; ALSO any error whose message contains "Approval blocked" (string-match discrimination)
  400 — `{ error, code: "INVALID_STUDENT_ID" }`
  403 — `{ error }` — ownership validation failure
  500 — `{ error }` — uncaught
SIDE EFFECTS: UPDATE `application_documents.approved_version_id`, `review_status='APPROVED'` (transactional w/ version check)
EXTERNAL: none
DB TABLES: applications, application_documents, document_versions

---

## POST /api/application/version

**File:** `src/app/api/application/version/route.ts` (Phase SOP-AI-29/34)

AUTH: bypassed
AUTHZ: `authorizeStudentAccess` only if `body.studentId` present; consultant-edit path additionally `validateDocumentOwnership`. **The "AI path" (no studentId, or presence of model/generationId) has NO ownership check and accepts arbitrary `createdByType` including "AI_GENERATED" from any caller** — the comment claims only the server calls it, but nothing enforces that.
BODY:
  documentId: string (required)
  content: string (required) — must be non-empty
  studentId: string (optional) — triggers authz; with applicationId + no model/generationId → consultant-edit path
  applicationId: string (optional)
  baseVersionId: string (optional, consultant path)
  contentFormat: string (optional, default "MARKDOWN")
  createdByType: string (optional, AI path, default "SYSTEM") — **unvalidated**
  model, generationId, studentFactsHash, requirementsHash, costUsd, costInr (optional, AI path)
SUCCESS: 200 `{ success: true, version }`
ERRORS:
  400 — `{ error: "documentId and content are required" }`
  400 — `{ error }` — consultant path messages containing "No changes to save" or "empty"
  400 — `{ error, code: "INVALID_STUDENT_ID" }`
  403 — `{ error }` — ownership failure (consultant path only)
  500 — `{ error }` — uncaught
SIDE EFFECTS: INSERT `document_versions` + UPDATE `application_documents.current_version_id` (consultant path forces createdByType=CONSULTANT_EDITED, review_status updates)
EXTERNAL: none
DB TABLES: document_versions, application_documents, applications

## GET /api/application/version

AUTH: bypassed
AUTHZ: **NONE** — no studentId param at all; any documentId lists all versions
QUERY:
  documentId: string (required)
SUCCESS: 200 `{ versions: [...] }` (ordered by version_number ASC)
ERRORS:
  400 — `{ error: "documentId parameter is required" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: document_versions

---

## POST /api/auth/login

**File:** `src/app/api/auth/login/route.ts`

AUTH: none (this IS the login)
AUTHZ: none
BODY:
  email: string (required) — trimmed + lowercased
  password: string (required)
SUCCESS: 200 `{ success: true, consultant: { id, email, name, role }, expiresAt }` + `Set-Cookie: dvivid_session=<token>; httpOnly; Secure; SameSite=Lax`
ERRORS:
  400 — `{ error, code: "MISSING_CREDENTIALS" }`
  401 — `{ error, code: "INVALID_CREDENTIALS" }` — constant-time (dummy-hash verify when user absent)
  403 — `{ error, code: "ACCOUNT_DISABLED" }` — is_active=0
  500 — `{ error, code: "LOGIN_ERROR" }` — uncaught
SIDE EFFECTS: SELECT `consultants`; INSERT `consultant_sessions` (stores token hash); sets session cookie. **Comment claims "max 10 failed attempts per email per 15 min" rate limit but NO rate limiting is implemented** — only the comment exists.
EXTERNAL: none
DB TABLES: consultants, consultant_sessions

---

## POST /api/auth/session

**File:** `src/app/api/auth/session/route.ts` — header comment says "POST /api/auth/logout" (mounted at /api/auth/session)

AUTH: implicit (uses cookie token if present; works even without session — destroySession is a no-op without token)
BODY: none
SUCCESS: 200 `{ success: true }` + clears `dvivid_session` cookie
ERRORS: none (never throws)
SIDE EFFECTS: DELETE `consultant_sessions` by token_hash; clear cookie
EXTERNAL: none
DB TABLES: consultant_sessions

## GET /api/auth/session

AUTH: implicit session check via `getConsultantSession` (cookie → DB join)
QUERY: none
SUCCESS: 200 `{ authenticated: true, consultant: { id, email, name, role }, expiresAt }`
ERRORS:
  401 — `{ authenticated: false }` — **different envelope** (no `error` field); also deletes expired session row
SIDE EFFECTS: may DELETE expired `consultant_sessions` row
EXTERNAL: none
DB TABLES: consultant_sessions, consultants

---

## POST /api/benchmark/run

**File:** `src/app/api/benchmark/run/route.ts` — `maxDuration = 300`

AUTH: bypassed
AUTHZ: none
BODY:
  caseId: string (required)
  caseFilePath: string (required) — **arbitrary filesystem path read verbatim (`fs.readFile`) → path traversal / arbitrary JSON read by any caller**
SUCCESS: 200 `{ caseId, status: "success", referenceLeakage, pipelineResult: { status, finalSop, wordCount, model, duration, stages, factReview{pass,unsupportedClaims,alteredClaims,ambiguousClaims}, qualityReview{scores,majorIssues,recommendedEdits}, languageProfile{level,tone}, cost }, referenceSop }`
ERRORS:
  503 — `{ error: "OPENAI_API_KEY_REQUIRED" }` — checked BEFORE auth? No — auth runs first, then key check
  400 — `{ error: "caseId and caseFilePath required" }`
  400 — `{ error: "REFERENCE_LEAKAGE_DETECTED", issues }`
  500 — `{ caseId, status: "error", error, partialCost, referenceLeakage }` — pipeline error (result-shaped error body, not `{error}`-only)
  500 — `{ error }` — uncaught (also catches JSON.parse failure of caseFilePath)
SIDE EFFECTS: reads arbitrary file from disk; runs full SOP pipeline
EXTERNAL: OpenAI; filesystem
DB TABLES: none

## GET /api/benchmark/run

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "Benchmark runner endpoint. Use POST with caseId and caseFilePath." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## GET /api/metrics

**File:** `src/app/api/metrics/route.ts`

AUTH: custom `isMetricsAuthorized()` — passes if (a) `x-forwarded-for`/`x-real-ip` absent OR is localhost/private IP (127.0.0.1, ::1, 10.*, 192.168.* — **header-spoofable**), or (b) `x-metrics-key` header === `METRICS_API_KEY` env. **Comment claims consultant session is an allowed method but the code never checks a session.**
QUERY: none
SUCCESS: 200 `{ process: { pid, uptimeSeconds, cpuPercent, rssMb, heapUsedMb, heapTotalMb, externalMb }, system: { loadAverage1, loadAverage5, loadAverage15, cpuCores }, eventLoop: { delayP95Ms }, resourceLimiters, admissionBackpressure, timestamp }`
ERRORS:
  401 — `{ error: "Authentication required" }`
SIDE EFFECTS: none (reads process metrics, perf_hooks event-loop monitor, os.loadavg/cpus)
EXTERNAL: node:perf_hooks, node:os
DB TABLES: none

---

## POST /api/requirements/discover

**File:** `src/app/api/requirements/discover/route.ts` — `maxDuration = 120`

AUTH: bypassed
AUTHZ: none (no student linkage)
BODY (ApplicationDiscoveryInput):
  university: string (required)
  program: string (required)
  country: string (required)
  degree, intake, intakeYear: string (optional — mapped into identity)
  forceRefresh: boolean (optional) — bypass file cache
SUCCESS: 200 — full `ApplicationDiscoveryResult` (`{ status, context?, brief?, aiPolicy?, diagnostics, cost, error? }`; status e.g. "VERIFIED")
ERRORS:
  400 — `{ error: "university, program, and country are required" }`
  503 — `{ error, code: "CRAWL_BUSY" }` — crawlLimiter saturated (ResourceBusyError)
  500 — `{ error }` — uncaught (logs "Discovery error:")
SIDE EFFECTS: external HTTP crawl (fetch w/ 15s timeout, custom UA "D-Vivid-SOP-AI-Requirements-Engine/1.0"), DuckDuckGo HTML search provider fallback, link extraction from university homepages; domain allow-list verification; AI classification/extraction via OpenAI (`discovery-ai`, `isApiKeyConfigured`); file cache read/write `logs/application-contexts/<applicationId>.json` + `logs/requirements/<cacheKey>.json`
EXTERNAL: outbound HTTP (university sites + DuckDuckGo), OpenAI, filesystem cache
DB TABLES: none (file-based stores)

## GET /api/requirements/discover

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "Official requirements discovery endpoint. Use POST with application identity." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## GET /api/requirements/library

**File:** `src/app/api/requirements/library/route.ts` (Phase SOP-AI-32)

AUTH: bypassed
AUTHZ: none
QUERY:
  q: string (optional) — institution name/domain search (LIKE, ≤50) → returns `{ institutions, requirementSets: [] }`
SUCCESS: 200 `{ requirementSets: [{ requirementSet, program, institution, writingRequirements, sources }] }` (up to 50 sets, enriched per-set) or `{ institutions, requirementSets: [] }` for q-mode
ERRORS:
  500 — `{ error }` — uncaught
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: institutions, programs, application_requirement_sets, writing_requirements, requirement_sources

---

## GET /api/requirements/lookup

**File:** `src/app/api/requirements/lookup/route.ts` (Phase SOP-AI-32)

AUTH: bypassed
AUTHZ: none
QUERY:
  university: string (required)
  program: string (required)
  degree: string (required)
  intake: string (required)
  intakeYear: string (required)
  country: string (optional)
SUCCESS: 200 — `findRequirementSetByAppIdentity` result: `{ result: "EXACT_FRESH_MATCH"|..., requirementSet?, writingRequirements?, ... }`
ERRORS:
  400 — `{ error: "university, program, degree, intake, and intakeYear are required" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: institutions, programs, application_requirement_sets, writing_requirements

---

## POST /api/requirements/resolve-prompt

**File:** `src/app/api/requirements/resolve-prompt/route.ts` (Phase SOP-AI-32) — `maxDuration = 120`

AUTH: bypassed
AUTHZ: none
BODY (ResolvePromptRequest):
  university, program, degree, intake, intakeYear: string (required)
  documentType: string (required) — must be valid DocumentType
  country: string (optional, default "USA" for discovery)
  manualPrompt: string (optional) — non-empty → short-circuits to MANUAL path
  manualPromptSource: PromptSource (optional) — must be USER_PROVIDED_PORTAL_PROMPT | CONSULTANT_PROVIDED | CUSTOM (OFFICIAL_VERIFIED/DVIVID_DEFAULT_TEMPLATE rejected)
  attemptDiscovery: boolean (optional, default true) — false skips crawl
SUCCESS: 200 `{ resolved: { source, promptText, documentType, documentTitle?, wordMin?, wordMax?, characterLimit?, pageLimit?, specialInstructions?, facultyInstructions?, formattingInstructions?, writingRequirementId?, requirementSetId?, resolutionPath: "MANUAL"|"DB_REUSED"|"DISCOVERY_SAVED"|"DEFAULT_TEMPLATE", discoveryAttempted?, discoveryStatus?, discoveryError? } }`
ERRORS:
  400 — `{ error }` — missing identity fields; invalid/missing documentType; invalid manualPromptSource
  500 — `{ error }` — uncaught
SIDE EFFECTS: DB lookup of requirement sets; on miss + attemptDiscovery → external crawl via `discoverRequirements` (HTTP + OpenAI classification) → `saveDiscoveredRequirementSet` INSERTs institution/program/requirement_set/writing_requirements/requirement_sources; **discovery errors are swallowed and resolved to DEFAULT_TEMPLATE** (never propagated)
EXTERNAL: outbound HTTP + OpenAI (only on discovery path)
DB TABLES: application_requirement_sets, writing_requirements (always); institutions, programs, requirement_sources (on DISCOVERY_SAVED)

## GET /api/requirements/resolve-prompt

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "...", flow: [4-step decision tree strings] }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## POST /api/requirements/resolve

**File:** `src/app/api/requirements/resolve/route.ts` — `maxDuration = 60`

AUTH: bypassed
AUTHZ: none
BODY (RequirementsResolutionRequest):
  applicationIdentity: { country*, university*, program*, degreeLevel?, intake?, intakeYear? } (required; country+university+program enforced)
  forceRefresh: boolean (optional)
  studentProvidedRequirementsUrl: string (optional)
  studentProvidedAiPolicyUrl: string (optional)
SUCCESS: 200 — `resolveRequirements` result `{ brief, aiPolicy, ... }`, plus `applicationId` when brief+aiPolicy present (context persisted)
ERRORS:
  400 — `{ error: "applicationIdentity is required" }`
  400 — `{ error: "country, university, and program are required in applicationIdentity" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: resolver does external fetches of official pages (requirements + AI-policy URLs via domain-verification registry / student-provided URLs); file cache (`logs/requirements/<cacheKey>.json` via requirements-db); on success writes `logs/application-contexts/<applicationId>.json` (VerifiedApplicationContext w/ contentHash, verificationStatus)
EXTERNAL: outbound HTTP to official domains; filesystem
DB TABLES: none (file-based persistence)

## GET /api/requirements/resolve

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "Requirements resolver endpoint. Use POST with applicationIdentity." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## POST /api/requirements/save

**File:** `src/app/api/requirements/save/route.ts` (Phase SOP-AI-32) — "server-controlled entry point"

AUTH: bypassed — **comment says only the server can create OFFICIAL_VERIFIED requirements, but this is a public HTTP route and auth is bypassed: any caller can mint OFFICIAL_VERIFIED rows**
AUTHZ: none
BODY:
  university, program, degree, intake, intakeYear: string (required)
  country, officialDomain, department: string (optional)
  verificationStatus: string (optional, default "VERIFIED") — **unvalidated, client-controlled**
  aiPolicyStatus: string (optional)
  aiPolicyData: object (optional)
  writingRequirements: array (optional) — items { documentType, officialTitle?, promptText, required?, wordMin?, wordMax?, characterLimit?, pageLimit?, specialInstructions?, facultyInstructions?, formattingInstructions? } — **promptSource forced to OFFICIAL_VERIFIED server-side**
  sources: array (optional) — items { sourceUrl, officialDomain?, sourceTitle?, sourceScope? (default "UNIVERSITY"), sourceType?, contentHash? }
SUCCESS: 200 `{ success: true, institutionId, programId, requirementSetId, contentHash, writingRequirements, sources }`
ERRORS:
  400 — `{ error: "university, program, degree, intake, and intakeYear are required" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: find-or-create institution (name match) & program; computeRequirementSetHash; find-or-create requirement set (else UPDATE verificationStatus/hash/timestamps); INSERT one `writing_requirements` row per item (componentOrder=index); INSERT one `requirement_sources` row per item
EXTERNAL: none
DB TABLES: institutions, programs, application_requirement_sets, writing_requirements, requirement_sources

---

## POST /api/requirements/verify

**File:** `src/app/api/requirements/verify/route.ts`

AUTH: bypassed
AUTHZ: none
BODY:
  profile: object (required)
  brief: VerifiedApplicationBrief | null (optional)
SUCCESS: 200 `{ allowed: boolean, blockingIssues: [...] }` (pure `checkGenerationGate` output)
ERRORS:
  400 — `{ error: "profile is required" }`
  500 — `{ error }` — uncaught
SIDE EFFECTS: none — pure function
EXTERNAL: none
DB TABLES: none

## GET /api/requirements/verify

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "Requirements verification gate. Use POST with profile and brief." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## POST /api/sop/generate-application

**File:** `src/app/api/sop/generate-application/route.ts` — `maxDuration = 300`; MAX_PIPELINE_CALLS: 6

AUTH: bypassed — **but `isApiKeyConfigured()` check runs BEFORE auth** (unauthenticated callers get 503 first)
AUTHZ: none
BODY:
  (body must be JSON object, ≤500,000 chars serialized → 413)
  profile: object (required) — must have `factSheetApproval.approved === true` → else **403**
  brief | requirementsBrief: object (required → 422)
  aiPolicy | aiUsagePolicy: object (required → 422)
  responseComponents: array (required non-empty → 422)
  pageLimit: object (optional, default `{ type:"PER_DOCUMENT", maxPages:null, status:"NOT_SPECIFIED_BY_OFFICIAL_SOURCE" }`)
  facultyAlignment: array (optional, default [] — must be array → 400)
  programContext: object (optional)
  execution: { mode: "CONTENT_REGENERATION"|"TECHNICAL_STAGE_RETRY", generationId? } (optional; invalid → 400)
SUCCESS: 200 `{ status, generationId, documentType, responseComponentCount, responses, finalText, wordCount, model, stages, duration, planner, qualityReview, factReview, compliance, cost: { usage{inputTokens,cachedInputTokens,outputTokens,totalTokens}, estimatedUsd, estimatedInr, exchangeRate, stages } | null }`
ERRORS — two envelopes mixed: `{ success:false, reason }` for early validation, `{ error, ... }` for contract/pipeline failures:
  503 — `{ success:false, reason:"OPENAI_API_KEY_REQUIRED" }`
  400 — INVALID_REQUEST / INVALID_EXECUTION / PROFILE_REQUIRED / INVALID_FACULTY_ALIGNMENT
  403 — FACT_SHEET_NOT_APPROVED — profile.factSheetApproval.approved !== true
  422 — APPLICATION_REQUIREMENTS_UNVERIFIED — no brief
  422 — APPLICATION_AI_POLICY_BLOCK — no aiPolicy
  422 — NO_RESPONSE_COMPONENTS — empty responseComponents
  403 — `{ error:"APPLICATION_AI_POLICY_BLOCK", blockingIssues }` — contract build
  403 — `{ error:"APPLICATION_REQUIREMENTS_UNVERIFIED", blockingIssues }` — contract build
  403 — `{ error:"APPLICATION_REQUIREMENT_CONFLICT", blockingIssues }`
  422 — `{ error:"MISSING_REQUIRED_STUDENT_INFORMATION", blockingIssues, missingRequiredInformation }`
  403 — `{ error:"CONTRACT_NOT_CLEARED", status, blockingIssues }` — any other non-CLEARED
  403 — `{ error:"CONTRACT_VALIDATION_FAILED", reason }`
  500 — `{ error, generationId, stages, partialCost }` — pipeline error
  500 — `{ error: "An unexpected error occurred." }` — uncaught (sanitized, no message passthrough)
SIDE EFFECTS: none persistent — runs in-memory 6-stage pipeline
EXTERNAL: OpenAI
DB TABLES: none

## GET /api/sop/generate-application

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "Generic application generation endpoint. Use POST." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## POST /api/sop/generate-mit-cee

**File:** `src/app/api/sop/generate-mit-cee/route.ts` — `maxDuration = 300`; thin adapter, no MIT-specific pipeline logic

AUTH: bypassed — `isApiKeyConfigured()` before auth (same as generate-application)
AUTHZ: none — but cross-checks profile.application identity vs brief identity vs proposals identity (all three must agree) → 403 APPLICATION_IDENTITY_MISMATCH
BODY:
  profile: object (required) — `factSheetApproval.approved === true` → else 403; `application` sub-object must match brief identity exactly (country/university/program/degreeLevel/intake/intakeYear)
  execution: { mode, generationId? } (optional; same enum validation → 400)
SUCCESS: 200 — same shape as generate-application plus `generationContract: { status, clearedForWriting }`
ERRORS:
  503 — `{ success:false, reason:"OPENAI_API_KEY_REQUIRED" }`
  400 — INVALID_REQUEST / INVALID_EXECUTION
  403 — FACT_SHEET_NOT_APPROVED
  422 — MISSING_FACULTY_APPROVAL — zero STUDENT_APPROVED proposals w/ valid approvedAt + verifiedFacultyEvidence + studentInterestEvidence
  403 — APPLICATION_IDENTITY_MISMATCH — three-way identity check fails
  422/403 — `{ error: <contractStatus>, blockingIssues, missingRequiredInformation }` — 422 only for MISSING_REQUIRED_STUDENT_INFORMATION, else 403
  403 — `{ error:"CONTRACT_VALIDATION_FAILED", reason }`
  500 — `{ error, generationId, stages, partialCost }` — pipeline error
  500 — `{ error: "An unexpected error occurred." }` — uncaught; **also catches missing/unreadable artifact JSON files as generic 500**
SIDE EFFECTS: reads 4 artifact JSONs from `logs/requirements/ai-permitted-live-test/` (verified-application-brief.json, ai-usage-policy.json, response-components.json, faculty-alignment-proposals.json); filters STUDENT_APPROVED faculty proposals
EXTERNAL: OpenAI, filesystem
DB TABLES: none

## GET /api/sop/generate-mit-cee

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "MIT CEE adapter endpoint. Delegates to generic pipeline." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

## POST /api/sop/generate

**File:** `src/app/api/sop/generate/route.ts` — `maxDuration = 300`; LEGACY_COMPATIBILITY_ROUTE bridging legacy StudentProfile → persistent Student→Application→Document→Version. Only pre-generation gate = fact-sheet approval.

AUTH: bypassed
AUTHZ: **none** — no `authorizeStudentAccess` (studentId is derived internally, not supplied)
BODY: bare legacy profile object:
  (must be JSON object; `body.profile.personalDetails` present → rejected as LEGACY_WRAPPED_FORMAT_UNSUPPORTED)
  personalDetails: { firstName, lastName, ... } (required → 400 PROFILE_REQUIRED)
  factSheetApproval.approved: true (required → **403 FACT_SHEET_NOT_APPROVED**)
  education[], experience[], projects[], careerGoals{}, personalStory{}, englishProficiency{}, writingPreferences.sopWritingProfile{} (optional — all fields defaulted)
  application: { targetUniversity?, targetProgram?, degreeLevel?, targetCountry?, intake?, intakeYear?, sopQuestion?, wordRequirement?, minWords?, maxWords?, maxCharacters? } (optional — defaults "Unknown University"/"Unknown Program"/"Master"/etc.)
SUCCESS: 200 — generation-service success body spread + `{ workspaceUrl: "/students/<sid>/applications/<aid>/documents/<did>", studentId, applicationId, documentId }`
ERRORS:
  400 — `{ error: "INVALID_REQUEST" }` — non-object body
  400 — `{ error: "LEGACY_WRAPPED_FORMAT_UNSUPPORTED", message }` — wrapped profile shape
  400 — `{ error: "PROFILE_REQUIRED" }`
  403 — `{ error: "FACT_SHEET_NOT_APPROVED", message }`
  + all generation-service statuses passthrough: 4xx context-load, 403 GENERATION_BLOCKED, 409 GENERATION_ALREADY_IN_PROGRESS, 500 PIPELINE_ERROR, 503 OPENAI_API_KEY_REQUIRED
  500 — `{ error: sanitized }` — uncaught (same sanitizer as document/generate: strips IPs/ports/paths/SSL, ≤500 chars)
SIDE EFFECTS: **synthesizes student email `<first>.<last>@dvivid.student`** (same-name students collide → shared student record); get-or-create student; saveStudentProfile (full legacy→persistent mapping, forces factSheetApproval.approved=true, resets _revision semantics); get-or-create application by (university,program,intake,intakeYear) match; get-or-create SOP document; **for DVIVID_DEFAULT_TEMPLATE path does a raw `INSERT INTO application_documents` via getDbPool bypassing `createDocument`** (missing special_instructions/faculty_instructions/formatting_instructions/page_limit columns and link logic); then generateApplicationDocument → document_versions INSERT + status updates
EXTERNAL: OpenAI; direct SQL
DB TABLES: students, applications, application_documents, document_versions

## GET /api/sop/generate

AUTH: none
SUCCESS: 200 `{ status: "ok", message: "SOP generation endpoint (bridged to persistent architecture). POST with profile to generate." }`
ERRORS: none
SIDE EFFECTS: none
EXTERNAL: none
DB TABLES: none

---

# INCONSISTENCIES & OBSERVATIONS

## 1. Authentication is decorative
- `requireConsultantSession()` is a **no-op stub** returning a dummy `system` ADMIN consultant (`consultant-session.ts:252–270`). Every "secured" route is publicly callable. `authorizeStudentAccess` only checks UUID format — there is no real per-student authorization anywhere (single-org policy hardcoded).
- `GET /api/metrics` comment claims consultant session is an accepted auth method; the code only checks source IP headers and `x-metrics-key`. The localhost check trusts `x-forwarded-for` — trivially spoofable by an external client.
- `POST /api/auth/login` contains a comment claiming a "max 10 failed attempts per email per 15 min" rate limit — **no such limiting exists in code**; the only rate limiting in the codebase is on cv-upload.
- `/api/auth/session` file header documents it as `/api/auth/logout` + `/api/auth/me`; it is actually mounted at `/api/auth/session`.

## 2. Error envelope shapes differ across routes
- Most routes: `{ error }` or `{ error, code }`.
- `faculty-alignment`, `sop/generate-application`, `sop/generate-mit-cee`: `{ success: false, reason }` for validation errors, but `{ error, blockingIssues }` for contract failures — **two envelopes inside the same handler**.
- `auth/session` GET 401: `{ authenticated: false }` — no `error` field.
- `benchmark/run` pipeline error: `{ caseId, status:"error", error, partialCost, referenceLeakage }` — result-shaped error body.

## 3. Inconsistent HTTP status usage
- **403 used for business-rule/state gates**, not authorization: `FACT_SHEET_NOT_APPROVED` (sop/generate, sop/generate-application, generate-mit-cee), `APPLICATION_IDENTITY_MISMATCH` (faculty-alignment, generate-mit-cee), prompt-source restrictions (`application/document` POST OFFICIAL_VERIFIED/DVIVID_DEFAULT_TEMPLATE → 403; `application/save` → 403), `APPLICATION_AI_POLICY_BLOCK`, `APPLICATION_REQUIREMENTS_UNVERIFIED`, `APPLICATION_REQUIREMENT_CONFLICT`, `CONTRACT_NOT_CLEARED`, `CONTRACT_VALIDATION_FAILED`.
- **422 used inconsistently**: `sop/generate-application` uses 422 for missing brief/aiPolicy/responseComponents/missing-info, while `sop/generate-mit-cee` uses 422 only for MISSING_REQUIRED_STUDENT_INFORMATION and 403 elsewhere — same contract statuses mapped differently.
- **400 vs 409**: cv-apply uses 409 PROFILE_CHANGED (good); `application/version` POST maps "No changes to save" → 400 by substring-matching error messages (fragile); `version/approve` maps "Approval blocked" → 400 the same fragile way.
- `cv-upload`'s outer catch returns **400 for unexpected server errors** (should be 500), while its sibling routes return 500.
- 413 used in two different ways: Content-Length pre-check (cv-upload) vs serialized-body-size check (sop routes) — fine but undocumented.

## 4. Missing or asymmetric authorization
- `POST /api/application/document` has **no authorizeStudentAccess call and never validates that applicationId exists or belongs to anyone** — its GET sibling does both.
- `POST /api/application/version` "AI path" has **no ownership check**; any caller can create a version with arbitrary `createdByType` (including `AI_GENERATED`) and forged `model`/`generationId`/cost fields. The code comment asserts only the server uses it; nothing enforces that.
- `GET /api/application/version` — no authz at all; any documentId enumerates versions.
- `GET /api/application/student` — email lookup, `q` search, and `list=true` have no per-record authz; only `id` triggers it.
- `GET /api/application/document` and `GET /api/application/list` — authz only when `studentId` is supplied; omitted → cross-student reads (`listAllApplications`, document-by-id).
- `POST /api/requirements/save` — described as "server-controlled entry point" for OFFICIAL_VERIFIED data, yet it's a public route; combined with the auth bypass, anyone can mint verified requirements.
- `POST /api/sop/generate` — no authorizeStudentAccess (studentId is internal); combined with the synthetic-email scheme (`first.last@dvivid.student`), same-name students silently share one record.

## 5. Validation gaps
- `benchmark/run` `caseFilePath` is read verbatim with `fs.readFile` — **arbitrary file read / path traversal** (no path whitelist).
- `faculty-alignment` and `generate-mit-cee` are hardcoded to a single MIT CEE MEng Fall 2027 application and read mutable JSON artifacts from `logs/` — not a general-purpose API despite the generic-sounding path.
- `application/save` imports `isUserSettablePromptSource` but never calls it; `document` POST lets `OFFICIAL_VERIFIED`/`DVIVID_DEFAULT_TEMPLATE` through whenever any `writingRequirementId` is present (the check is a gate on presence, not validity).
- `profile` PUT silently falls back to an unconditional overwrite when `expectedRevision` is omitted — optimistic concurrency is opt-in.
- `student` GET `limit` has no upper bound (contrast `application/list` which clamps to 200).
- No email-format validation on student creation (`student` POST, `save`, `login` just trims/lowercases).
- `requirements/save` accepts client-supplied `verificationStatus` (defaults VERIFIED) — a caller can mark anything verified.

## 6. Implementation oddities
- `application/save` comment claims "one transaction"; it's three sequential repo calls with no DB transaction — partial writes possible (student created, application fails → orphan student).
- `sop/generate` bypasses `createDocument` with a raw `INSERT INTO application_documents` for the DVIVID_DEFAULT_TEMPLATE path — duplicating schema knowledge and omitting columns the normal path supports (special/faculty/formatting instructions, page_limit).
- Health-check `GET` handlers return `{status:"ok"}` in 9 routes but with inconsistent shapes (some include a `flow` array, all unauthenticated — fine, but undocumented).
- ResourceBusyError codes differ per route: `RENDER_BUSY` (generate), `EXPORT_BUSY` (export), `CV_PARSE_BUSY` (cv-upload), `CRAWL_BUSY` (discover) — no shared code taxonomy.
- `resolve-prompt` swallows all discovery errors into `DEFAULT_TEMPLATE` with `discoveryStatus:"DISCOVERY_ERROR"` — callers can never distinguish a crawl outage from "no info found".
- `requirements/resolve` and `faculty-alignment`/`generate-mit-cee` persist state to `logs/` JSON files while the rest of the system uses MySQL — two persistence paradigms for requirement data (file-based `requirements-db`/`application-contexts` vs DB tables `application_requirement_sets`/`writing_requirements`).
- `document/export` FINAL-mode PDF page check re-renders the PDF a second time (`countPdfPages` then `exportDocument`) — double render cost.
