// ============================================================
// COMPACT OUTPUT CONTRACT TESTS — deterministic, zero OpenAI calls
// ============================================================
// Verifies: compact QR/FR/LC contracts validate, produce identical
// downstream results, and preserve all safety semantics.
// ============================================================

import {
  validateQualityReviewOutput,
  validateFactReviewOutput,
  deriveFactReviewTotals,
} from "../src/lib/ai/model-output-types";
import { planComponentActions } from "../src/lib/ai/component-action-planner";
import { buildCalibratedClaims } from "../src/lib/ai/pipeline/run-application-pipeline";
import { resolveVersionContent, createSingleFlightSubmitter } from "../src/lib/application/generate-client";
import { computeApprovalWarnings } from "../src/lib/application/application-repository";
import { mergePersonalData } from "../src/lib/application/cv-merge";
import { calculateIntakeCompletion, getProfileReadiness } from "../src/lib/application/intake-completion";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ---------- synthetic fixtures (no applicant content) ----------

const RC = [{
  componentId: "P1", label: "Main essay", exactPrompt: "Why this program?",
  requiredTopics: [{ topic: "motivation for program", mustBeStudentSpecific: true }],
  wordLimit: { min: null, max: 700 }, characterLimit: { min: null, max: null },
  pageLimit: { maxPages: null },
}];

const LEDGER = { allEntries: [{ id: "E1", canonicalText: "ev", category: "experience" }] };

function fullQR(): any {
  return {
    componentScores: [{
      componentId: "P1", score: 8, feedback: "Strong motivation paragraph.",
      topicCoverage: [{ topic: "motivation for program", covered: true, candidateEvidence: [] }],
      factualRiskClaims: [
        { claimId: "C1", claim: "built a parser", claimType: "PROJECT", status: "SUPPORTED", supportingEvidenceIds: ["E1"], reason: "-", unsupportedMotivation: false, novelSpecificity: false, contextShift: false },
        { claimId: "C2", claim: "weekly lab sessions", claimType: "PROJECT", status: "SEMANTIC_EXPANSION", supportingEvidenceIds: [], reason: "frequency not in evidence", unsupportedMotivation: false, novelSpecificity: true, contextShift: false },
      ],
      wordCompliance: "PASS", characterCompliance: "N/A", pageCompliance: "N/A",
    }],
    overall_score: 8, overall_feedback: "Good draft.",
    requirementCompliance: {
      documentStructure: "PASS", responseComponentCount: "PASS", componentPromptCoverage: "PASS",
      requiredTopics: "PASS", facultyRequirement: "N/A", pageLimit: "RENDER_VALIDATION_REQUIRED",
      wordLimit: "PASS", characterLimit: "N/A",
    },
    majorIssues: ["minor repetition"], recommendedEdits: ["tighten P2"],
  };
}

/** Map a full-shape QR output to the compact contract. */
function compactQR(qr: any): any {
  const c = JSON.parse(JSON.stringify(qr));
  for (const cs of c.componentScores) {
    cs.verifiedClaimIds = (cs.factualRiskClaims || []).filter((x: any) => x.status === "SUPPORTED").map((x: any) => x.claimId);
    cs.factualRiskClaims = (cs.factualRiskClaims || []).filter((x: any) => x.status !== "SUPPORTED");
    for (const t of cs.topicCoverage || []) for (const ce of t.candidateEvidence || []) { delete ce.reason; delete ce.requiredContext; }
    delete cs.feedback;
  }
  delete c.overall_feedback; delete c.majorIssues; delete c.recommendedEdits;
  return c;
}

function planArgs(qr: any) {
  return {
    responseComponents: RC as any,
    renderFeedback: null,
    qualityReview: qr,
    evidenceLedger: LEDGER as any,
    calibratedResponses: [{ componentId: "P1", text: "calibrated text" }],
  };
}

// ---------- tests ----------

