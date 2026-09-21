/**
 * document-evidence-policy.test.ts — deterministic checks for the
 * document-specific evidence selection layer. No provider calls, no DB.
 *
 * Covers:
 *   1. VISA_SOP — country + motivation + career HIGH; projects/metrics selective
 *   2. SOP — broader academic/professional evidence preserved
 *   3. LOR — recommender-known evidence only; visa/country EXCLUDED
 *   4. ESSAY — question-focused evidence
 *   5. COVER_LETTER — job-relevant evidence
 *   6. Fact Reviewer — full evidence retained regardless of Writer filtering
 *   7. Priority absence — does NOT create a fatal blocker
 *   8. Document requirements — not accidentally filtered
 *   9. Shivang Visa SOP — what would reach Writer
 *  10. Context size — measured character reduction (no cost claims)
 */
import assert from "node:assert/strict";
import {
  DOCUMENT_EVIDENCE_POLICIES,
  getDocumentEvidencePolicy,
  classifyEvidenceEntry,
  buildDocumentEvidencePacket,
  formatDocumentEvidencePacketText,
  buildFilteredLedgerView,
  buildFinalizerLedgerView,
  renderDocumentEvidencePacketDiagnostics,
  type EvidencePriority,
  type SemanticEvidenceCategory,
} from "../src/lib/ai/document-evidence-policy";
import { buildEvidenceLedger } from "../src/lib/ai/evidence-ledger";
import type { EvidenceLedger, EvidenceEntry } from "../src/lib/ai/evidence-ledger";
import type { DocumentType } from "../src/lib/application/application-types";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

// ============================================================
// FIXTURE — Shivang-like applicant with rich, varied evidence
// ============================================================

const shivangProfile: any = {
  personalDetails: { fullName: "Shivang Patel", email: "shivang@example.com" },
  education: [
    { degree: "B.Tech Computer Science", institution: "IIT Bombay", year: "2020", gpa: "8.7/10" },
  ],
  experience: [
    { role: "ML Engineer", company: "AI Startup A", years: "2020-2022", details: "Built recommendation systems, shipped 3 SDKs, 40% engagement lift" },
    { role: "Senior SDE", company: "Fintech B", years: "2022-2024", details: "Led payments platform, reduced latency 60%, mentored 4 engineers" },
    { role: "Intern", company: "Old unrelated firm", years: "2019", details: "Unrelated legacy maintenance work" },
  ],
  projects: [
    { name: "RAG Search Engine", details: "Built LLM RAG system with 2M docs, 95% recall, used in production" },
    { name: "Unrelated hobby app", details: "Personal weather widget, no professional relevance" },
  ],
  skills: { technical: ["Python", "PyTorch", "TypeScript", "Kubernetes", "AWS"], languages: ["English", "Hindi"] },
  achievements: [
    { title: "National Hackathon Winner", year: "2019", details: "1st place out of 500 teams" },
    { title: "Unrelated college quiz prize", year: "2017", details: "General knowledge quiz, no professional relevance" },
  ],
  certifications: [{ name: "AWS Solutions Architect", year: "2021" }],
  research: [{ topic: "Efficient transformers", venue: "Workshop 2023" }],
  publications: [{ title: "Latency-aware inference", venue: "arXiv 2022" }],
  mastersMotivation: {
    whyGermany: "Germany's applied AI curriculum and industry ties align with my goals.",
    whyNow: "I have 4 years of ML experience and need advanced research methods.",
    whyProgram: "The program's ML specialization covers my knowledge gaps in scalable systems.",
  },
  countryQuestionnaire: {
    answers: {
      whyThisCountry: "Germany offers strong AI research and post-study work options.",
      postStudyPlans: "Return to India to lead AI at a product company, applying research methods.",
      financialSupport: "Family savings + education loan (provided separately to visa officer).",
    },
  },
  careerGoalsStructured: {
    shortTerm: { role: "ML Research Engineer", field: "Applied AI" },
    longTerm: { homeCountryPlans: "Return to India to build an AI product team", vision: "Lead AI innovation in India" },
  },
  careerGoals: { returnHomeCountry: "India", returnPlans: "Lead AI product team in India" },
  personalStory: "I grew up in a small town and discovered AI through online courses.",
  englishProficiency: { ielts: 8.0 },
  writingPreferences: { actualEnglishProficiency: "Fluent professional" },
  applicationSpecificFacts: [
    { recommenderContext: "Professor Sharma taught me ML in 2019, observed my thesis on transformers." },
  ],
};

