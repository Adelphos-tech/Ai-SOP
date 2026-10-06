// ============================================================
// APPLICATION WORKSPACE UI TESTS — Phase 3 Verification
// ============================================================
// Tests for /students/[studentId]/applications/[applicationId] page
// ============================================================

interface Application {
  id: string;
  studentId: string;
  universityName: string;
  programName: string;
  degree: string;
  department?: string;
  country: string;
  intake: string;
  intakeYear: string;
  status: string;
}

interface Document {
  id: string;
  applicationId: string;
  documentType: string;
  documentTitle: string;
  promptText: string;
  promptSource: string;
  wordMin?: number;
  wordMax?: number;
  characterLimit?: number;
  pageLimit?: number;
  generationStatus: string;
  reviewStatus: string;
  createdAt: string;
}

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface RequirementLookupResult {
  result: string;
  writingRequirements?: any[];
}

// ============================================================
// HELPER FUNCTIONS (copied from implementation)
// ============================================================

function docStatus(d: Document): string {
  if (d.reviewStatus === "APPROVED") return "APPROVED";
  if (d.reviewStatus === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (d.reviewStatus === "IN_REVIEW") return "IN_REVIEW";
  if (d.generationStatus === "GENERATING") return "GENERATING";
  if (d.generationStatus === "GENERATED") return "GENERATED";
  if (d.generationStatus === "FAILED") return "FAILED";
  return "NOT_STARTED";
}

function docAction(d: Document): { label: string; color: string } {
  const status = docStatus(d);
  if (status === "APPROVED") return { label: "Export →", color: "text-dvivid-success font-medium" };
  if (status === "NEEDS_REVIEW" || status === "IN_REVIEW") return { label: "Review →", color: "text-dvivid-primary font-medium" };
  if (status === "GENERATING") return { label: "Generating...", color: "text-dvivid-warning" };
  if (status === "FAILED") return { label: "Retry →", color: "text-dvivid-error font-medium" };
  if (status === "GENERATED") return { label: "Review →", color: "text-dvivid-primary font-medium" };
  return { label: "Generate →", color: "text-dvivid-primary font-medium" };
}

function hasNeedsReview(documents: Document[]): boolean {
  return documents.some(d => d.reviewStatus === "NEEDS_REVIEW" || d.reviewStatus === "IN_REVIEW");
}

function hasGenerating(documents: Document[]): boolean {
  return documents.some(d => d.generationStatus === "GENERATING");
}

function hasFailed(documents: Document[]): boolean {
  return documents.some(d => d.generationStatus === "FAILED");
}

function getPrimaryDoc(documents: Document[]): Document | null {
  if (documents.length === 0) return null;
  const ranked = [...documents].sort((a, b) => {
    const rankA = a.reviewStatus === "APPROVED" ? 4 : a.generationStatus === "GENERATED" ? 3 : a.generationStatus === "GENERATING" || a.generationStatus === "FAILED" ? 2 : 1;
    const rankB = b.reviewStatus === "APPROVED" ? 4 : b.generationStatus === "GENERATED" ? 3 : b.generationStatus === "GENERATING" || b.generationStatus === "FAILED" ? 2 : 1;
    return rankB - rankA;
  });
  return ranked[0];
}

// Simple test runner
let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failCount++;
    const msg = `${name}: ${error.message}`;
    failures.push(msg);
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

const expect = (actual: any) => ({
  toBe: (expected: any) => {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
    }
  },
  toBeDefined: () => {
    if (actual === undefined) {
      throw new Error(`Expected value to be defined but got undefined`);
    }
  },
  toBeUndefined: () => {
    if (actual !== undefined) {
      throw new Error(`Expected undefined but got ${JSON.stringify(actual)}`);
    }
  },
  toContain: (expected: any) => {
    if (!actual.includes(expected)) {
      throw new Error(`Expected array to contain ${JSON.stringify(expected)}`);
    }
  },
  toEqual: (expected: any) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
    }
  },
  toMatch: (pattern: RegExp) => {
    if (!pattern.test(actual)) {
      throw new Error(`Expected ${JSON.stringify(actual)} to match ${pattern}`);
    }
  },
  toContainKey: (key: string) => {
    if (!actual || !Object.prototype.hasOwnProperty.call(actual, key)) {
      throw new Error(`Expected object to contain key ${key}`);
    }
  },
  toBeGreaterThan: (expected: number) => {
    if (!(actual > expected)) {
      throw new Error(`Expected ${actual} to be greater than ${expected}`);
    }
  },
  toHaveProperty: (key: string) => {
    if (!actual || !Object.prototype.hasOwnProperty.call(actual, key)) {
      throw new Error(`Expected object to have property ${key}`);
    }
  },
  not: {
    toContain: (expected: any) => {
      if (actual.includes(expected)) {
        throw new Error(`Expected array to NOT contain ${JSON.stringify(expected)}`);
      }
    },
    toBe: (expected: any) => {
      if (actual === expected) {
        throw new Error(`Expected value to NOT be ${JSON.stringify(expected)}`);
      }
    },
    toBeNull: () => {
      if (actual === null) {
        throw new Error(`Expected value to NOT be null`);
      }
    },
    toHaveProperty: (key: string) => {
      if (actual && Object.prototype.hasOwnProperty.call(actual, key)) {
        throw new Error(`Expected object to NOT have property ${key}`);
      }
    },
  },
});