async function main() {
  console.log("Compact contract tests");

  // 1. Compact QR validates
  {
    const v = validateQualityReviewOutput(compactQR(fullQR()));
    check("QR1 compact output validates", v.valid, v.errors.join("; "));
  }

  // 2. Legacy full QR still validates (backward compat)
  {
    const v = validateQualityReviewOutput(fullQR());
    check("QR2 legacy full output still validates", v.valid, v.errors.join("; "));
  }

  // 3. Action-planner equivalence: full vs compact produce identical plan
  {
    const planFull = planComponentActions(planArgs(fullQR()));
    const planCompact = planComponentActions(planArgs(compactQR(fullQR())));
    check("QR3 action plan equivalent",
      JSON.stringify(planFull.plans.map(p => ({ c: p.componentId, a: p.action }))) ===
      JSON.stringify(planCompact.plans.map(p => ({ c: p.componentId, a: p.action }))),
      JSON.stringify(planFull.plans.map(p => p.action)));
    // semantic-expansion claim must reach the finalizer directive identically
    const fcFull = planFull.plans[0].factualCleanup?.claims;
    const fcCompact = planCompact.plans[0].factualCleanup?.claims;
    check("QR4 factualCleanup identical", JSON.stringify(fcFull) === JSON.stringify(fcCompact));
    check("QR5 SUPPORTED claim still provenance-listed",
      compactQR(fullQR()).componentScores[0].verifiedClaimIds.includes("C1"));
  }

  // 4. Missing-topic repair path works in compact form
  {
    const qr = compactQR(fullQR());
    qr.componentScores[0].topicCoverage = [{
      topic: "motivation for program", covered: false,
      candidateEvidence: [{ evidenceId: "E1", suitability: "SUITABLE", supportedContext: "project work" }],
    }];
    const v = validateQualityReviewOutput(qr);
    check("QR6 missing-topic compact validates", v.valid, v.errors.join("; "));
    const plan = planComponentActions({
      ...planArgs(qr),
      evidenceLedger: { allEntries: [{ id: "E1", canonicalText: "ev", category: "experience" }] } as any,
    });
    check("QR7 repair action preserved", ["TARGETED_COMPLIANCE_REPAIR", "COMPRESS_AND_REPAIR"].includes(plan.plans[0].action), plan.plans[0].action);
  }

  // 5. FR compact validates + totals derived without model totals
  {
    const frCompact = {
      components: [{
        componentId: "P1", pass: false,
        claims: [
          { claim: "used TensorFlow daily", classification: "INVENTED_FACT", supportingFactIds: [], severity: "BLOCKING" },
          { claim: "worked at Petpooja", classification: "SUPPORTED_STUDENT_FACT", supportingFactIds: ["F1"], severity: "INFO" },
          { claim: "improved metrics", classification: "INTERPRETIVE_ELABORATION", supportingFactIds: ["F2"], severity: "WARNING" },
        ],
      }],
      overallPass: false, blockingReason: "invented tool",
    };
    const v = validateFactReviewOutput(frCompact);
    check("FR1 compact output validates", v.valid, v.errors.join("; "));
    const d = deriveFactReviewTotals(frCompact);
    check("FR2 derived totals correct", d.totalInventedFacts === 1 && d.totalInterpretiveElaborations === 1 && d.overallPass === false);
  }

  // 6. FR legacy (with counts/sources/totals) still validates
  {
    const frLegacy = {
      components: [{
        componentId: "P1", pass: true,
        claims: [{ claim: "x", classification: "SUPPORTED_STUDENT_FACT", supportingFactIds: ["F1"], supportingSourceIds: ["S1"], severity: "INFO" }],
        inventedCount: 0, alteredCount: 0, elaborationCount: 0, ambiguousCount: 0,
      }],
      totalInventedFacts: 0, totalAlteredFacts: 0, totalInterpretiveElaborations: 0, totalAmbiguousClaims: 0,
      overallPass: true, blockingReason: null,
    };
    check("FR3 legacy full output still validates", validateFactReviewOutput(frLegacy).valid);
  }

  // 7. Altered + blocking ambiguous detection preserved
  {
    const fr = {
      components: [{ componentId: "P1", pass: false, claims: [
        { claim: "a", classification: "ALTERED_FACT", supportingFactIds: [], severity: "BLOCKING" },
        { claim: "b", classification: "AMBIGUOUS", supportingFactIds: [], severity: "BLOCKING" },
      ] }],
      overallPass: false, blockingReason: null,
    };
    const d = deriveFactReviewTotals(fr);
    check("FR4 altered + blocking ambiguous → fail", d.totalAlteredFacts === 1 && d.hasBlockingAmbiguous && !d.overallPass);
  }

  // 8. LC claimMap compact fallback
  {
    const writerClaims = [
      { claimId: "C1", componentId: "P1", text: "original one", evidenceIds: ["E1"] },
      { claimId: "C2", componentId: "P1", text: "original two", evidenceIds: ["E2"] },
      { claimId: "C3", componentId: "P1", text: "original three", evidenceIds: [] },
    ];
    const cal = { responses: [{ componentId: "P1", text: "cal", claimMap: [
      { claimId: "C1", rewrittenText: "rewritten one" },   // rewritten
      { claimId: "C2" },                                    // verbatim → omit
      { claimId: "C3", rewrittenText: null },               // null → dropped (validation catches)
    ] }] };
    const claims = buildCalibratedClaims(cal, writerClaims);
    const c1 = claims.find(c => c.claimId === "C1");
    const c2 = claims.find(c => c.claimId === "C2");
    check("LC1 rewritten claim used", c1?.rewrittenText === "rewritten one");
    check("LC2 omitted → writer text fallback", c2?.rewrittenText === "original two");
    check("LC3 null → claim dropped for validation", !claims.find(c => c.claimId === "C3"));
  }

  // 9. Token-size reduction on synthetic QR (offline estimate)
  {
    const full = JSON.stringify(fullQR()).length;
    const comp = JSON.stringify(compactQR(fullQR())).length;
    check("SIZE1 compact QR smaller", comp < full * 0.75, `${full}→${comp}`);
  }

  // ---------- Version View / Edit-from-here actions ----------
  console.log("Version actions — always resolve, no status rules");
  {
    // A/B: any version with content resolves — regardless of status
    for (const status of ["APPROVED", "DRAFT", "CURRENT", "HISTORICAL", "FAILED_GEN", "COMPLETED_GEN"]) {
      const r = resolveVersionContent({ content: `content for ${status}` });
      check(`VER-${status} resolves`, r.ok && r.content === `content for ${status}`);
    }
    // J: missing/empty content → visible error, never silent no-op
    check("VER-null → visible error", !resolveVersionContent(null).ok);
    check("VER-no-content → visible error", !resolveVersionContent({}).ok);
    check("VER-empty → visible error", !resolveVersionContent({ content: "" }).ok);
    const bad = resolveVersionContent(undefined);
    check("VER-error message present", !bad.ok && bad.error.includes("Could not load"));
  }

  // ---------- Approval override — warnings never block ----------
  console.log("Approval override — warnings only, consultant authority");
  {
    const words = (n: number) => Array(n).fill("word").join(" ");
    // A: below minimum → warning, not block
    const below = computeApprovalWarnings({ wordMin: 750 }, words(707));
    check("APP-A below min → warning only", below.length === 1 && below[0].code === "WORD_COUNT_BELOW_MINIMUM" && below[0].message.includes("43"));
    // C: above maximum → warning only
    const above = computeApprovalWarnings({ wordMax: 1000 }, words(1100));
    check("APP-C above max → warning only", above.length === 1 && above[0].code === "WORD_COUNT_ABOVE_MAXIMUM");
    // D: valid count → no warnings
    check("APP-D valid → no warnings", computeApprovalWarnings({ wordMin: 500, wordMax: 1000 }, words(700)).length === 0);
    // no limits → no warnings
    check("APP no limits → no warnings", computeApprovalWarnings({}, words(5)).length === 0);
    // E: single-flight approve → 1 request
    let approveCalls = 0;
    const submit = createSingleFlightSubmitter(async () => { approveCalls++; await new Promise(r => setTimeout(r, 10)); return { ok: true, status: 200, data: {} }; });
    await Promise.all([submit(), submit(), submit()]);
    check("APP-E triple-click → 1 request", approveCalls === 1);
    await submit();
    check("APP second explicit click → new request", approveCalls === 2);
  }

  // ---------- Readiness desync — canonical engine + CV merge ----------
  console.log("Readiness — canonical engine + CV merge");
  {
    // A: incomplete Student Details → all consumers report missing + field names
    const incomplete = { personalData: { firstName: "T", lastName: "J", nationality: "", currentCountry: "India" }, education: [{ id: "e1" }] };
    const comp = calculateIntakeCompletion(incomplete);
    const sd = comp.find(s => s.slug === "student-details")!;
    check("RDY-A missing nationality flagged", sd.status === "missing" && sd.missingFields.includes("nationality"));
    check("RDY-A readiness canGenerate=false", getProfileReadiness(incomplete).canGenerate === false);

    // B: fill nationality → complete
    const filled = { ...incomplete, personalData: { ...incomplete.personalData, nationality: "Indian" } };
    check("RDY-B filled → complete", getProfileReadiness(filled).canGenerate === false === false ||
      calculateIntakeCompletion(filled).find(s => s.slug === "student-details")!.status === "complete");

    // C: CV merge imports nationality (the bug — was unconditionally dropped)
    const merged = mergePersonalData(
      { firstName: "Tilak", nationality: "" },
      { nationality: "Indian", dateOfBirth: "2000-01-01" },
      false,
    );
    check("RDY-C merge fills empty nationality from CV", merged.nationality === "Indian");
    check("RDY-C merge fills dateOfBirth", merged.dateOfBirth === "2000-01-01");
    // existing value wins in merge mode
    const merged2 = mergePersonalData({ nationality: "German" }, { nationality: "Indian" }, false);
    check("RDY-C existing wins in merge mode", merged2.nationality === "German");
    // overwrite mode prefers parsed
    const merged3 = mergePersonalData({ nationality: "German" }, { nationality: "Indian" }, true);
    check("RDY-C overwrite prefers parsed", merged3.nationality === "Indian");
    // extra keys preserved
    const merged4 = mergePersonalData({ nationality: "X", customField: "keep" }, {}, false);
    check("RDY-C extra keys preserved", merged4.customField === "keep");

    // D: work experience = explicit no-experience → complete
    const noExp = { ...filled, noWorkExperience: true };
    check("RDY-D noWorkExperience → section complete",
      calculateIntakeCompletion(noExp).find(s => s.slug === "work-experience")!.status === "complete");

    // E: optional sections don't affect required readiness
    const optOnly = { ...filled };
    const r = getProfileReadiness(optOnly);
    check("RDY-E optional empty ≠ required missing",
      r.sections.filter(s => s.optional).every(s => s.status !== "missing"));
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error("FATAL", e); process.exit(1); });
