# PHASE SOP-AI-5 — Verified Faculty Matching + Student Approval

**Date:** Wed 9 Sep 2026
**Phase:** SOP-AI-5 — Faculty Alignment Resolution
**Objective:** Resolve the remaining MIT preflight blocker (MISSING_REQUIRED_STUDENT_INFORMATION for faculty alignment) by finding verified MIT CEE faculty matches and building a student approval workflow.

**IMPORTANT:** No SOP generation in this phase. No OpenAI writing calls.

---

## STUDENT RESEARCH EVIDENCE: AVAILABLE

### Approved Student Fact IDs Used

| Fact ID | Category | Text |
|---|---|---|
| EDU-001 | education | BTech Civil Engineering, IIT Bombay, CGPA 8.5/10 |
| EXP-001 | professional-experience | Structural Engineering Intern at L&T Construction (FEA, structural modeling, steel optimization) |
| PROJ-001 | academic-project | Seismic Response Analysis of High-Rise Buildings (response spectrum analysis, 20-story RC building) |
| ACH-001 | academic-achievement | Best Undergraduate Thesis Award for structural optimization techniques |
| CG-001 | career-goal | Passionate about structural engineering and sustainable infrastructure design |
| CG-002 | career-goal | MIT CEE MEng program offers advanced coursework and real-world projects |

### Research Themes

| Theme | Evidence IDs | Confidence |
|---|---|---|
| Structural engineering | EDU-001, EXP-001, PROJ-001, ACH-001, CG-001 | HIGH |
| Seismic analysis / earthquake engineering | PROJ-001 | MEDIUM |
| Structural optimization | EXP-001, ACH-001 | MEDIUM |
| Finite element analysis / structural modeling | EXP-001, PROJ-001 | MEDIUM |
| Sustainable infrastructure | CG-001 | LOW |

### Sufficient Interest Gate

| Field | Value |
|---|---|
| hasUsableResearchInterest | true |
| Primary research area | Structural engineering |
| Reason | Student has clear structural engineering background with specific project work in seismic analysis and structural optimization |

---

## OFFICIAL MIT FACULTY CANDIDATES: 2

### Candidate 1: Oral Buyukozturk

| Field | Value |
|---|---|
| Faculty | Oral Buyukozturk |
| Official Title | Professor, Post-Tenure |
| Official Research Areas | Resiliency and sustainability of infrastructure; multiscale concrete mechanics; energy efficient cement-based materials; novel sensing and monitoring for intelligent built environment; seismic structural response prediction; structural identification and damage detection; structural health monitoring |
| Labs | Laboratory for Infrastructure Science and Sustainability (LISS) |
| Research Website | http://web.mit.edu/liss/ |
| Official Source | https://cee.mit.edu/people_individual/oral-buyukozturk-2/ |
| Student Evidence Matched | PROJ-001 (seismic analysis project), EXP-001 (structural engineering internship), ACH-001 (structural optimization thesis) |
| Relevance Score | 85 |
| Status | **PROPOSED** |

**Alignment Reason:** The student's approved profile shows seismic response analysis of a 20-story RC building, structural engineering internship with finite element analysis, and structural optimization thesis. Professor Buyukozturk's verified research focuses on seismic structural response prediction, structural identification and damage detection, structural health monitoring, and structural mechanics — directly overlapping with the student's demonstrated experience.

### Candidate 2: Josephine V. Carstensen

| Field | Value |
|---|---|
| Faculty | Josephine V. Carstensen |
| Official Title | Gilbert W. Winslow (1937) Career Development Professor in Civil Engineering, Associate Professor |
| Official Research Areas | Digitalization of design and manufacturing for built environment; structural mechanics and mathematical optimization; design methods from material architectures to large scale structural design; topology optimization of structures |
| Labs | N/A |
| Research Website | https://www.carstensen.mit.edu |
| Official Source | https://cee.mit.edu/people_individual/josephine-v-carstensen/ |
| Student Evidence Matched | ACH-001 (structural optimization thesis), PROJ-001 (structural analysis project), CG-001 (structural engineering passion) |
| Relevance Score | 78 |
| Status | **PROPOSED** |

**Alignment Reason:** The student's approved profile shows structural optimization thesis, structural analysis project, and stated passion for structural engineering. Professor Carstensen's verified research focuses on structural mechanics and mathematical optimization, topology optimization of structures, and design methods — directly overlapping with the student's demonstrated interest in structural optimization and design.

---

## OFFICIAL-SOURCE ENFORCEMENT: PASS

- Both candidates sourced exclusively from `cee.mit.edu` (official MIT CEE domain)
- No third-party sources (LinkedIn, ResearchGate, Wikipedia, etc.) used
- Faculty research claims verified from official MIT faculty profile pages
- All source IDs follow `MIT-SRC-*` naming convention