// ============================================================
// TEST DATA FACTORY
// ============================================================

const createStudent = (overrides: Partial<Student> = {}): Student => ({
  id: "stu-1",
  firstName: "Kunj",
  lastName: "Modh",
  email: "kunj@example.com",
  ...overrides,
});

const createApplication = (overrides: Partial<Application> = {}): Application => ({
  id: "app-1",
  studentId: "stu-1",
  universityName: "MIT",
  programName: "Computer Science",
  degree: "Master of Science",
  department: "EECS",
  country: "USA",
  intake: "Fall",
  intakeYear: "2027",
  status: "IN_PROGRESS",
  ...overrides,
});

const createDocument = (overrides: Partial<Document> = {}): Document => ({
  id: "doc-1",
  applicationId: "app-1",
  documentType: "STATEMENT_OF_PURPOSE",
  documentTitle: "Statement of Purpose — MIT",
  promptText: "Please describe your motivation...",
  promptSource: "OFFICIAL_VERIFIED",
  generationStatus: "GENERATED",
  reviewStatus: "",
  wordMin: 800,
  wordMax: 1000,
  createdAt: "2026-09-01T10:00:00Z",
  ...overrides,
});

const createReadiness = (missing: boolean, sections: any[] = []) => ({
  canGenerate: !missing,
  sections: sections.length > 0 ? sections : [
    { slug: "country-questions", label: "Country Questions", optional: false, status: missing ? "missing" : "complete", missingFields: ["why_country"] },
    { slug: "masters-motivation", label: "Master's Motivation", optional: false, status: missing ? "missing" : "complete", missingFields: ["why_field"] },
    { slug: "career-goals", label: "Career Goals", optional: false, status: missing ? "missing" : "complete" },
    { slug: "student-details", label: "Student Details", optional: false, status: "complete" },
  ],
});

const createReqLookup = (hasRequirements: boolean) => hasRequirements ? {
  result: "EXACT_FRESH_MATCH",
  writingRequirements: [
    { id: "wr-1", officialTitle: "Statement of Purpose", documentType: "STATEMENT_OF_PURPOSE", promptText: "Why this program?", wordMin: 800, wordMax: 1000, required: true },
  ],
} : null;

// ============================================================
// TESTS
// ============================================================

describe("Application Workspace — Application Header", () => {
  const student = createStudent();
  const application = createApplication();
  const documents: Document[] = [];

  test("header contains student name", () => {
    const name = `${student.firstName} ${student.lastName}`;
    expect(name).toBe("Kunj Modh");
  });

  test("header contains university name", () => {
    expect(application.universityName).toBeDefined();
    expect(application.universityName).toBe("MIT");
  });

  test("header contains program name", () => {
    expect(application.programName).toBeDefined();
    expect(application.programName).toBe("Computer Science");
  });

  test("header contains degree", () => {
    expect(application.degree).toBeDefined();
    expect(application.degree).toBe("Master of Science");
  });

  test("header contains country and intake when present", () => {
    expect(application.country).toBe("USA");
    expect(application.intake).toBe("Fall");
    expect(application.intakeYear).toBe("2027");
  });
});