function buildLedger(profile: any): EvidenceLedger {
  return buildEvidenceLedger({
    studentFacts: profile,
    programContextText: "MSc Applied AI, TU Munich. Specialization in scalable ML systems.",
    facultyAlignment: [
      { status: "STUDENT_APPROVED", verifiedProgramFactSource: "https://tum.de/ai", facultyName: "Prof. Schmidt", researchArea: "Efficient ML" } as any,
    ],
    applicationSpecificFacts: profile.applicationSpecificFacts,
  });
}

const fullLedger = buildLedger(shivangProfile);
const fullCount = fullLedger.allEntries.length;
// Full-selection packet: every entry selected, formatted with the SAME
// formatter as the filtered packets, so character comparisons are
// apples-to-apples (same ledger, same section structure).
import { classifyEvidenceEntry as _classify, type EvidencePriority as _EP } from "../src/lib/ai/document-evidence-policy";
const fullSelectionPacket = {
  documentType: "CUSTOM" as DocumentType,
  selectedEvidence: fullLedger.allEntries.map(e => ({
    entry: e,
    semanticCategory: _classify(e),
    priority: "HIGH" as _EP,
  })),
  excludedEvidence: [],
  fullLedger,
  selectionSummary: {
    fullCount, selectedCount: fullCount, excludedCount: 0,
    byPriority: { HIGH: fullCount, MEDIUM: 0, LOW: 0, EXCLUDE: 0 } as Record<_EP, number>,
    byCategory: {},
  },
  packetHash: "full",
  policyVersion: "full",
};
const fullStudentFactsText = formatDocumentEvidencePacketText(fullSelectionPacket as any);

// ============================================================
// 1. VISA_SOP
// ============================================================
check("VISA_SOP: country + motivation + career are HIGH priority", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const cats = packet.selectedEvidence.map(s => s.semanticCategory);
  assert.ok(cats.includes("countryQuestionnaire"), "countryQuestionnaire should be selected");
  assert.ok(cats.includes("mastersMotivation"), "mastersMotivation should be selected");
  assert.ok(cats.includes("careerGoals"), "careerGoals should be selected");
  assert.ok(cats.includes("education"), "education should be selected");
  // All HIGH-priority categories present in selection
  const highCats = new Set(packet.selectedEvidence.filter(s => s.priority === "HIGH").map(s => s.semanticCategory));
  assert.ok(highCats.has("countryQuestionnaire"));
  assert.ok(highCats.has("mastersMotivation"));
  assert.ok(highCats.has("careerGoals"));
  assert.ok(highCats.has("education"));
});

check("VISA_SOP: projects and metrics are selective (LOW / maxItems)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.categories.projects, "LOW");
  assert.equal(policy.categories.skills, "EXCLUDE");
  assert.equal(policy.categories.certifications, "EXCLUDE");
  assert.equal(policy.categories.personalStory, "EXCLUDE");
  // maxItems caps projects at 1
  const projCount = packet.selectedEvidence.filter(s => s.semanticCategory === "projects").length;
  assert.ok(projCount <= (policy.maxItems?.projects ?? Infinity), `projects capped at ${policy.maxItems?.projects}, got ${projCount}`);
  // experience capped at 2
  const expCount = packet.selectedEvidence.filter(s => s.semanticCategory === "experience").length;
  assert.ok(expCount <= (policy.maxItems?.experience ?? Infinity), `experience capped at ${policy.maxItems?.experience}, got ${expCount}`);
  // achievements capped at 1
  const achCount = packet.selectedEvidence.filter(s => s.semanticCategory === "achievements").length;
  assert.ok(achCount <= (policy.maxItems?.achievements ?? Infinity), `achievements capped at ${policy.maxItems?.achievements}, got ${achCount}`);
});

check("VISA_SOP: experience capped at 2 (not every work bullet)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.maxItems?.experience, 2);
  const expSelected = packet.selectedEvidence.filter(s => s.semanticCategory === "experience").length;
  assert.ok(expSelected <= 2, `experience must be <= 2, got ${expSelected}`);
});

