# UI / DATA FLOW UPDATE — 9 CANONICAL SOP SECTIONS

**Project:** D-Vivid Application Writer
**Application:** /opt/sop-ai-app/
**Date:** 2026-09-12

---

## TRACKER: PASS

Replaced the 7-step generic workflow tracker with a 9-section intake tracker:
1. Student Details
2. Field Motivation
3. Academics & Projects
4. Work Experience
5. Master's Motivation
6. Country Questions
7. Subject Requirements
8. University Requirements
9. Career Goals

- Desktop: 9-column grid, all steps visible without scrollbar
- Mobile: horizontal scroll with hidden scrollbar
- Completed: blue check mark (clickable to edit)
- Current: solid blue border
- Upcoming: gray
- Consultant can click completed steps to edit them

---

## STUDENT DETAILS: PASS

Fields: First Name, Last Name, Email, Phone, Date of Birth, Nationality, Current City, Current Country
Education: Multiple records with Degree Level, Institution, Field/Major, CGPA, GPA Scale, Start Year, Graduation Year, Backlogs
"+ Add Education" button for multiple records.

---

## FIELD MOTIVATION: PASS

Optional section. Large textarea with helper prompts:
- What first interested you in this field?
- Was there a course, project, person or experience that influenced you?
- Why do you enjoy studying this subject?

"Skip for now" button provided.

---

## ACADEMICS & PROJECTS: PASS

**Projects:** Project Name, Type, Description, Role, Objective, Tools/Technologies, Methods, Outcome, Challenges, What Learned, Why Chosen. "+ Add Project" button.

**Subjects Learned:** Subject Name, Important Topics, Relevance to future study. "+ Add Subject" button.

**Skills:** Technical Skills, Tools, Software, Programming Languages, Domain Skills, Soft Skills (comma-separated).

---

## WORK EXPERIENCE: PASS

Types: Internship, Full-time Job, Part-time Job, Research Role, Other Experience
Fields: Organization, Role, Location, Start Date, End Date, Currently Working toggle, Responsibilities, Achievements, Tools/Skills Used, Key Learning, Relevance to Master's
"+ Add Experience" button for multiple records.

---

## MASTER'S MOTIVATION: PASS

Fields: Why this field?, Why now?, Knowledge/skill gaps, Academic motivation, Professional motivation, Expected learning, How master's supports career plans
Kept separate from country/university motivation.

---

## COUNTRY QUESTIONS: PASS

Country selection dropdown (USA, UK, Canada, Australia, Germany, Other).
After selection, dynamically displays country-specific questions from config-driven `countryQuestionnaire[country]`.
Questions are NOT hardcoded in UI components — loaded from `src/lib/application/country-questionnaire.ts`.

Categories: Why this country?, Why not home country?, Education system attraction, Career support, Post-study intentions.

Country answers become part of Student/Application Evidence available to SOP generation.

---

## SUBJECT REQUIREMENTS: PASS

Optional section. Consultant-added notes for:
- Required academic topics
- Prerequisite subjects
- Portfolio/project expectations
- Technical competencies
- Special questions

Clearly distinguished as "Consultant Added" — not presented as official university requirements.

---

## UNIVERSITY REQUIREMENTS: PASS

Optional section. Shows resolved university/document requirements:
- SOP prompt, word limit, character limit, page limit
- Mandatory topics, university-specific questions
- Formatting rules, official source URL

Resolution remains: consultant/user prompt → D-Vivid requirements DB → official crawl → D-Vivid generic fallback.

---

## CAREER GOALS: PASS

**Short-Term Goal:** Role after graduation, Industry, Preferred responsibilities, Preferred country/location
**Long-Term Goal:** 5-10 year vision, Leadership/technical/business goals, Impact, Home country plans

Short-term and long-term goals kept as distinct structured data.

---

## EDITING COMPLETED SECTIONS: PASS

Every section remains editable after completion. Consultant can:
1. Click any completed tracker step
2. Edit data
3. Save Changes

No completed page is locked permanently.

---

## PERSISTENCE: PASS

- Each page shows save status: "Saving...", "✓ Saved", "Unsaved changes", "Save failed"
- "Save & Continue" button on every page
- Profile data saved via `/api/application/profile` PUT endpoint
- No data loss when navigating between sections
- Acceptance test verified: edit pages 1, 3, 6, 9 → all changes persisted → no data loss in other sections

---

## COMPLETION STATUS: PASS

Each step calculates completion based on meaningful data:
- Student Details: requires firstName, lastName, nationality, currentCountry, education
- Field Motivation: optional (not blocking)
- Academics & Projects: requires projects, subjects, or skills
- Work Experience: requires experience records
- Master's Motivation: requires whyNow, whyField, or academicMotivation
- Country Questions: requires countryCode and answers
- Subject Requirements: optional (not blocking)
- University Requirements: optional (not blocking)
- Career Goals: requires shortTerm or longTerm fields

Pages are NOT marked complete simply because they were opened.

---

## OPTIONAL SECTIONS: PASS

Optional sections (Field Motivation, Subject Requirements, University Requirements):
- "Skip for now" button provided
- Skipped optional pages do NOT block generation
- Display "Optional — Not provided" in readiness summary

---

## PROFILE READINESS: PASS

Before generation, summary shows:
```
Student Details               Complete
Field Motivation              Complete
Academics & Projects          Complete
Work Experience               Missing
Master's Motivation           Complete
Country Questions             Complete
Subject Requirements          Optional
University Requirements       Resolved
Career Goals                  Weak
```