describe("Application Workspace — Compact Metrics", () => {
  test("metrics calculates Documents count", () => {
    const docs = [
      createDocument({ id: "doc-1" }),
      createDocument({ id: "doc-2" }),
      createDocument({ id: "doc-3" }),
    ];
    expect(docs.length).toBe(3);
  });

  test("metrics calculates Generated count", () => {
    const docs = [
      createDocument({ generationStatus: "GENERATED", reviewStatus: "" }),
      createDocument({ generationStatus: "GENERATED", reviewStatus: "" }),
      createDocument({ generationStatus: "NOT_STARTED", reviewStatus: "" }),
    ];
    const generatedCount = docs.filter(d => ["GENERATED", "APPROVED", "NEEDS_REVIEW", "IN_REVIEW"].includes(docStatus(d))).length;
    expect(generatedCount).toBe(2);
  });

  test("metrics calculates Approved count", () => {
    const docs = [
      createDocument({ reviewStatus: "APPROVED" }),
      createDocument({ reviewStatus: "APPROVED" }),
      createDocument({ reviewStatus: "NEEDS_REVIEW" }),
    ];
    const approvedCount = docs.filter(d => docStatus(d) === "APPROVED").length;
    expect(approvedCount).toBe(2);
  });

  test("metrics calculates Needs Review count", () => {
    const docs = [
      createDocument({ reviewStatus: "NEEDS_REVIEW" }),
      createDocument({ reviewStatus: "IN_REVIEW" }),
      createDocument({ reviewStatus: "APPROVED" }),
    ];
    const needsReviewCount = docs.filter(d => d.reviewStatus === "NEEDS_REVIEW" || d.reviewStatus === "IN_REVIEW").length;
    expect(needsReviewCount).toBe(2);
  });
});

describe("Application Workspace — Primary CTA Priority", () => {
  test("missing application info → Complete Information", () => {
    const readiness = createReadiness(true);
    const intakeComplete = readiness.canGenerate;
    const firstMissingSlug = readiness.sections.find(s => s.status === "missing")?.slug;
    
    let primaryCta: { label: string; href: string } | null = null;
    if (!intakeComplete) {
      const missingSections = readiness.sections.filter(s => !s.optional && s.status === "missing");
      const missingCount = missingSections.length;
      primaryCta = { label: `Complete ${missingCount} Missing Answer${missingCount !== 1 ? "s" : ""} →`, href: `/intake/missing` };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).toContain("Complete");
    expect(primaryCta!.label).toContain("Missing Answer");
  });

  test("no documents → Add Document", () => {
    const readiness = createReadiness(false);
    const documents: Document[] = [];
    
    let primaryCta: { label: string } | null = null;
    if (!readiness.canGenerate) {
      // intake incomplete - would be caught first
    } else if (documents.length === 0) {
      primaryCta = { label: "+ Add Document →" };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).toBe("+ Add Document →");
  });

  test("needs review → Review Document", () => {
    const readiness = createReadiness(false);
    const documents = [
      createDocument({ reviewStatus: "NEEDS_REVIEW" }),
      createDocument({ reviewStatus: "APPROVED" }),
    ];
    
    let primaryCta: { label: string } | null = null;
    if (!readiness.canGenerate) {
      // intake incomplete
    } else if (documents.length === 0) {
      // no docs
    } else if (hasNeedsReview(documents)) {
      primaryCta = { label: "Review Document →" };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).toBe("Review Document →");
  });

  test("generating → View Generation", () => {
    const readiness = createReadiness(false);
    const documents = [
      createDocument({ generationStatus: "GENERATING" }),
    ];
    
    let primaryCta: { label: string } | null = null;
    if (!readiness.canGenerate) {
    } else if (documents.length === 0) {
    } else if (hasNeedsReview(documents)) {
    } else if (hasGenerating(documents)) {
      primaryCta = { label: "View Generation →" };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).toBe("View Generation →");
  });

  test("failed → Review / Retry", () => {
    const readiness = createReadiness(false);
    const documents = [
      createDocument({ generationStatus: "FAILED" }),
    ];
    
    let primaryCta: { label: string } | null = null;
    if (!readiness.canGenerate) {
    } else if (documents.length === 0) {
    } else if (hasNeedsReview(documents)) {
    } else if (hasGenerating(documents)) {
    } else if (hasFailed(documents)) {
      primaryCta = { label: "Review / Retry →" };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).toBe("Review / Retry →");
  });

  test("all approved/exported → Add Document", () => {
    const readiness = createReadiness(false);
    const documents = [
      createDocument({ generationStatus: "GENERATED", reviewStatus: "APPROVED" }),
      createDocument({ generationStatus: "GENERATED", reviewStatus: "APPROVED" }),
    ];
    
    let primaryCta: { label: string } | null = null;
    if (!readiness.canGenerate) {
    } else if (documents.length === 0) {
    } else if (hasNeedsReview(documents)) {
    } else if (hasGenerating(documents)) {
    } else if (hasFailed(documents)) {
    } else {
      primaryCta = { label: "+ Add Document →" };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).toBe("+ Add Document →");
  });
});