check("VISA_SOP: projects capped at 1", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.maxItems?.projects, 1);
  const projSelected = packet.selectedEvidence.filter(s => s.semanticCategory === "projects").length;
  assert.ok(projSelected <= 1, `projects must be <= 1, got ${projSelected}`);
});

check("VISA_SOP: achievements capped at 1", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.maxItems?.achievements, 1);
  const achSelected = packet.selectedEvidence.filter(s => s.semanticCategory === "achievements").length;
  assert.ok(achSelected <= 1, `achievements must be <= 1, got ${achSelected}`);
});

check("VISA_SOP: raw skills not broadly injected (EXCLUDE)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.categories.skills, "EXCLUDE");
  const skillsSelected = packet.selectedEvidence.filter(s => s.semanticCategory === "skills");
  assert.equal(skillsSelected.length, 0, "no skills should be selected for VISA_SOP");
  const skillsExcluded = packet.excludedEvidence.filter(s => s.semanticCategory === "skills");
  assert.ok(skillsExcluded.length > 0, "skills should be in excluded evidence");
});

check("VISA_SOP: certifications excluded by default", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.categories.certifications, "EXCLUDE");
  const certSelected = packet.selectedEvidence.filter(s => s.semanticCategory === "certifications");
  assert.equal(certSelected.length, 0, "no certifications should be selected for VISA_SOP");
});

check("VISA_SOP: personal story excluded by default", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  assert.equal(policy.categories.personalStory, "EXCLUDE");
  const storySelected = packet.selectedEvidence.filter(s => s.semanticCategory === "personalStory");
  assert.equal(storySelected.length, 0, "no personalStory should be selected for VISA_SOP");
});

check("VISA_SOP: unrelated detail reduced (excluded > 0)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  assert.ok(packet.selectionSummary.excludedCount > 0, "VISA_SOP should exclude some evidence");
  // writingPreferences always EXCLUDED
  const wp = packet.excludedEvidence.find(s => s.semanticCategory === "writingPreferences");
  assert.ok(wp, "writingPreferences should be excluded for VISA_SOP");
});

// ============================================================
// 2. SOP — broader context preserved
// ============================================================
check("SOP: broader academic/professional evidence preserved", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "STATEMENT_OF_PURPOSE", fullEvidenceLedger: fullLedger });
  const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
  assert.ok(cats.has("education"));
  assert.ok(cats.has("experience"));
  assert.ok(cats.has("projects"));
  assert.ok(cats.has("fieldMotivation") || cats.has("mastersMotivation"));
  assert.ok(cats.has("careerGoals"));
  assert.ok(cats.has("programEvidence"));
  // SOP should select MORE than VISA_SOP (broader)
  const visaPacket = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  assert.ok(packet.selectionSummary.selectedCount >= visaPacket.selectionSummary.selectedCount,
    `SOP (${packet.selectionSummary.selectedCount}) should be >= VISA_SOP (${visaPacket.selectionSummary.selectedCount})`);
});

check("SOP: education, experience, projects, motivation, career, program-fit all present", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "STATEMENT_OF_PURPOSE", fullEvidenceLedger: fullLedger });
  const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
  for (const required of ["education", "experience", "projects", "mastersMotivation", "careerGoals", "programEvidence"]) {
    assert.ok(cats.has(required as SemanticEvidenceCategory), `SOP must include ${required}`);
  }
});

// ============================================================
// 3. LOR — recommender perspective preserved
// ============================================================
check("LOR: recommender-known evidence only; visa/country EXCLUDED", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "LETTER_OF_RECOMMENDATION", fullEvidenceLedger: fullLedger });
  const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
  // recommenderContext (in applicationSpecificFacts) should be included
  assert.ok(cats.has("applicationData"), "LOR should include application data (recommender context)");
  // visa/country/private motivations EXCLUDED by default
  assert.ok(!cats.has("countryQuestionnaire"), "LOR must NOT include countryQuestionnaire");
  assert.ok(!cats.has("visaEvidence"), "LOR must NOT include visaEvidence");
  assert.ok(!cats.has("mastersMotivation"), "LOR must NOT include mastersMotivation (private motivation)");
  assert.ok(!cats.has("careerGoals"), "LOR must NOT include careerGoals (private motivation)");
  const policy = getDocumentEvidencePolicy("LETTER_OF_RECOMMENDATION");
  assert.equal(policy.categories.countryQuestionnaire, "EXCLUDE");
  assert.equal(policy.categories.mastersMotivation, "EXCLUDE");
  assert.equal(policy.categories.careerGoals, "EXCLUDE");
  assert.equal(policy.categories.visaEvidence, "EXCLUDE");
});