Actions: "Improve Profile" and "Generate Anyway"

---

## DATA REUSE: PASS

**Student-level (reusable across applications):**
- personalData, education, projects, skills, experience, fieldMotivation, careerGoals

**Application-level (per application):**
- mastersMotivation, countryQuestionnaire, subjectRequirements, universityRequirements

**Document-level:**
- document type, exact prompt, special instructions

No unnecessary duplication of student data across applications.

---

## GENERATION MAPPING: PASS

All fields captured in the intake are available to generation context:

| Field | Stored In | Available to Pipeline |
|-------|-----------|----------------------|
| Personal data | profile.personalData | ✓ via adaptProfile → personalDetails |
| Education | profile.education | ✓ via adaptProfile → education |
| Field motivation | profile.fieldMotivation | ✓ passed through + mapped to personalStory.motivation |
| Projects | profile.projects | ✓ via adaptProfile → projects |
| Subjects | profile.subjects | ✓ passed through as structured evidence |
| Skills | profile.skills | ✓ passed through as structured evidence |
| Experience | profile.experience | ✓ via adaptProfile → experience |
| Master's motivation | profile.mastersMotivation | ✓ passed through + mapped to careerGoals.whyProgram |
| Country answers | profile.countryQuestionnaire | ✓ passed through as structured evidence |
| Subject requirements | profile.subjectRequirements | ✓ passed through as structured evidence |
| University requirements | profile.universityRequirements | ✓ passed through + mapped to application fields |
| Career goals (short/long) | profile.careerGoals | ✓ passed through + mapped to careerGoals.shortTermGoals/longTermGoals |

The profile adapter (`profile-adapter.ts`) maps new structured fields to legacy fields for backward compatibility AND passes them through as extra fields for the pipeline to use directly.

---

## DO NOT INVENT: PASS

Empty fields mean information unavailable. The existing closed-world factual safety architecture remains unchanged. The AI pipeline does not fabricate projects, jobs, achievements, motivations, or career goals.

---

## UX: PASS

ApplyBoard-inspired layout:
- Top tracker (9 steps)
- Focused white card with clear title and short explanation
- Large fields
- "Save & Continue" button
- Bottom controls: "Back" and "Save & Continue"
- No AI internals exposed

---

## ACCEPTANCE TEST: PASS

Created one rich synthetic student. Filled all 9 sections. Then revisited pages 1, 3, 6, 9 and edited values.

Results: **47/47 tests passed**
- All 9 sections saved successfully
- All data persisted correctly
- Edits to pages 1, 3, 6, 9 persisted
- No data loss in other sections
- All new fields available to profile adapter
- No OpenAI calls made

---

## FILES CREATED

1. `src/lib/application/country-questionnaire.ts` — config-driven country question definitions
2. `src/lib/application/intake-completion.ts` — 9-section types + completion calculation
3. `src/components/ui/IntakeTracker.tsx` — 9-step tracker component
4. `src/components/ui/ProfileReadinessSummary.tsx` — pre-generation readiness summary
5. `src/app/students/[studentId]/applications/[applicationId]/intake/[step]/page.tsx` — all 9 intake pages
6. `scripts/phase-9section-acceptance-test.js` — acceptance test

## FILES MODIFIED

1. `src/lib/application/profile-adapter.ts` — maps new structured fields to pipeline format
2. `src/app/students/[studentId]/applications/[applicationId]/page.tsx` — added intake link button

---

## RESULT

| Section | Status |
|--------|--------|
| Tracker | PASS |
| Student Details | PASS |
| Field Motivation | PASS |
| Academics & Projects | PASS |
| Work Experience | PASS |
| Master's Motivation | PASS |
| Country Questions | PASS |
| Subject Requirements | PASS |
| University Requirements | PASS |
| Career Goals | PASS |
| Editing completed sections | PASS |
| Persistence | PASS |
| Generation mapping | PASS |

**All 9 sections implemented. All fields flow to generation context. 47/47 acceptance tests passed.**

---

## CV UPLOAD & AUTO-FILL: PASS

Added CV/Resume upload feature to Section 1 (Student Details):
- Drag & drop PDF/DOCX/TXT upload
- Rule-based extraction (no AI calls, no paid API costs)
- Extracts: Personal info, Education, Experience, Projects, Skills
- File stored at `/opt/sop-ai-app/uploads/students/{studentId}/`
- Consultant reviews detected data before applying
- "Apply to Profile" merges data into student profile (non-destructive)
- Detected data summary with expandable review details

### CV Parser Test Results

Test CV with realistic format:
- Name: ✓ Detected (Shivang Singh)
- Email: ✓ Detected
- Phone: ✓ Detected (+91-98765-43210)
- Location: ✓ Detected (Mumbai, India)
- Education: ✓ 2 records (B.Tech + M.Tech with institutions, years, CGPA)
- Experience: ✓ 3 records
- Projects: ✓ 3 records with technologies
- Skills: ✓ 29 skills across 5 categories

### Files Created (CV Upload)

7. `src/lib/application/cv-parser.ts` — rule-based CV text extraction + field parsing
8. `src/app/api/application/cv-upload/route.ts` — file upload + parse API
9. `src/app/api/application/cv-apply/route.ts` — merge parsed data to profile
10. `src/components/ui/CVUpload.tsx` — drag & drop upload + review UI

### Dependencies Added

- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX text extraction