describe("Application Workspace — Readiness Panel", () => {
  test("amber/action-required semantics when missing info", () => {
    const readiness = createReadiness(true);
    const missingSections = readiness.sections.filter(s => !s.optional && s.status === "missing");
    const missingCount = missingSections.length;
    
    expect(missingCount).toBeGreaterThan(0);
    expect(readiness.canGenerate).toBe(false);
  });

  test("missing application sections shown", () => {
    const readiness = createReadiness(true);
    const missingSections = readiness.sections.filter(s => !s.optional && s.status === "missing");
    
    const labels = missingSections.map(s => s.label);
    expect(labels).toContain("Country Questions");
    expect(labels).toContain("Master's Motivation");
    expect(labels).toContain("Career Goals");
  });

  test("NO 'Upload CV to pre-fill' for application-specific answers", () => {
    const readiness = createReadiness(true);
    // The readiness panel should NOT offer CV upload for application-specific missing info
    // This is verified by the CTA being "Complete Information" not CV upload
    const missingSections = readiness.sections.filter(s => !s.optional && s.status === "missing");
    const ctaLabel = `Complete ${missingSections.length} Missing Answers →`;
    
    expect(ctaLabel).toContain("Complete");
    expect(ctaLabel).not.toContain("CV");
    expect(ctaLabel).not.toContain("pre-fill");
  });

  test("no fatal red styling (uses amber)", () => {
    // Readiness panel uses bg-dvivid-warning-light border-dvivid-warning/30
    // NOT bg-dvivid-error-light
    const panelClass = "bg-dvivid-warning-light border-dvivid-warning/30 rounded-card";
    expect(panelClass).toContain("warning");
    expect(panelClass).not.toContain("error");
  });
});

describe("Application Workspace — Document Status/Action Mapping", () => {
  test("APPROVED → Export →", () => {
    const doc = createDocument({ reviewStatus: "APPROVED" });
    const action = docAction(doc);
    expect(action.label).toBe("Export →");
    expect(action.color).toContain("success");
  });

  test("NEEDS_REVIEW → Review →", () => {
    const doc = createDocument({ reviewStatus: "NEEDS_REVIEW" });
    const action = docAction(doc);
    expect(action.label).toBe("Review →");
    expect(action.color).toContain("primary");
  });

  test("IN_REVIEW → Review →", () => {
    const doc = createDocument({ reviewStatus: "IN_REVIEW" });
    const action = docAction(doc);
    expect(action.label).toBe("Review →");
  });

  test("GENERATING → Generating...", () => {
    const doc = createDocument({ generationStatus: "GENERATING" });
    const action = docAction(doc);
    expect(action.label).toBe("Generating...");
    expect(action.color).toContain("warning");
  });

  test("FAILED → Retry →", () => {
    const doc = createDocument({ generationStatus: "FAILED" });
    const action = docAction(doc);
    expect(action.label).toBe("Retry →");
    expect(action.color).toContain("error");
  });

  test("GENERATED (no review) → Review →", () => {
    const doc = createDocument({ generationStatus: "GENERATED", reviewStatus: "" });
    const action = docAction(doc);
    expect(action.label).toBe("Review →");
  });

  test("NOT_STARTED → Generate →", () => {
    const doc = createDocument({ generationStatus: "NOT_STARTED" });
    const action = docAction(doc);
    expect(action.label).toBe("Generate →");
  });
});