check("LOR: recommenderContext is HIGH priority", () => {
  const policy = getDocumentEvidencePolicy("LETTER_OF_RECOMMENDATION");
  assert.equal(policy.categories.recommenderContext, "HIGH");
  assert.ok(policy.requiredForQuality?.includes("recommenderContext"));
});

// ============================================================
// 4. ESSAY — question-focused
// ============================================================
check("ESSAY: question-focused (documentPrompt/consultantInstruction HIGH)", () => {
  const policy = getDocumentEvidencePolicy("ESSAY");
  assert.equal(policy.categories.documentPrompt, "HIGH");
  assert.equal(policy.categories.consultantInstruction, "HIGH");
  assert.equal(policy.categories.officialRequirements, "HIGH");
  // ESSAY should NOT dump the entire profile — visa/country EXCLUDED
  assert.equal(policy.categories.visaEvidence, "EXCLUDE");
  assert.equal(policy.categories.recommenderContext, "EXCLUDE");
  const packet = buildDocumentEvidencePacket({ documentType: "ESSAY", fullEvidenceLedger: fullLedger });
  const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
  assert.ok(!cats.has("visaEvidence"));
});

// ============================================================
// 5. COVER_LETTER — job-relevant
// ============================================================
check("COVER_LETTER: job-relevant; no masters/visa/country", () => {
  const policy = getDocumentEvidencePolicy("COVER_LETTER");
  assert.equal(policy.categories.experience, "HIGH");
  assert.equal(policy.categories.skills, "HIGH");
  assert.equal(policy.categories.achievements, "HIGH");
  assert.equal(policy.categories.projects, "HIGH");
  assert.equal(policy.categories.mastersMotivation, "EXCLUDE");
  assert.equal(policy.categories.countryQuestionnaire, "EXCLUDE");
  assert.equal(policy.categories.visaEvidence, "EXCLUDE");
  const packet = buildDocumentEvidencePacket({ documentType: "COVER_LETTER", fullEvidenceLedger: fullLedger });
  const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
  assert.ok(cats.has("experience"));
  assert.ok(cats.has("skills"));
  assert.ok(!cats.has("mastersMotivation"));
  assert.ok(!cats.has("countryQuestionnaire"));
});

// ============================================================
// 6. Fact Reviewer — full evidence retained
// ============================================================
check("Fact Reviewer: full ledger retained on packet regardless of filtering", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  // fullLedger reference on the packet is the SAME canonical ledger
  assert.equal(packet.fullLedger.allEntries.length, fullCount);
  assert.equal(packet.fullLedger, fullLedger, "packet.fullLedger must be the same canonical reference");
  // Even though Writer gets filtered text, the full ledger is available
  const filteredText = formatDocumentEvidencePacketText(packet);
  const fullText = fullLedger.allEntries.map(e => `[${e.id}]`).join(" ");
  const filteredIds = packet.selectedEvidence.map(s => s.entry.id);
  // Full ledger has MORE entries than the filtered selection
  assert.ok(fullLedger.allEntries.length >= filteredIds.length, "full ledger must be >= filtered selection");
});

check("Fact Reviewer: filtered ledger view does not mutate canonical ledger", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const filteredView = buildFilteredLedgerView(packet);
  assert.ok(filteredView.allEntries.length <= fullLedger.allEntries.length);
  // Original ledger unchanged
  assert.equal(fullLedger.allEntries.length, fullCount);
  // Filtered view preserves original ledgerHash (canonical world)
  assert.equal(filteredView.ledgerHash, fullLedger.ledgerHash);
});

// ============================================================
// 6b. Finalizer — filtered/repair-relevant evidence only
// ============================================================
check("Finalizer: excluded fact NOT in finalizer ledger view (no repair auth)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  // skills is EXCLUDE for VISA_SOP — find a skills entry ID
  const skillsEntry = fullLedger.allEntries.find(e => e.id === "SF-SKILLS");
  assert.ok(skillsEntry, "fixture should have a SF-SKILLS entry");
  // Finalizer ledger view without repair authorization = filtered only
  const finalizerLedger = buildFinalizerLedgerView(packet, []);
  const hasSkills = finalizerLedger.allEntries.some(e => e.id === "SF-SKILLS");
  assert.equal(hasSkills, false, "excluded skills fact must NOT be in finalizer ledger view");
});