## THIRD-PARTY SOURCE REJECTION: PASS

- No third-party sources present in faculty candidates
- API code rejects any source not starting with `MIT-SRC-`

## APPLICATION-SPECIFIC ISOLATION: PASS

- Proposals are scoped to: MIT + CEE + MEng + Fall 2027
- API verifies all 5 identity fields before approving/rejecting
- MIT alignment cannot be reused for Stanford, Harvard, another MIT department, or another program

## STUDENT APPROVAL REQUIRED: PASS

- `STUDENT_APPROVED` is the only status that satisfies the faculty requirement
- `PROPOSED` alignments block generation
- `REJECTED` alignments are unusable

## AUTOMATIC APPROVAL: NO

- All proposals are in `PROPOSED` status
- No proposal was automatically approved
- The fictional demo student has NOT approved any alignment yet
- Student must explicitly click "Approve Alignment" in the UI

## STUDENT-APPROVED ALIGNMENTS: 0

No student-approved faculty alignment exists yet. Generation remains blocked until the student approves at least one proposal.

---

## PLURAL FACULTY REQUIREMENT

| Field | Value |
|---|---|
| Official prompt text | "including the name(s) of faculty members with whom you would like to work" |
| pluralExpected | true |
| minimumRequired | UNKNOWN |
| Note | The official prompt does not specify a minimum number. The system recommends multiple options without claiming MIT requires a specific count. |

---

## GENERATION CONTRACT BEFORE APPROVAL: BLOCKED

| Gate | Result |
|---|---|
| Requirements Gate | PASS |
| AI Policy Gate | PASS |
| Faculty Alignment Gate | BLOCKED |
| Generation Contract | BLOCKED |
| Blocking Reason | MISSING_REQUIRED_STUDENT_INFORMATION: No student-approved faculty alignment exists. |
| OpenAI Writing Calls | 0 |

---

## TESTS: 39/39 PASS

| Test | Description | Result |
|---|---|---|
| A | Approved student research interests exist → faculty matching allowed | PASS |
| B | No student research interests → matching blocked | PASS |
| C | Faculty source official MIT → candidate allowed | PASS |
| D | Faculty source third-party → rejected | PASS |
| E | Student facts + official faculty evidence overlap → PROPOSED | PASS |
| F | Proposal exists but not approved → BLOCKED | PASS |
| G | STUDENT_APPROVED alignment → PASS | PASS |
| H | REJECTED alignment → cannot satisfy requirement | PASS |
| I | MIT alignment cannot be reused for another university | PASS |
| J | MIT CEE alignment cannot be reused for another MIT program | PASS |
| K | Browser submits arbitrary faculty → API rejects | PASS |
| L | Harvard regression → remains blocked by AI policy | PASS |

### Test Counts

- Faculty Alignment Tests (A-L): 39/39 PASS
- MIT Preflight Tests: 32/32 PASS
- Generation Contract Fixtures: 19/19 PASS
- AI Policy Fixtures: 15/15 PASS
- **Total: 105/105 PASS**

---

## NEW CODE

| File | Purpose |
|---|---|
| `src/app/api/application/faculty-alignment/route.ts` | Approval/rejection API (POST) |
| `src/components/requirements/FacultyAlignmentPanel.tsx` | Student-facing faculty alignment UI |
| `tests/run-faculty-alignment-tests.ts` | Deterministic tests A-L |

### API Endpoints

| Endpoint | Method | Action |
|---|---|---|
| `/api/application/faculty-alignment` | POST | Approve or reject a faculty alignment proposal |

### API Validation

- Application identity must match MIT CEE MEng Fall 2027 exactly
- Alignment proposal must exist by `alignmentId`
- All sources must start with `MIT-SRC-` (official MIT)
- Student interest evidence must exist
- Only `PROPOSED` proposals can be approved/rejected

---

## ARTIFACTS

```
/opt/sop-ai-app/logs/requirements/ai-permitted-live-test/
  student-research-profile.json
  verified-faculty-sources.json
  faculty-candidates.json
  faculty-alignment-proposals.json  ← all PROPOSED, none approved
  faculty-alignment-gate-result.json
```

---

## OPENAI SOP-WRITING CALLS: 0

No Planner, Writer, Fact Reviewer, Quality Reviewer, Language Calibrator, or Finalizer calls were made.

---

## NEXT STEPS

1. Review the two faculty proposals (Buyukozturk at 85%, Carstensen at 78%)
2. Approve one or both alignments via the Faculty Alignment UI
3. Re-run the Generation Contract to verify it clears
4. Then proceed to the live end-to-end generation test
