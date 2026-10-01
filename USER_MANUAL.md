# D-Vivid Application Writer — User Manual

**A consultant's guide to the application writing portal**

> This manual uses text-based UI layouts that match the real interface.
> Each diagram shows what you'll see on screen and where to click.

---

## Table of Contents

1. [Quick Start (5-minute guide)](#1-quick-start-5-minute-guide)
2. [The 4-Step Workflow](#2-the-4-step-workflow)
3. [Step 1: Create an Applicant](#step-1-create-an-applicant)
4. [Step 2: Complete the Application Intake](#step-2-complete-the-application-intake)
5. [Upload a CV (Optional Shortcut)](#upload-a-cv-optional-shortcut)
6. [Step 3: Create Documents](#step-3-create-documents)
7. [Step 3a: Generate a Document with AI](#step-3a-generate-a-document-with-ai)
8. [Step 3b: Edit, Save Versions, and Approve](#step-3b-edit-save-versions-and-approve)
9. [Step 4: Export the Final Document](#step-4-export-the-final-document)
10. [Managing Multiple Documents](#managing-multiple-documents)
11. [Deleting Documents and Applications](#deleting-documents-and-applications)
12. [Document Types Reference](#document-types-reference)
13. [The 9 Intake Sections Reference](#the-9-intake-sections-reference)
14. [The 6 AI Generation Stages](#the-6-ai-generation-stages)
15. [Troubleshooting](#troubleshooting)

---

## 1. Quick Start (5-minute guide)

```
  ┌─────────────────────────────────────────────────────────┐
  │  D-Vivid                              [Students]  [👤]  │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │   Students                          [+ New Applicant]   │
  │   3 students total                                      │
  │                                                         │
  │   ┌───────────────────────────────────────────────┐   │
  │   │  🔍 Search by name or email...                  │   │
  │   └───────────────────────────────────────────────┘   │
  │                                                         │
  │   ┌───────────────────────────────────────────────┐   │
  │   │  [KM]  Kunj Modh                    2 Apps    │   │
  │   │        kunj@example.com  India       Delete   │   │
  │   └───────────────────────────────────────────────┘   │
  │   ┌───────────────────────────────────────────────┐   │
  │   │  [SS]  Shivang Singh                 1 App    │   │
  │   │        shivang@example.com           Delete   │   │
  │   └───────────────────────────────────────────────┘   │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

**To get started:**
1. Open the portal — you'll land on the **Students** page
2. Click **+ New Applicant** (top right)
3. Fill in the student's name, email, and their first university/program
4. Click **Create Applicant & Application →**
5. You'll be taken to the application workspace where you complete the intake, create documents, and generate

---

## 2. The 4-Step Workflow

The top of every page shows a progress tracker:

```
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │    ① Applicant  ─── ② Application  ─── ③ Document  ─── ④ Review  │
  │    [completed]      [active]          [upcoming]   [upcoming]   │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

| Step | What you do | Where |
|------|-------------|-------|
| **1. Applicant** | Create the student profile | `/students/new` |
| **2. Application** | Complete intake info (education, motivation, career goals) | Application workspace → Intake |
| **3. Document** | Create a document (SOP, Essay, Visa SOP, etc.) and generate | Application workspace → Add Document |
| **4. Review** | Edit, approve, and export the final document | Document workspace |

---

## Step 1: Create an Applicant

```
  ┌─────────────────────────────────────────────────────────┐
  │  ① Applicant  ─── ② Application  ─── ③ Document  ─── ④ Review │
  │  Students > New Applicant                                │
  │                                                         │
  │  New Applicant                                          │
  │  Create a student and their first university application.│
  │                                                         │
  │  ┌─── 1. Student Details ───────────────────────────┐  │
  │  │                                                   │  │
  │  │  First Name *          Last Name *                 │  │
  │  │  [Kunj          ]      [Modh            ]         │  │
  │  │                                                   │  │
  │  │  Email *               Phone                      │  │
  │  │  [kunj@example.com]     [+91 98765 43210]         │  │
  │  │                                                   │  │
  │  │  Country                                         │  │
  │  │  [India         ]                                 │  │
  └──┤                                                   │  │
  │  ┌─── 2. First Application ──────────────────────────┐  │
  │  │                                                   │  │
  │  │  University *          Program *                  │  │
  │  │  [Search university..] [MS Machine Learning]      │  │
  │  │                                                   │  │
  │  │  Degree *              Department                 │  │
  │  │  [Master of Science ▾]  [Computer Science]        │  │
  │  │                                                   │  │
  │  │  Country               Intake         Intake Year│  │
  │  │  [Germany      ]        [Fall ▾]       [2027   ]  │  │
  └──┤                                                   │  │
  │                                                         │
  │                    [Cancel]  [Create Applicant & Application →] │
  └─────────────────────────────────────────────────────────┘
```

**What to do:**
1. Fill in the student's **First Name**, **Last Name**, and **Email** (required)
2. Add phone and country (optional but recommended)
3. Fill in the **University** (type to search), **Program**, and **Degree** (required)
4. Add intake season and year
5. Click **Create Applicant & Application →**

You'll be automatically redirected to the **Application Workspace**.

> **Tip:** You can add more applications for the same student later from their student page.

---

## Step 2: Complete the Application Intake

After creating an applicant, you land on the **Application Workspace**:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ① Applicant  ─── ② Application  ─── ③ Document  ─── ④ Review │
  │  Students > Kunj Modh > Technical University of Munich   │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐ │
  │  │  Kunj Modh                    [Delete application] │ │
  │  │  Technical University of Munich · MS ML · Fall 2027│ │
  │  │                                                   │ │
  │  │  APPLICATION STATUS                               │ │
  │  │  ────────────────────                             │ │
  │  │  5 required answers still needed                   │ │
  │  │                                                   │ │
  │  │  · Student Details — nationality, education history│ │
  │  │  · Master's Motivation — whyField                  │ │
  │  │  · Country Questions                              │ │
  │  │  · Career Goals — shortTerm.role, longTerm.vision  │ │
  │  │                                                   │ │
  │  │  [Complete 5 Missing Answers →]                   │ │
  │  │                                                   │ │
  │  │  Upload CV to pre-fill instead                    │ │
  └──┤                                                   │ │
  │                                                         │
  │  ┌─── Documents ──────────────────────────────────────┐ │
  │  │  No documents yet.                    [+ Add Document] │ │
  │  └───────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

**What to do:**
1. The **Application Status** box shows what information is missing
2. Click **Complete N Missing Answers →** to start the intake wizard
3. The wizard shows you one section at a time, only the required ones:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ① Applicant  ─── ② Application  ─── ③ Document  ─── ④ Review │
  │  Students > Kunj Modh > TUM > Intake                     │
  │                                                         │
  │  ┌─── Intake Progress ──────────────────────────────┐  │
  │  │  ✓ Student Details    → Academics & Projects     │  │
  │  │    Work Experience      Master's Motivation       │  │
  │  │    Country Questions    Career Goals              │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌─── Student Details ─────────────────────────────┐   │
  │  │                                                  │   │
  │  │  First Name *          Last Name *               │   │
  │  │  [Kunj          ]      [Modh            ]        │   │
  │  │                                                  │   │
  │  │  Nationality *         Current Country *        │   │
  │  │  [India         ▾]     [India          ▾]        │   │
  │  │                                                  │   │
  │  │  ┌── Education ──────────────────────────────┐   │   │
  │  │  │  [+ Add Education]                        │   │   │
  │  │  │                                            │   │   │
  │  │  │  Institution: [IIT Bombay]                 │   │   │
  │  │  │  Degree:      [B.Tech]   Major: [CS]       │   │   │
  │  │  │  CGPA: [8.5]  Scale: [10]                  │   │   │
  │  │  │  Start Year: [2019]  Grad Year: [2023]     │   │   │
  │  │  └────────────────────────────────────────────┘   │   │
  │  │                                                  │   │
  │  │  ┌── Upload CV (optional) ───────────────────┐   │   │
  │  │  │  [Choose File] or drag a PDF/DOCX here     │   │   │
  │  │  │  Upload a CV to auto-fill education,       │   │   │
  │  │  │  experience, projects, and skills.         │   │   │
  │  │  └────────────────────────────────────────────┘   │   │
  │  │                                                  │   │
  │  │  [← Back]              [Save & Next Missing Answer →] │   │
  └──┤                                                  │   │
  └─────────────────────────────────────────────────────────┘
```

4. Fill in each section and click **Save & Next Missing Answer →**
5. The wizard automatically takes you to the next missing section
6. When all required sections are done, you'll see:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ✓ All required information complete                    │
  │                                                         │
  │  [Review all information →]                             │
  │  [Back to application →]                               │
  └─────────────────────────────────────────────────────────┘
```

> **Important:** You only need to complete the **required** sections to unlock document generation. Optional sections (Field Motivation, Subject Requirements, Program/University Info) can be skipped.

---

## Upload a CV (Optional Shortcut)

Instead of filling in each section manually, you can upload the student's CV to auto-fill education, experience, projects, and skills:

```
  ┌─────────────────────────────────────────────────────────┐
  │  Application Status                                      │
  │  5 required answers still needed                        │
  │                                                         │
  │  [Complete 5 Missing Answers →]                         │
  │                                                         │
  │  Upload CV to pre-fill instead  ← click this link       │
  │                                                         │
  │  ┌── CV Upload ──────────────────────────────────────┐ │
  │  │                                                    │ │
  │  │  [Choose File] or drag a PDF/DOCX here             │ │
  │  │                                                    │ │
  │  │  Upload a CV to auto-fill education, experience,   │ │
  │  │  projects, and skills.                              │ │
  │  │                                                    │ │
  │  └────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

After uploading, you'll see the extracted data and can review it before applying.

---

## Step 3: Create Documents

Once the intake is complete, the **+ Add Document** button appears:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ✓ Applicant information ready                          │
  │                                                         │
  │  ┌─── Documents ──────────────────────────────────────┐ │
  │  │  No documents yet.                    [+ Add Document] │ │
  │  └─────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

Click **+ Add Document** to open the creation form:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ┌─── Add Document ─────────────────────────────────────┐ │
  │  │  Create a new writing task for this application.     │ │
  │  │                                                      │ │
  │  │  Document Type                                       │ │
  │  │  [Statement of Purpose ▾]                             │ │
  │  │                                                      │ │
  │  │  ┌── University / Application Prompt ────────────┐  │ │
  │  │  │  Describe your academic and professional        │  │ │
  │  │  │  background and why you want to pursue this      │  │ │
  │  │  │  program...                                     │  │ │
  │  │  │                                                 │  │ │
  │  │  │  [Find university prompt] [Search official pages]│  │ │
  │  │  └─────────────────────────────────────────────────┘  │ │
  │  │                                                      │ │
  │  │  Consultant Instruction (optional)                   │ │
  │  │  [Keep it concise. Focus on ML experience...]        │ │
  │  │                                                      │ │
  │  │  ▸ Advanced options (title, prompt source, length    │ │
  │  │    limits, topics, questions, formatting)             │ │
  │  │                                                      │ │
  │  │              [Cancel]  [Create Document]              │ │
  │  └──────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

**What to do:**
1. Select the **Document Type** (SOP, Essay, Visa SOP, LOR, etc.)
2. Enter the **prompt** — paste the university's question or writing requirement
   - For **Visa SOP**: the prompt is optional — leave it blank to use the D-Vivid default template
   - For **SOP/Essay/Custom**: the prompt is required
3. (Optional) Click **Find university prompt** to search the requirements database
4. (Optional) Click **Search official pages** to discover the prompt from the university website
5. (Optional) Add **Consultant Instructions** — guidance for the AI writer
6. (Optional) Expand **Advanced options** to set word limits, topics, questions, and formatting:

```
  ┌── Advanced options ────────────────────────────────────┐
  │                                                          │
  │  Document Title          Prompt Source                   │
  │  [Statement of Objectiv] [Consultant Provided ▾]        │
  │                                                          │
  │  Word Min    Word Max    Character Limit   Page Limit    │
  │  [800    ]   [1000   ]   [            ]    [     ]      │
  │                                                          │
  │  Mandatory Topics (one per line)                         │
  │  [Research methodology                              ]    │
  │  [Data ethics                                       ]    │
  │  [Leadership experience                             ]    │
  │                                                          │
  │  Additional / Specific Questions (one per line)          │
  │  [Describe a challenge you overcame.                ]    │
  │  [Why this specific program?                        ]    │
  │                                                          │
  │  Formatting Rules                                         │
  │  [12pt font, 1.5 line spacing, margins 1 inch       ]    │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

7. Click **Create Document**

You'll be taken to the **Document Workspace**.

> **Key point:** Each document owns its own requirements. A Visa SOP will NOT inherit the SOP's prompt or word limits. Each document is independent.

---

## Step 3a: Generate a Document with AI

After creating a document, you'll see the Document Workspace:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ① Applicant  ─── ② Application  ─── ③ Document  ─── ④ Review │
  │  Students > Kunj Modh > TUM > Statement of Purpose      │
  │                                                         │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │  Statement of Purpose                             │  │
  │  │  Technical University of Munich · MS ML · Fall 2027│  │
  │  │                                                   │  │
  │  │  [NOT_STARTED]  [Delete document]                │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌─── Generate Document ────────────────────────────┐  │
  │  │  Generate a first draft using the AI pipeline.   │  │
  │  │                                                   │  │
  │  │  The AI will use the student's approved facts     │  │
  │  │  and the document prompt to write a draft.        │  │
  │  │                                                   │  │
  │  │  [Generate Document]                              │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌─── Prompt & Instructions ───────────────────────┐  │
  │  │  ▶ Source: Consultant Provided                   │  │
  │  │                                                   │  │
  │  │  Describe your academic and professional          │  │
  │  │  background and why you want to pursue...         │  │
  │  │                                                   │  │
  │  │  Word Min: 800  (Document override)              │  │
  │  │  Word Max: 1000 (Document override)              │  │
  │  └──────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────┘
```

Click **Generate Document** to start the AI pipeline. You'll see live progress:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ┌─── Generation in Progress ──────────────────────────┐ │
  │  │                                                      │ │
  │  │  Statement of Purpose — generating...               │ │
  │  │                                                      │ │
  │  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┐  │ │
  │  │  │  ✓      │  ✓      │  ●      │  ○      │  ○      │  │ │
  │  │  │ Prepare  │  Write  │ Review  │ Polish  │ Finalize│  │ │
  │  │  │ done     │ done    │ active  │ waiting │ waiting │  │ │
  │  │  └─────────┴─────────┴─────────┴─────────┴─────────┘  │ │
  │  │                                                      │ │
  │  │  Stage 3 of 6: Quality Reviewer                      │ │
  │  │  Elapsed: 45 seconds                                 │ │
  │  │                                                      │ │
  │  │  [Cancel Generation]                                 │ │
  │  └──────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

The 6 stages run automatically:
1. **Prepare** — Plans the document structure
2. **Write** — Writes the first draft using approved student facts
3. **Review** — Quality checks the draft
4. **Polish** — Calibrates language and tone
5. **Finalize** — Combines and finalizes the content
6. **Verify** — Fact-checks against the student's approved evidence

When generation completes, you'll see the result:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ┌─── Generation Complete ────────────────────────────┐ │
  │  │  ✓ Generation complete                              │ │
  │  │                                                      │ │
  │  │  Word count: 942 / 1000 target                       │ │
  │  │  Fact check: ✓ 12 verified · 0 invented · 0 altered  │ │
  │  │  Model: gpt-4o · Cost: $0.084 (₹7.06)               │ │
  │  │                                                      │ │
  │  │  [View Document →]                                  │ │
  │  └──────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

> **Important:** The AI only uses approved student facts from the intake. It will NOT invent information. If facts are missing, it will leave gaps or use safe fallbacks — never fabricate.

---

## Step 3b: Edit, Save Versions, and Approve

After generation, the document opens in the editor:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ① Applicant  ─── ② Application  ─── ③ Document  ─── ④ Review │
  │  Students > Kunj Modh > TUM > Statement of Purpose      │
  │                                                         │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │  Statement of Purpose                             │  │
  │  │  [GENERATED]  [DRAFT]                             │  │
  │  │                                                   │  │
  │  │  [Delete document]                                │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌─── Editor ────────────────────┬─── Prompt & Info ──┐  │
  │  │                                │                     │  │
  │  │  My academic journey began at  │  ▶ Source:          │  │
  │  │  IIT Bombay where I pursued    │    Consultant       │  │
  │  │  a Bachelor's in Computer      │    Provided         │  │
  │  │  Science...                    │                     │  │
  │  │                                │  Word Min: 800      │  │
  │  │  [rich text editing area]      │  Word Max: 1000     │  │
  │  │                                │                     │  │
  │  │                                │  ┌── Export ────┐  │  │
  │  │  Words: 942  Chars: 5630       │  │ Draft PDF     │  │  │
  │  │  ⚠ 942/1000 words (within range)│  │ Draft DOCX   │  │  │
  │  │                                │  └──────────────┘  │  │
  │  │  [Save Changes] [Save as New   │                     │  │
  │  │   Version]    [Regenerate]     │                     │  │
  │  └────────────────────────────────┴─────────────────────┘  │
  │                                                         │
  │  ┌─── Version History ───────────────────────────────┐  │
  │  │  v2  [CONSULTANT_EDITED]  942 words  [Current]     │  │
  │  │      [View] [Edit from here] [Approve]              │  │
  │  │                                                      │  │
  │  │  v1  [AI_GENERATED]  gpt-4o  $0.084  920 words      │  │
  │  │      [View] [Edit from here] [Approve]              │  │
  │  └──────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────┘
```

**To edit:**
1. Click in the editor and make changes — it's a full rich text editor
2. The word count updates live at the bottom
3. Click **Save Changes** to update the current version, or **Save as New Version** to create a new one

**To approve:**
1. Select the version you want to approve in Version History
2. Click **Approve**
3. A confirmation dialog appears:

```
  ┌─────────────────────────────────────────────────────────┐
  │  ┌─── Approve Document ────────────────────────────────┐ │
  │  │                                                      │ │
  │  │  Approve Version 2?                                  │ │
  │  │                                                      │ │
  │  │  This will mark this version as the approved         │ │
  │  │  final document. You can still edit and create       │ │
  │  │  new versions, but exports will use this version.    │ │
  │  │                                                      │ │
  │  │  ⚠ 942/1000 words — within range                    │ │
  │  │                                                      │ │
  │  │              [Cancel]  [Approve Document]             │ │
  │  └──────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

4. Click **Approve Document**

> **Note:** You can approve even if word count warnings appear. The consultant is the final authority. You can also approve a different version later.

---

## Step 4: Export the Final Document

Once a version is approved, the Export panel changes:

```
  ┌─── Export (v2 — Approved) ──────────────────────────────┐
  │                                                          │
  │  ✓ Approved Version 2                                    │
  │                                                          │
  │  ┌── Download Approved Document ──────────────────────┐  │
  │  │                                                    │  │
  │  │  [Download PDF]    [Download DOCX]                  │  │
  │  │                                                    │  │
  │  └────────────────────────────────────────────────────┘  │
  │                                                          │
  │  ── or export a draft ──                                 │
  │                                                          │
  │  [Draft PDF]    [Draft DOCX]                              │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

- **Download PDF / DOCX** (green buttons) — exports the approved version
- **Draft PDF / DOCX** — exports the currently selected version (even if not approved)

The file downloads to your computer automatically.

---

## Managing Multiple Documents

One application can have many documents. Each is independent:

```
  ┌─── Documents ───────────────────────────────────────────┐
  │                                            [+ Add Document] │
  │                                                          │
  │  ┌────────────────────────────────────────────────────┐ │
  │  │  Statement of Purpose          [GENERATED] [DRAFT] │ │
  │  │  Consultant Provided · SOP · 800-1000 words        │ │
  │  │                                        Review →    │ │
  │  │                                            Delete  │ │
  │  └────────────────────────────────────────────────────┘ │
  │  ┌────────────────────────────────────────────────────┐ │
  │  │  Visa SOP                      [NOT_STARTED]       │ │
  │  │  D-Vivid Default Template · Visa SOP · 800-1200    │ │
  │  │                                       Generate →   │ │
  │  │                                            Delete  │ │
  │  └────────────────────────────────────────────────────┘ │
  │  ┌────────────────────────────────────────────────────┐ │
  │  │  Essay — Question 1             [APPROVED]         │ │
  │  │  Consultant Provided · Essay · 500 words           │ │
  │  │                                     Export / Open → │ │
  │  │                                            Delete  │ │
  │  └────────────────────────────────────────────────────┘ │
  │  ┌────────────────────────────────────────────────────┐ │
  │  │  Essay — Question 2             [NOT_STARTED]       │ │
  │  │  Consultant Provided · Essay · 300 words           │ │
  │  │                                       Generate →   │ │
  │  │                                            Delete  │ │
  │  └────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────┘
```

**Key points:**
- You can have **multiple documents of the same type** (e.g., two Essays, two LORs)
- Each document has its **own prompt, word limits, topics, and formatting**
- A Visa SOP will NOT inherit the SOP's prompt — each document is isolated
- The **+ Add Document** button is always visible at the top of the Documents section

---

## Deleting Documents and Applications

### Delete a single document

On each document card, click **Delete** (small red text, bottom right):

```
  ┌────────────────────────────────────────────────────┐
  │  Visa SOP              [NOT_STARTED]               │
  │  D-Vivid Default · 800-1200 words                 │
  │                                       Generate →  │
  │                                          Delete   │
  └────────────────────────────────────────────────────┘
```

A confirmation panel appears:

```
  ┌────────────────────────────────────────────────────┐
  │  Delete "Visa SOP"?                                │
  │                                                    │
  │  This will permanently delete this document, its   │
  │  generated versions, and its generation history.  │
  │  Other documents and the application will not be  │
  │  affected.                                         │
  │                                                    │
  │  [Delete Document]  [Cancel]                       │
  └────────────────────────────────────────────────────┘
```

- Only the selected document is deleted
- Other documents are untouched
- The application and student remain
- You cannot delete a document while generation is in progress

### Delete an application

On the application workspace, click **Delete application**:

```
  ┌────────────────────────────────────────────────────┐
  │  Delete application?                               │
  │                                                    │
  │  This will permanently delete this application,   │
  │  ALL its documents, versions, and generation      │
  │  history. The student profile will remain.        │
  │                                                    │
  │  [Delete Application]  [Cancel]                    │
  └────────────────────────────────────────────────────┘
```

### Delete a student

On the Students list, click **Delete** on a student row:

```
  ┌────────────────────────────────────────────────────┐
  │  Delete Kunj Modh?                                │
  │                                                    │
  │  This will permanently delete this student, their │
  │  reusable profile, and ALL 2 applications with     │
  │  their documents and generation history.          │
  │                                                    │
  │  This cannot be undone.                           │
  │                                                    │
  │  [Yes, delete this student]  [Cancel]             │
  └────────────────────────────────────────────────────┘
```

---

## Document Types Reference

| Type | Prompt Required? | Use Case |
|------|:-:|---|
| **Statement of Purpose** | Yes | Standard SOP for university applications |
| **Essay** | Yes | Application essays with specific questions |
| **Supplemental Question** | Yes | Short supplemental essay responses |
| **MOA** | Yes | Memorandum of Agreement |
| **Personal Statement** | Yes | Personal narrative statement |
| **Statement of Academic Purpose** | Yes | Academic-focused purpose statement |
| **Letter of Motivation** | Yes | Motivation letter for European universities |
| **Visa SOP** | No (uses D-Vivid default) | Student visa statement of purpose |
| **Cover Letter** | No (uses D-Vivid default) | Job/program cover letter |
| **Letter of Recommendation** | No (uses D-Vivid default) | LOR from faculty/recommender |
| **Custom Document** | Yes | Any other document type |

---

## The 9 Intake Sections Reference

| # | Section | Required? | What it collects |
|---|---------|:-:|---|
| 1 | **Student Details** | Yes | Name, email, phone, nationality, country, education history |
| 2 | **Field Motivation** | No | Why the student chose this field |
| 3 | **Academics & Projects** | Yes | Projects, subjects, skills (technical, tools, programming, domain, soft) |
| 4 | **Work Experience** | Yes | Jobs, internships, research roles (or "no work experience" checkbox) |
| 5 | **Master's Motivation** | Yes | Why pursue a master's now, skill gaps, academic/professional motivation |
| 6 | **Country Questions** | Yes | Why this country, post-study plans (country-specific questionnaire) |
| 7 | **Subject Requirements** | No | Consultant-added notes about program prerequisites |
| 8 | **Program / University Info** | No | Official source URL for program context |
| 9 | **Career Goals** | Yes | Short-term role/industry + long-term vision/goals |

> **Tip:** Sections 1, 3, 4, 5, 6, and 9 must be complete to unlock document generation. Sections 2, 7, and 8 are optional.

---

## The 6 AI Generation Stages

```
  Stage 1        Stage 2        Stage 3        Stage 4        Stage 5        Stage 6
  ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
  │Prepare│ ──→ │ Write│ ──→ │Review│ ──→ │Polish│ ──→ │Final-│ ──→ │Verify│
  │      │      │      │      │      │      │      │      │ ize  │      │      │
  └──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
  Plans the     Writes the     Quality-      Language      Combines      Fact-
  document      first draft    checks the    calibrates    and           checks
  structure     using          draft for     tone and      finalizes    against
  and selects   approved        coverage     style         the content  approved
  evidence      student facts   and accuracy                evidence
```

| Stage | Name | What it does |
|-------|------|---|
| 1 | **Prepare** (Planner) | Plans the document structure and selects relevant evidence from the student's approved facts |
| 2 | **Write** (Writer) | Writes the first draft using only approved student evidence — never invents facts |
| 3 | **Review** (Quality Reviewer) | Checks the draft for coverage, accuracy, and requirement compliance |
| 4 | **Polish** (Language Calibrator) | Refines language, tone, and readability |
| 5 | **Finalize** (Bounded Finalizer) | Combines all stages into the final document, filtering to only relevant evidence |
| 6 | **Verify** (Fact Reviewer) | Fact-checks every claim against the student's approved evidence ledger |

> The entire pipeline typically takes 1-3 minutes. You can cancel at any time. If a stage fails, you'll see a human-readable error and can retry.

---

## Troubleshooting

### "I can't generate a document"

**Cause:** The intake is not complete.

**Fix:** Go back to the application workspace and click **Complete N Missing Answers →**. Fill in all required sections (Student Details, Academics & Projects, Work Experience, Master's Motivation, Country Questions, Career Goals).

### "The generation is stuck"

**Cause:** The AI pipeline may have timed out or the server is processing.

**Fix:** Wait 2-3 minutes. If the progress card shows "Generation appears interrupted", click **Check Again**. If it's still stuck, click **Cancel Generation** and try again.

### "The generated document has gaps or says information is missing"

**Cause:** The AI only uses approved student facts. If the intake is incomplete, it won't invent information.

**Fix:** Go back to the intake and complete the missing sections. Then regenerate.

### "I see 'DOCUMENT_GENERATION_IN_PROGRESS' when trying to delete"

**Cause:** You can't delete a document while the AI is generating it.

**Fix:** Wait for generation to complete or cancel it first, then delete.

### "The word count warning appears"

**Cause:** The document is outside the word limit range.

**Fix:** This is an advisory warning only. You can still approve and export. Edit the document to adjust the word count if needed.

### "I want to create another document of the same type (e.g., a second Essay)"

**Yes, this is supported.** Click **+ Add Document**, select the same type, and give it a different title. Each document is independent with its own prompt and requirements.

---

## Quick Reference Card

```
  ┌─────────────────────────────────────────────────────────────┐
  │  D-VIDDID APPLICATION WRITER — QUICK REFERENCE              │
  │                                                             │
  │  1. Students → + New Applicant                              │
  │  2. Complete intake (required sections only)                │
  │  3. + Add Document → choose type → enter prompt             │
  │  4. Generate Document → wait for 6 stages                   │
  │  5. Edit in the rich text editor → Save as New Version      │
  │  6. Approve the final version                               │
  │  7. Download PDF or DOCX                                    │
  │                                                             │
  │  TIPS:                                                      │
  │  · Upload a CV to auto-fill the intake                      │
  │  · Each document owns its own requirements (no bleed)       │
  │  · Multiple documents of the same type are allowed          │
  │  · Visa SOP uses D-Vivid default if no prompt is given      │
  │  · The AI never invents facts — it only uses approved data   │
  │  · You can approve despite word count warnings              │
  │  · You can delete any document independently                │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
```

---

*This manual reflects the portal as of September 2026. For technical documentation, see the `.md` files in the repository root.*