check("Finalizer: excluded fact present when authorized for repair", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const skillsEntry = fullLedger.allEntries.find(e => e.id === "SF-SKILLS");
  assert.ok(skillsEntry);
  // If a repair action explicitly authorizes the skills entry, it should appear
  const finalizerLedger = buildFinalizerLedgerView(packet, ["SF-SKILLS"]);
  const hasSkills = finalizerLedger.allEntries.some(e => e.id === "SF-SKILLS");
  assert.equal(hasSkills, true, "repair-authorized skills fact should be in finalizer ledger view");
});

check("Finalizer: ledger view is <= full ledger + preserves canonical hash", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const finalizerLedger = buildFinalizerLedgerView(packet, []);
  assert.ok(finalizerLedger.allEntries.length <= fullLedger.allEntries.length);
  assert.equal(finalizerLedger.ledgerHash, fullLedger.ledgerHash, "must preserve canonical ledgerHash");
});

check("Finalizer + Fact Reviewer: excluded from finalizer but present in full ledger", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const finalizerLedger = buildFinalizerLedgerView(packet, []);
  // skills excluded from finalizer
  const finalizerHasSkills = finalizerLedger.allEntries.some(e => e.id === "SF-SKILLS");
  assert.equal(finalizerHasSkills, false);
  // but present in full canonical ledger (Fact Reviewer)
  const fullHasSkills = packet.fullLedger.allEntries.some(e => e.id === "SF-SKILLS");
  assert.equal(fullHasSkills, true, "Fact Reviewer full ledger must retain the excluded fact");
});

// ============================================================
// 7. Priority absence — NOT a fatal blocker
// ============================================================
check("Priority absence: empty ledger does not throw and produces empty packet", () => {
  const emptyLedger: EvidenceLedger = {
    studentFacts: [], programFacts: [], facultyFacts: [], applicationSpecificFacts: [],
    allEntries: [], ledgerHash: "empty",
  };
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: emptyLedger });
  assert.equal(packet.selectionSummary.selectedCount, 0);
  assert.equal(packet.selectionSummary.excludedCount, 0);
  assert.equal(packet.selectionSummary.byPriority.HIGH, 0);
  // No throw — priority absence is never fatal
});

check("Priority absence: requiredForQuality missing does not block", () => {
  // Profile with NO country questionnaire, NO masters motivation
  const minimalProfile: any = {
    personalDetails: { fullName: "Minimal Applicant" },
    education: [{ degree: "BSc", institution: "X", year: "2020" }],
  };
  const minimalLedger = buildLedger(minimalProfile);
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: minimalLedger });
  // VISA_SOP requires countryQuestionnaire for quality, but it's absent —
  // the packet still builds, selection is non-empty (education present), no throw.
  assert.ok(packet.selectionSummary.selectedCount > 0);
  const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
  assert.ok(!cats.has("countryQuestionnaire"), "absent category should not appear");
});

// ============================================================
// 8. Document requirements — not accidentally filtered
// ============================================================
check("Document requirements: program/faculty/application/official/prompt always included", () => {
  for (const docType of ["VISA_SOP", "STATEMENT_OF_PURPOSE", "LETTER_OF_RECOMMENDATION", "COVER_LETTER", "ESSAY"] as DocumentType[]) {
    const packet = buildDocumentEvidencePacket({ documentType: docType, fullEvidenceLedger: fullLedger });
    const cats = new Set(packet.selectedEvidence.map(s => s.semanticCategory));
    // Program evidence (PF-CONTEXT) must always pass through
    assert.ok(cats.has("programEvidence"), `${docType} must include programEvidence`);
    // Faculty evidence must pass through (it's a requirement category)
    assert.ok(cats.has("facultyEvidence"), `${docType} must include facultyEvidence`);
    // Application data must pass through
    assert.ok(cats.has("applicationData"), `${docType} must include applicationData`);
  }
});

