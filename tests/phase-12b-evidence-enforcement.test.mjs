import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !specifier.endsWith(".ts") && error.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { buildEvidenceLedger, checkClaimSupport } = await import("../src/lib/ai/evidence-ledger.ts");
const { planComponentActions } = await import("../src/lib/ai/component-action-planner.ts");
const { buildBoundedFinalizerPrompt, validateFinalizerOutput, BoundedFinalizerBlockedError } = await import("../src/lib/ai/bounded-finalizer.ts");
const { buildGenericQualityReviewerPrompt } = await import("../src/lib/ai/prompts/generic/quality-reviewer.ts");

const approvedFaculty = {
  facultyName: "Approved Professor", status: "STUDENT_APPROVED", verifiedProgramFactSource: "official-source-1",
  studentInterestEvidence: ["Student approved this interest"], alignmentReason: "Relevant research",
};
const unapprovedFaculty = { ...approvedFaculty, facultyName: "UNAPPROVED_PROFESSOR", status: "PROPOSED" };
const studentFacts = {
  personalDetails: { firstName: "Ada", middleName: "M", lastName: "Student", nationality: "Indian", languages: "Hindi, English" },
  education: [{ id: "edu", degree: "BTech", level: "Bachelor's", institution: "Institute", board: "Board", specialization: "Civil", startYear: "2019", endYear: "2023", percentage: "82", cgpa: "8.5", cgpaScale: "10", backlogs: "0", status: "Completed" }],
  experience: [{ id: "exp", type: "Internship", organization: "Lab", role: "Intern", startDate: "2022-01", endDate: "2022-06", currentlyWorking: false, location: "Delhi", responsibilities: "Tested structures", keyAchievements: "Reported findings", skillsLearned: "Instrument calibration" }],
  projects: [{ id: "project", name: "Seismic analysis", type: "Academic", description: "Seismic structural response", studentRole: "Analyst", technologies: "MATLAB", outcome: "Compared models", whatLearned: "Boundary condition sensitivity" }],
  research: [{ id: "research", topic: "Structural monitoring", institution: "Research lab", role: "Assistant", description: "Compared sensor readings", outcome: "Internal report" }],
  publications: [{ id: "publication", title: "Sensor readings", venue: "Student symposium", status: "Submitted", year: "2023", link: "local-publication-reference" }],
  achievements: [{ id: "award", type: "Award", title: "Service award", description: "Community teaching", year: "2023" }],
  careerGoals: { whyField: "Structural safety", whyProgram: "Advanced study", shortTermGoals: "Engineer", longTermGoals: "Researcher", desiredRole: "Structural engineer", industries: "Infrastructure", returnHomeCountry: "Yes", returnPlans: "Work in India" },
  personalStory: { motivation: "Safety", influencingExperience: "Bridge visit", challenges: "Limited equipment", proudOf: "Mentoring", qualities: "Patience", leadershipExample: "Coordinated a student team", teamworkExample: "Shared testing duties", outsideAcademics: "Music", communityService: "Taught mathematics", familyBackground: "Teachers" },
  englishProficiency: { testType: "IELTS", status: "Completed", overallScore: "7.5", writing: "7", listening: "8", reading: "8", speaking: "7" },
};
const ledger = buildEvidenceLedger({ studentFacts, facultyAlignment: [unapprovedFaculty, approvedFaculty], programContextText: "Verified structural engineering curriculum" });
const text = "I compared sensor readings and learned to document the limitations carefully.";
const component = (id = "A", topics = ["research", "service"], maxPages = 1) => ({
  componentId: id, label: id, exactPrompt: "Describe relevant experience.",
  pageLimit: { type: "PER_RESPONSE_COMPONENT", maxPages, status: "VERIFIED" },
  wordLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
  characterLimit: { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
  requiredTopics: topics.map(topic => ({ topic, status: "VERIFIED", sourceId: "source", sourceQuote: topic })),
  sourceId: "source", status: "VERIFIED", verifiedAt: "2025-01-01T00:00:00Z",
});
const render = (components = [{ id: "A", pages: 1, status: "PASS" }]) => ({
  components: components.map(c => ({ componentId: c.id, label: c.id, actualPages: c.pages, maxPages: c.max ?? 1, status: c.status, wordCount: 12, characterCount: text.length, renderProfileId: "fixed" })),
  combinedActualPages: components.reduce((sum, c) => sum + c.pages, 0), combinedMaxPages: components.length,
  combinedStatus: components.some(c => c.status === "RENDER_OVERFLOW") ? "RENDER_OVERFLOW" : "PASS", renderProfileId: "fixed", renderProfileVersion: "1",
});
const covered = [{ topic: "research", covered: true, allowedEvidenceIds: [] }, { topic: "service", covered: true, allowedEvidenceIds: [] }];
const missing = [{ topic: "research", covered: false, allowedEvidenceIds: ["SF-RES-0"] }, { topic: "service", covered: false, allowedEvidenceIds: ["SF-STORY"] }];
function inputs(coverage = covered, overrides = {}) {
  return {
    responseComponents: [component()], renderFeedback: render(),
    qualityReview: { componentScores: [{ componentId: "A", score: 10, topicCoverage: coverage }], requirementCompliance: { requiredTopics: "PASS" } },
    evidenceLedger: ledger, calibratedResponses: [{ componentId: "A", text }], ...overrides,
  };
}
function guard(input, finalResponses = input.calibratedResponses, overrides = {}) {
  return validateFinalizerOutput({ actionPlan: planComponentActions(input), calibratedResponses: input.calibratedResponses, finalResponses, finalRenderFeedback: input.renderFeedback, evidenceLedger: input.evidenceLedger, responseComponents: input.responseComponents, ...overrides });
}
function prompt(input, overrides = {}) {
  return buildBoundedFinalizerPrompt({ actionPlan: planComponentActions(input), calibratedOutput: { responses: input.calibratedResponses }, evidenceLedger: input.evidenceLedger, responseComponents: input.responseComponents, ...overrides });
}
const refs = [{ topic: "research", evidenceIds: ["SF-RES-0"] }, { topic: "service", evidenceIds: ["SF-STORY"] }];
const repaired = [{ componentId: "A", text: "I compared sensor readings and taught mathematics.", repairReferences: refs }];

for (const [field, id] of [["personalDetails", "SF-PERSONAL"], ["education", "SF-EDU-0"], ["experience", "SF-EXP-0"], ["projects", "SF-PROJ-0"], ["research", "SF-RES-0"], ["publications", "SF-PUB-0"], ["achievements", "SF-ACH-0"], ["careerGoals", "SF-CAREER"], ["personalStory", "SF-STORY"], ["englishProficiency", "SF-ENGLISH"]]) {
  test(`ledger preserves all supplied actual ${field} fields`, () => {
    const original = Array.isArray(studentFacts[field]) ? studentFacts[field][0] : studentFacts[field];
    assert.deepEqual(JSON.parse(ledger.allEntries.find(e => e.id === id).canonicalText), original);
  });
}

test("ledger preserves structured application facts without object coercion and excludes unapproved faculty", () => {
  const result = buildEvidenceLedger({
    studentFacts: { applicationSpecificFacts: { facultyAlignment: [unapprovedFaculty, approvedFaculty], explanation: { activity: "Teaching", hours: 0, ongoing: false } } },
    facultyAlignment: [unapprovedFaculty, approvedFaculty],
    applicationSpecificFacts: [{ text: "Approved activity", detail: { method: "Tutoring", outcome: "Weekly sessions" } }, { facultyName: "UNAPPROVED_PROFESSOR", status: "REJECTED" }],
  });
  assert(!JSON.stringify(result).includes("UNAPPROVED_PROFESSOR"));
  assert(!JSON.stringify(result).includes("[object Object]"));
  assert(result.allEntries.some(e => e.id === "SF-APP-facultyAlignment-1" && e.source.endsWith("[1]")));
  assert.equal(JSON.parse(result.allEntries.find(e => e.id === "AF-0").canonicalText).detail.method, "Tutoring");
  assert.equal(JSON.parse(result.facultyFacts[0].canonicalText).facultyName, "Approved Professor");
  assert.equal(JSON.parse(result.allEntries.find(e => e.id === "SF-APP-explanation").canonicalText).hours, 0);
});

test("empty records do not become phantom evidence", () => {
  const empty = buildEvidenceLedger({ studentFacts: { personalDetails: { firstName: "", lastName: " " }, education: [{ id: "empty", degree: "" }], careerGoals: {}, personalStory: {} }, facultyAlignment: [] });
  assert.deepEqual(empty.allEntries, []);
});

test("ledger hash changes for previously omitted evidence fields", () => {
  const changed = structuredClone(studentFacts);
  changed.personalStory.communityService = "No community service";
  assert.notEqual(buildEvidenceLedger({ studentFacts: changed, facultyAlignment: [unapprovedFaculty, approvedFaculty], programContextText: "Verified structural engineering curriculum" }).ledgerHash, ledger.ledgerHash);
});

test("keyword overlap, changed methods and negations never establish claim support", () => {
  const canonical = ledger.allEntries.find(e => e.id === "SF-PROJ-0").canonicalText;
  assert.deepEqual(checkClaimSupport(canonical, ledger), ["SF-PROJ-0"]);
  for (const claim of ["I used ANSYS for seismic structural response analysis", "I never used MATLAB for seismic structural response", canonical.replace("MATLAB", "ANSYS"), ""]) {
    assert.equal(checkClaimSupport(claim, ledger), null);
  }
});

test("explicit coverage alone drives FREEZE, not scores or global flags", () => {
  const input = inputs();
  input.qualityReview.componentScores[0].score = 1;
  input.qualityReview.requirementCompliance.requiredTopics = "FAIL";
  const action = planComponentActions(input);
  assert.equal(action.blocked, false);
  assert.equal(action.plans[0].action, "FREEZE");
  assert.equal(guard(input).passed, true);
});

test("high score and global PASS cannot hide locally missing topics with explicit evidence", () => {
  const action = planComponentActions(inputs(missing));
  assert.equal(action.blocked, false);
  assert.equal(action.plans[0].action, "TARGETED_COMPLIANCE_REPAIR");
  assert.deepEqual(action.plans[0].topicEvidence, missing.map(({ topic, allowedEvidenceIds }) => ({ topic, allowedEvidenceIds })));
});

for (const [name, coverage] of [
  ["absent", undefined], ["empty", []], ["partial", covered.slice(0, 1)], ["duplicate", [covered[0], covered[0], covered[1]]],
  ["extra", [...covered, { topic: "career", covered: true }]], ["paraphrased", [{ topic: "Research", covered: true }, covered[1]]],
  ["non-boolean", [{ topic: "research", covered: "true" }, covered[1]]],
]) {
  test(`${name} topic coverage fails closed without score inference`, () => {
    const input = inputs();
    input.qualityReview.componentScores[0].topicCoverage = coverage;
    input.qualityReview.componentScores[0].score = 1;
    input.qualityReview.requirementCompliance.requiredTopics = "FAIL";
    const action = planComponentActions(input);
    assert.equal(action.blocked, true);
    assert(action.blockingIssues.some(i => i.code === "REQUIRED_TOPIC_COVERAGE_UNKNOWN"));
    assert.deepEqual(action.plans[0].missingTopics, []);
    assert.throws(() => prompt(input), BoundedFinalizerBlockedError);
    assert.equal(guard(input).passed, false);
  });
}

test("each missing topic requires its own evidence even if other topics have evidence", () => {
  const input = inputs([missing[0], { topic: "service", covered: false, allowedEvidenceIds: [] }]);
  const action = planComponentActions(input);
  assert.equal(action.blocked, true);
  assert(action.blockingIssues.some(i => i.code === "MISSING_REQUIRED_STUDENT_INFORMATION" && i.topic === "service"));
  assert(guard(input).violations.includes("MISSING_REQUIRED_STUDENT_INFORMATION"));
  assert.throws(() => prompt(input), BoundedFinalizerBlockedError);
});

for (const ids of [["UNKNOWN"], ["SF-RES-0", "UNKNOWN"], ["SF-RES-0", "SF-RES-0"], [null]]) {
  test(`invalid evidence IDs fail closed: ${JSON.stringify(ids)}`, () => {
    const input = inputs([{ ...missing[0], allowedEvidenceIds: ids }, missing[1]]);
    assert(planComponentActions(input).blockingIssues.some(i => i.code === "FINALIZER_EVIDENCE_VIOLATION"));
    assert.throws(() => prompt(input), BoundedFinalizerBlockedError);
  });
}

test("ambiguous ledger IDs fail closed", () => {
  const duplicated = structuredClone(ledger);
  duplicated.allEntries.push(duplicated.allEntries.find(e => e.id === "SF-RES-0"));
  assert.equal(planComponentActions(inputs(missing, { evidenceLedger: duplicated })).blocked, true);
});

test("component-local coverage is never borrowed from another component", () => {
  const input = inputs(covered, {
    responseComponents: [component("A"), component("B")], calibratedResponses: [{ componentId: "A", text }, { componentId: "B", text }],
    renderFeedback: render([{ id: "A", pages: 1, status: "PASS" }, { id: "B", pages: 1, status: "PASS" }]),
    qualityReview: { componentScores: [{ componentId: "A", score: 10, topicCoverage: covered }, { componentId: "B", score: 10 }] },
  });
  const action = planComponentActions(input);
  assert.equal(action.plans.length, 2);
  assert.equal(action.blocked, true);
  assert(action.blockingIssues.some(i => i.componentId === "B" && i.code === "REQUIRED_TOPIC_COVERAGE_UNKNOWN"));
});

for (const [name, mutate] of [
  ["contract duplicate", input => input.responseComponents.push(component())],
  ["calibrated missing", input => input.calibratedResponses = []],
  ["calibrated duplicate", input => input.calibratedResponses.push({ componentId: "A", text })],
  ["calibrated extra", input => input.calibratedResponses.push({ componentId: "B", text })],
  ["quality missing", input => input.qualityReview.componentScores = []],
  ["quality duplicate", input => input.qualityReview.componentScores.push(input.qualityReview.componentScores[0])],
  ["quality extra", input => input.qualityReview.componentScores.push({ componentId: "B", topicCoverage: covered })],
]) {
  test(`${name} is blocking`, () => {
    const input = inputs();
    mutate(input);
    assert.equal(planComponentActions(input).blocked, true);
    assert.throws(() => prompt(input), BoundedFinalizerBlockedError);
  });
}

test("overflow actions are deterministic and missing evidence cannot silently pass as compression", () => {
  const overflow = render([{ id: "A", pages: 2, status: "RENDER_OVERFLOW" }]);
  assert.equal(planComponentActions(inputs(covered, { renderFeedback: overflow })).plans[0].action, "COMPRESS");
  assert.equal(planComponentActions(inputs(missing, { renderFeedback: overflow })).plans[0].action, "COMPRESS_AND_REPAIR");
  const noEvidence = inputs(missing.map(t => ({ ...t, allowedEvidenceIds: [] })), { renderFeedback: overflow });
  assert.equal(planComponentActions(noEvidence).blocked, true);
  assert(guard(noEvidence).violations.includes("MISSING_REQUIRED_STUDENT_INFORMATION"));
});

test("missing pre-final render with a page constraint blocks planning", () => {
  assert.equal(planComponentActions(inputs(covered, { renderFeedback: null })).blocked, true);
});

test("FREEZE text, length and page violations all survive in one guard result", () => {
  const result = guard(inputs(), [{ componentId: "A", text: `${text} Extra invented facts.` }], { finalRenderFeedback: render([{ id: "A", pages: 2, status: "RENDER_OVERFLOW" }]) });
  for (const code of ["FINALIZER_SCOPE_VIOLATION", "FINALIZER_LENGTH_REGRESSION", "FINALIZER_PAGE_REGRESSION"]) assert(result.violations.includes(code));
});

test("FREEZE shortening is also a length and scope violation", () => {
  const result = guard(inputs(), [{ componentId: "A", text: "Short." }]);
  assert(result.violations.includes("FINALIZER_SCOPE_VIOLATION"));
  assert(result.violations.includes("FINALIZER_LENGTH_REGRESSION"));
});

test("FREEZE same-length substitution violates scope", () => {
  assert(guard(inputs(), [{ componentId: "A", text: text.replace("I", "X") }]).violations.includes("FINALIZER_SCOPE_VIOLATION"));
});

for (const [name, finalResponses] of [["missing", []], ["duplicate", [{ componentId: "A", text }, { componentId: "A", text }]], ["extra", [{ componentId: "A", text }, { componentId: "B", text }]], ["invalid text", [{ componentId: "A", text: null }]]]) {
  test(`${name} final response is rejected`, () => assert(guard(inputs(), finalResponses).violations.includes("FINALIZER_SCOPE_VIOLATION")));
}

for (const [name, mutate] of [["missing", plan => plan.plans = []], ["duplicate", plan => plan.plans.push(plan.plans[0])], ["extra", plan => plan.plans.push({ ...plan.plans[0], componentId: "B" })], ["contradictory scope", plan => plan.editableComponentIds.push("A")]]) {
  test(`${name} action-plan component is rejected`, () => {
    const input = inputs();
    const plan = planComponentActions(input);
    mutate(plan);
    assert(guard(input, input.calibratedResponses, { actionPlan: plan }).violations.includes("FINALIZER_SCOPE_VIOLATION"));
    assert.throws(() => prompt(input, { actionPlan: plan }), BoundedFinalizerBlockedError);
  });
}

for (const [name, finalRenderFeedback] of [["missing", null], ["empty", render([])], ["duplicate", render([{ id: "A", pages: 1, status: "PASS" }, { id: "A", pages: 1, status: "PASS" }])], ["engine error", render([{ id: "A", pages: 0, status: "RENDER_ENGINE_ERROR" }])]]) {
  test(`${name} final render is rejected`, () => assert.equal(guard(inputs(), undefined, { finalRenderFeedback }).passed, false));
}

test("numeric page regression cannot hide behind PASS status", () => {
  const result = guard(inputs(), undefined, { finalRenderFeedback: render([{ id: "A", pages: 2, max: 3, status: "PASS" }]) });
  assert(result.violations.includes("FINALIZER_PAGE_REGRESSION"));
});

for (const coverage of [covered, missing]) {
  test(`${coverage === covered ? "COMPRESS" : "COMPRESS_AND_REPAIR"} rejects expansion`, () => {
    const input = inputs(coverage, { renderFeedback: render([{ id: "A", pages: 2, status: "RENDER_OVERFLOW" }]) });
    const result = guard(input, [{ componentId: "A", text: text.repeat(2), repairReferences: coverage === missing ? refs : [] }]);
    assert(result.violations.includes("FINALIZER_LENGTH_REGRESSION"));
  });
}

test("valid targeted repair carries exact per-topic references and leaves semantic audit mandatory", () => {
  const result = guard(inputs(missing), repaired);
  assert.equal(result.passed, true);
  assert.equal(result.requiresSemanticAudit, true);
});

test("only explicit repair permits a numeric page regression in this guard", () => {
  const result = guard(inputs(missing), repaired, { finalRenderFeedback: render([{ id: "A", pages: 2, status: "RENDER_OVERFLOW" }]) });
  assert(!result.violations.includes("FINALIZER_PAGE_REGRESSION"));
  assert.equal(result.requiresSemanticAudit, true);
});

for (const [name, references] of [
  ["absent", undefined], ["empty", []], ["missing topic", refs.slice(0, 1)], ["duplicate topic", [...refs, refs[0]]],
  ["extra topic", [...refs, { topic: "career", evidenceIds: ["SF-CAREER"] }]],
  ["cross-topic", [{ topic: "research", evidenceIds: ["SF-STORY"] }, refs[1]]],
  ["unknown ID", [{ topic: "research", evidenceIds: ["UNKNOWN"] }, refs[1]]],
  ["duplicate ID", [{ topic: "research", evidenceIds: ["SF-RES-0", "SF-RES-0"] }, refs[1]]],
  ["empty IDs", [{ topic: "research", evidenceIds: [] }, refs[1]]],
]) {
  test(`${name} repair references are rejected`, () => {
    const result = guard(inputs(missing), [{ componentId: "A", text: repaired[0].text, repairReferences: references }]);
    assert(result.violations.includes("FINALIZER_EVIDENCE_VIOLATION"));
  });
}

test("repair validation requires the actual ledger, not just a component-wide allowlist", () => {
  assert(guard(inputs(missing), repaired, { evidenceLedger: undefined }).violations.includes("FINALIZER_EVIDENCE_VIOLATION"));
  const input = inputs(missing);
  const actionPlan = planComponentActions(input);
  delete actionPlan.plans[0].topicEvidence;
  assert(guard(input, repaired, { actionPlan }).violations.includes("FINALIZER_EVIDENCE_VIOLATION"));
});

test("ledger replacement after planning is rejected", () => {
  const actionPlan = planComponentActions(inputs(missing));
  const different = buildEvidenceLedger({ studentFacts: { personalStory: { motivation: "Different facts" } }, facultyAlignment: [] });
  assert(guard(inputs(missing), repaired, { actionPlan, evidenceLedger: different }).violations.includes("FINALIZER_EVIDENCE_VIOLATION"));
});

test("bounded prompt only serializes ledger, calibrated text and action instructions", () => {
  const input = inputs(missing);
  const result = prompt(input, {
    studentFactsText: "RAW_STUDENT_SECRET", plan: { text: "UNAPPROVED_PLAN_SECRET" }, qualityReview: { text: "QUALITY_SECRET" },
    facultyAlignment: [unapprovedFaculty],
    calibratedOutput: { responses: input.calibratedResponses, originalDraft: "DRAFT_SECRET", feedback: "CALIBRATION_SECRET" },
  });
  for (const secret of ["RAW_STUDENT_SECRET", "UNAPPROVED_PLAN_SECRET", "QUALITY_SECRET", "DRAFT_SECRET", "CALIBRATION_SECRET", "UNAPPROVED_PROFESSOR"]) {
    assert(!`${result.system}${result.user}`.includes(secret));
  }
  const payload = JSON.parse(result.user);
  assert.deepEqual(Object.keys(payload), ["evidenceLedger", "componentActions"]);
  assert.equal(payload.componentActions[0].calibratedText, text);
  assert.deepEqual(payload.componentActions[0].topicEvidence, missing.map(({ topic, allowedEvidenceIds }) => ({ topic, allowedEvidenceIds })));
  assert(result.system.includes("repairReferences"));
  assert(result.system.includes("stage-6"));
});

test("no-topic components still require explicit empty local coverage", () => {
  const input = inputs([], { responseComponents: [component("A", [], null)], renderFeedback: null });
  assert.equal(planComponentActions(input).blocked, false);
  assert.equal(guard(input).passed, true);
  delete input.qualityReview.componentScores[0].topicCoverage;
  assert.equal(planComponentActions(input).blocked, true);
});

test("malformed coverage entries and null final entries reject without throwing", () => {
  const input = inputs([null, ...missing]);
  assert.equal(planComponentActions(input).blocked, true);
  assert.equal(guard(inputs(), [null]).passed, false);
});

test("unknown IDs without any actual ledger evidence report missing student information", () => {
  const input = inputs(missing, { evidenceLedger: null });
  assert(planComponentActions(input).blockingIssues.some(i => i.code === "MISSING_REQUIRED_STUDENT_INFORMATION"));
});

test("valid shortening passes for both compression actions", () => {
  for (const coverage of [covered, missing]) {
    const input = inputs(coverage, { renderFeedback: render([{ id: "A", pages: 2, status: "RENDER_OVERFLOW" }]) });
    const output = [{ componentId: "A", text: repaired[0].text, repairReferences: coverage === missing ? refs : [] }];
    assert.equal(guard(input, output, { finalRenderFeedback: render() }).passed, true);
  }
});

test("quality prompt requests exact per-component coverage and ledger IDs with backward-compatible fourth argument", () => {
  const withLedger = buildGenericQualityReviewerPrompt({ responses: [{ componentId: "A", text }] }, [component()], [approvedFaculty], ledger);
  assert(withLedger.system.includes("topicCoverage"));
  assert(withLedger.system.includes("candidateEvidence"));
  assert(withLedger.user.includes("SF-RES-0"));
  const withoutLedger = buildGenericQualityReviewerPrompt({ responses: [] }, [component()], []);
  assert(withoutLedger.user.includes("Not supplied"));
});