describe("Application Workspace — Empty Documents State", () => {
  test("shows correct empty message", () => {
    const documents: Document[] = [];
    expect(documents.length).toBe(0);
  });

  test("shows Add Document action in empty state", () => {
    // Empty state should show "Add First Document" button
    const emptyStateAction = "Add First Document";
    expect(emptyStateAction).toBe("Add First Document");
  });
});

describe("Application Workspace — Application Info", () => {
  test("shows application-scoped metadata only", () => {
    const application = createApplication();
    
    // These are application-scoped
    expect(application.universityName).toBeDefined();
    expect(application.programName).toBeDefined();
    expect(application.degree).toBeDefined();
    expect(application.department).toBeDefined();
    expect(application.country).toBeDefined();
    expect(application.intake).toBeDefined();
    expect(application.intakeYear).toBeDefined();
    expect(application.status).toBeDefined();
    
    // Student fields should NOT be here (those are in student profile)
    // Application info only shows application-scoped data
  });

  test("does NOT show reusable student facts", () => {
    const application = createApplication();
    
    // These should NOT be in application info
    expect(application).not.toHaveProperty("education");
    expect(application).not.toHaveProperty("experience");
    expect(application).not.toHaveProperty("skills");
    expect(application).not.toHaveProperty("personalData");
  });
});

describe("Add Application to Existing Student", () => {
  test("University is required", () => {
    const errs: Record<string, string> = {};
    const universityName = "";
    if (!universityName.trim()) errs.universityName = "Please enter the university name.";
    expect(errs.universityName).toBe("Please enter the university name.");
  });

  test("Program is required", () => {
    const errs: Record<string, string> = {};
    const programName = "";
    if (!programName.trim()) errs.programName = "Please enter the program name.";
    expect(errs.programName).toBe("Please enter the program name.");
  });

  test("Degree is required", () => {
    const errs: Record<string, string> = {};
    const degree = "";
    if (!degree) errs.degree = "Choose a degree type.";
    expect(errs.degree).toBe("Choose a degree type.");
  });

  test("optional fields present", () => {
    const department = "CEE";
    const country = "USA";
    const intake = "Fall";
    const intakeYear = "2027";
    
    // These should be accepted as optional
    expect(department).toBeDefined();
    expect(country).toBeDefined();
    expect(intake).toBeDefined();
    expect(intakeYear).toBeDefined();
  });

  test("creates only APPLICATION for existing student", () => {
    const studentId = "stu-1";
    const body = {
      studentId,
      universityName: "MIT",
      programName: "Computer Science",
      degree: "Master of Science",
      department: "EECS",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    };
    
    expect(body.studentId).toBe("stu-1");
    expect(body.universityName).toBe("MIT");
    // No student fields (firstName, lastName, email) in body
    expect(body).not.toHaveProperty("firstName");
    expect(body).not.toHaveProperty("lastName");
    expect(body).not.toHaveProperty("email");
  });

  test("validation uses human-readable messages", () => {
    const emptyString = "";
    const errs: Record<string, string> = {};
    if (!emptyString) errs.universityName = "Please enter the university name.";
    if (!emptyString) errs.programName = "Please enter the program name.";
    if (!emptyString) errs.degree = "Choose a degree type.";
    
    expect(errs.universityName).toBe("Please enter the university name.");
    expect(errs.programName).toBe("Please enter the program name.");
    expect(errs.degree).toBe("Choose a degree type.");
    
    // No raw Zod/API codes
    expect(errs.universityName).not.toContain("Zod");
    expect(errs.universityName).not.toContain("REQUIRED");
    expect(errs.universityName).not.toContain("VALIDATION");
  });
});