check("Document requirements: requirement categories bypass student-fact priority", () => {
  // Even LOR (which excludes most student facts) keeps program/faculty/app data
  const packet = buildDocumentEvidencePacket({ documentType: "LETTER_OF_RECOMMENDATION", fullEvidenceLedger: fullLedger });
  const reqEntries = packet.selectedEvidence.filter(s =>
    s.semanticCategory === "programEvidence" ||
    s.semanticCategory === "facultyEvidence" ||
    s.semanticCategory === "applicationData"
  );
  assert.ok(reqEntries.length > 0, "LOR must keep requirement categories");
  // All requirement entries should be HIGH (pass-through)
  for (const s of reqEntries) {
    assert.equal(s.priority, "HIGH", `${s.semanticCategory} should be HIGH pass-through`);
  }
});

// ============================================================
// 9. Shivang Visa SOP — what would reach Writer
// ============================================================
check("Shivang VISA_SOP: HIGH content includes education, motivation, country, career", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const highCats = new Set(packet.selectedEvidence.filter(s => s.priority === "HIGH").map(s => s.semanticCategory));
  assert.ok(highCats.has("education"), "education HIGH");
  assert.ok(highCats.has("mastersMotivation"), "mastersMotivation HIGH");
  assert.ok(highCats.has("countryQuestionnaire"), "countryQuestionnaire HIGH");
  assert.ok(highCats.has("careerGoals"), "careerGoals HIGH");
});

check("Shivang VISA_SOP: Writer does NOT receive every metric/project/skill/achievement", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  // projects LOW + maxItems 1; skills EXCLUDE; certifications EXCLUDE; personalStory EXCLUDE
  assert.equal(policy.categories.projects, "LOW");
  assert.equal(policy.categories.skills, "EXCLUDE");
  assert.equal(policy.categories.certifications, "EXCLUDE");
  assert.equal(policy.categories.personalStory, "EXCLUDE");
  // research/publications EXCLUDED for visa (academic-detail dump, not visa purpose)
  assert.equal(policy.categories.research, "EXCLUDE");
  assert.equal(policy.categories.publications, "EXCLUDE");
  // The filtered text should be SHORTER than the full canonical studentFactsText
  // (same formatter, so the comparison is apples-to-apples).
  const filteredText = formatDocumentEvidencePacketText(packet);
  assert.ok(filteredText.length < fullStudentFactsText.length,
    `filtered (${filteredText.length}) must be shorter than full (${fullStudentFactsText.length})`);
  // VISA_SOP must select fewer entries than the full ledger
  assert.ok(packet.selectionSummary.selectedCount < fullCount,
    `VISA_SOP selected (${packet.selectionSummary.selectedCount}) < full (${fullCount})`);
});

check("Shivang VISA_SOP: experience is selective (maxItems 2, not every bullet)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const policy = getDocumentEvidencePolicy("VISA_SOP");
  const expSelected = packet.selectedEvidence.filter(s => s.semanticCategory === "experience").length;
  const expInLedger = fullLedger.studentFacts.filter(e => e.id.startsWith("SF-EXP-")).length;
  assert.ok(expSelected <= (policy.maxItems?.experience ?? Infinity), `experience capped: ${expSelected} <= ${policy.maxItems?.experience}`);
  assert.ok(expInLedger >= 3, "fixture has 3 experience entries");
  // With maxItems 2 and 3 entries, only 2 should be selected
  assert.ok(expSelected <= 2, `at most 2 experience entries selected, got ${expSelected}`);
});

check("Shivang VISA_SOP: diagnostics render without raw evidence text", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const diag = renderDocumentEvidencePacketDiagnostics(packet);
  assert.ok(diag.includes("Document Evidence Packet"));
  assert.ok(diag.includes("Document Type: VISA_SOP"));
  assert.ok(diag.includes(`Full evidence: ${fullCount}`));
  // Diagnostics show IDs + categories, NOT raw canonical text
  assert.ok(!diag.includes("Shivang Patel"), "diagnostics must not leak raw personal data");
  assert.ok(!diag.includes("IIT Bombay"), "diagnostics must not leak raw education text");
});

// ============================================================
// 10. Context size — measured character reduction (no cost claims)
// ============================================================
check("Context size: measured character reduction (no cost claims)", () => {
  const visaPacket = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const sopPacket = buildDocumentEvidencePacket({ documentType: "STATEMENT_OF_PURPOSE", fullEvidenceLedger: fullLedger });
  const lorPacket = buildDocumentEvidencePacket({ documentType: "LETTER_OF_RECOMMENDATION", fullEvidenceLedger: fullLedger });

  const fullText = fullStudentFactsText;
  const visaText = formatDocumentEvidencePacketText(visaPacket);
  const sopText = formatDocumentEvidencePacketText(sopPacket);
  const lorText = formatDocumentEvidencePacketText(lorPacket);

  console.log(`\n  Full evidence chars: ${fullText.length}`);
  console.log(`  VISA_SOP selected chars: ${visaText.length} (${Math.round(visaText.length / fullText.length * 100)}% of full)`);
  console.log(`  SOP selected chars: ${sopText.length} (${Math.round(sopText.length / fullText.length * 100)}% of full)`);
  console.log(`  LOR selected chars: ${lorText.length} (${Math.round(lorText.length / fullText.length * 100)}% of full)`);
  console.log(`  Full entries: ${fullCount}`);
  console.log(`  VISA_SOP selected: ${visaPacket.selectionSummary.selectedCount}`);
  console.log(`  SOP selected: ${sopPacket.selectionSummary.selectedCount}`);
  console.log(`  LOR selected: ${lorPacket.selectionSummary.selectedCount}`);

  // Each filtered text must be <= full canonical studentFactsText (same formatter)
  assert.ok(visaText.length <= fullText.length, `visa ${visaText.length} <= full ${fullText.length}`);
  assert.ok(sopText.length <= fullText.length, `sop ${sopText.length} <= full ${fullText.length}`);
  assert.ok(lorText.length <= fullText.length, `lor ${lorText.length} <= full ${fullText.length}`);
  // VISA_SOP should be smaller than SOP (narrower policy)
  assert.ok(visaPacket.selectionSummary.selectedCount <= sopPacket.selectionSummary.selectedCount,
    "VISA_SOP should select <= SOP");
  // VISA_SOP must show real reduction vs full
  assert.ok(visaPacket.selectionSummary.selectedCount < fullCount,
    "VISA_SOP must select fewer than full ledger");
});

// ============================================================
// EXTRA: classifier determinism + policy registry coverage
// ============================================================
check("Classifier is deterministic (same entry → same category)", () => {
  const entry: EvidenceEntry = { id: "SF-EDU-0", canonicalText: "x", category: "student", source: "studentFacts.education[0]" };
  assert.equal(classifyEvidenceEntry(entry), "education");
  const entry2: EvidenceEntry = { id: "SF-COUNTRY-WHYTHISCOUNTRY", canonicalText: "x", category: "student", source: "studentFacts.countryQuestionnaire.answers.whyThisCountry" };
  assert.equal(classifyEvidenceEntry(entry2), "countryQuestionnaire");
});

check("Policy registry covers every canonical DocumentType", () => {
  const allTypes: DocumentType[] = [
    "STATEMENT_OF_PURPOSE", "ESSAY", "SUPPLEMENTAL_QUESTION", "MOA",
    "PERSONAL_STATEMENT", "STATEMENT_OF_ACADEMIC_PURPOSE", "LETTER_OF_MOTIVATION",
    "VISA_SOP", "COVER_LETTER", "LETTER_OF_RECOMMENDATION", "CUSTOM",
  ];
  for (const t of allTypes) {
    const p = DOCUMENT_EVIDENCE_POLICIES[t];
    assert.ok(p, `missing policy for ${t}`);
    assert.ok(typeof p.categories === "object");
  }
});

check("Unknown document type falls back to CUSTOM policy", () => {
  const p = getDocumentEvidencePolicy("NONEXISTENT_TYPE");
  assert.ok(p.categories.education === "HIGH", "fallback should be CUSTOM (broad)");
});

check("Packet preserves original evidence IDs (no duplication)", () => {
  const packet = buildDocumentEvidencePacket({ documentType: "VISA_SOP", fullEvidenceLedger: fullLedger });
  const selectedIds = packet.selectedEvidence.map(s => s.entry.id);
  const fullIds = fullLedger.allEntries.map(e => e.id);
  // Every selected ID must exist in the canonical ledger (no invented IDs)
  for (const id of selectedIds) {
    assert.ok(fullIds.includes(id), `selected ID ${id} must exist in canonical ledger`);
  }
  // No duplicate IDs in selection
  const unique = new Set(selectedIds);
  assert.equal(unique.size, selectedIds.length, "no duplicate selected IDs");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