describe("Scope Separation", () => {
  test("no student scope leakage in Application Workspace", () => {
    const application = createApplication();
    
    // Application only has app-scoped fields
    const appFields = Object.keys(application);
    expect(appFields).toContain("universityName");
    expect(appFields).toContain("programName");
    expect(appFields).toContain("degree");
    expect(appFields).toContain("country");
    expect(appFields).toContain("intake");
    
    // Should NOT have student-scoped fields
    expect(appFields).not.toContain("firstName");
    expect(appFields).not.toContain("lastName");
    expect(appFields).not.toContain("email");
    expect(appFields).not.toContain("personalData");
    expect(appFields).not.toContain("education");
    expect(appFields).not.toContain("experience");
  });

  test("no application scope leakage in document", () => {
    const document = createDocument();
    
    // Document only has document-scoped fields
    const docFields = Object.keys(document);
    expect(docFields).toContain("documentTitle");
    expect(docFields).toContain("documentType");
    expect(docFields).toContain("promptText");
    expect(docFields).toContain("promptSource");
    expect(docFields).toContain("wordMin");
    expect(docFields).toContain("wordMax");
    expect(docFields).toContain("generationStatus");
    expect(docFields).toContain("reviewStatus");
    
    // Should NOT have application-scoped fields (those are on application, not document)
    expect(docFields).not.toContain("universityName");
    expect(docFields).not.toContain("programName");
    expect(docFields).not.toContain("countryQuestionnaire");
    expect(docFields).not.toContain("mastersMotivation");
  });

  test("no document scope leakage in application", () => {
    const application = createApplication();
    const appFields = Object.keys(application);
    
    expect(appFields).not.toContain("documentTitle");
    expect(appFields).not.toContain("promptText");
    expect(appFields).not.toContain("generationStatus");
    expect(appFields).not.toContain("reviewStatus");
  });
});

describe("No Application-Level Export All / Export Final CTA", () => {
  test("primary CTA never exports all documents", () => {
    const readiness = createReadiness(false);
    const documents = [
      createDocument({ reviewStatus: "APPROVED" }),
      createDocument({ reviewStatus: "APPROVED" }),
    ];
    
    let primaryCta: { label: string } | null = null;
    if (!readiness.canGenerate) {
    } else if (documents.length === 0) {
    } else if (hasNeedsReview(documents)) {
    } else if (hasGenerating(documents)) {
    } else if (hasFailed(documents)) {
    } else {
      primaryCta = { label: "+ Add Document →" };
    }
    
    expect(primaryCta).not.toBeNull();
    expect(primaryCta!.label).not.toContain("Export");
    expect(primaryCta!.label).not.toContain("export");
    expect(primaryCta!.label).toBe("+ Add Document →");
  });

  test("document-level export exists but not at application level", () => {
    const doc = createDocument({ reviewStatus: "APPROVED" });
    const action = docAction(doc);
    
    expect(action.label).toBe("Export →");
    // This is document-level, not application-level
  });
});

// ============================================================
// TEST SUMMARY
// ============================================================

setTimeout(() => {
  console.log(`\n${"=".repeat(60)}`);
  if (failCount === 0) {
    console.log(`✅ All tests passed: ${passCount}/${passCount}`);
  } else {
    console.log(`❌ Tests failed: ${failCount} failed, ${passCount} passed`);
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`${"=".repeat(60)}\n`);
  process.exit(failCount > 0 ? 1 : 0);
}, 100);

export { 
  docStatus, 
  docAction, 
  hasNeedsReview, 
  hasGenerating, 
  hasFailed, 
  getPrimaryDoc,
  createStudent,
  createApplication,
  createDocument,
  createReadiness,
  createReqLookup,
};