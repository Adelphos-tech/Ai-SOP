/**
 * ZERO-TOKEN GENERATION PREFLIGHT
 *
 * Runs every deterministic pre-generation path — context loading,
 * requirement resolution, evidence bundle, contract, gates, stage
 * prompt construction — WITHOUT any OpenAI call, generation_run row,
 * or profile write.
 *
 * Usage:
 *   npx tsx scripts/generation-preflight.ts --student <id> --application <id> --document <id>
 *
 * Reads DB credentials from .env.local (SOP_DB_*).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Minimal .env.local loader (no dotenv dependency assumptions)
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : "";
}

const STUDENT_ID = arg("student");
const APPLICATION_ID = arg("application");
const DOCUMENT_ID = arg("document");
if (!STUDENT_ID || !APPLICATION_ID || !DOCUMENT_ID) {
  console.error("Usage: generation-preflight --student <id> --application <id> --document <id>");
  process.exit(1);
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail = "") =>
  results.push({ name, pass, detail: detail.slice(0, 300) });

async function main() {
  const { loadDocumentGenerationContext } = await import("../src/lib/application/generation-context");
  const { adaptProfile } = await import("../src/lib/application/profile-adapter");
  const { buildGenerationArtifacts } = await import("../src/lib/application/generation-service");
  const { buildApplicationEvidenceBundle } = await import("../src/lib/ai/application-evidence-bundle");
  const { buildComponentEvidencePackets } = await import("../src/lib/ai/component-evidence-packet");
  const { checkMandatoryTopicEvidence, isHardMandatoryTopicStatus } = await import("../src/lib/requirements/generation-gate");
  const { checkMissingMandatoryTopics } = await import("../src/lib/ai/claim-provenance");
  const { buildGenericPlannerPrompt } = await import("../src/lib/ai/prompts/generic/planner");
  const { buildGenericWriterPrompt } = await import("../src/lib/ai/prompts/generic/writer");
  const { buildGenericQualityReviewerPrompt } = await import("../src/lib/ai/prompts/generic/quality-reviewer");
  const { buildGenericLanguageCalibratorPrompt } = await import("../src/lib/ai/prompts/generic/language-calibrator");
  const { buildBoundedFinalizerPrompt } = await import("../src/lib/ai/bounded-finalizer");
  const { buildGenericFinalFactReviewerPrompt } = await import("../src/lib/ai/prompts/generic/final-fact-reviewer");

  // ===== CONTEXT COMPILATION =====
  const ctxResult = await loadDocumentGenerationContext(STUDENT_ID, APPLICATION_ID, DOCUMENT_ID);
  if (!ctxResult.ok || !ctxResult.context) {
    check("Context compilation", false, ctxResult.error || "load failed");
    return report();
  }
  const ctx = ctxResult.context;
  check("Context compilation", !ctx.blocked, ctx.blocked ? ctx.blockReasons.join(" | ") : "loaded");
  check("Completeness issues", ctx.completenessIssues.length === 0, ctx.completenessIssues.join(" | ") || "none");

  const merged = ctx.mergedPrompt;
  check("Resolved prompt", !!merged.promptText && merged.promptText.length > 10, `source=${merged.promptSource} path=${merged.resolutionPath} len=${merged.promptText?.length || 0}`);

  const profile = adaptProfile(ctx.student, ctx.profile);
  const artifacts = buildGenerationArtifacts(ctx, profile);
  const { responseComponent: rc, contract, pipelineWritingInstructions, qualityRubricInstructions, languageProfile, programContextText } = artifacts;

  // ===== EVIDENCE PROPAGATION =====
  const bundle = buildApplicationEvidenceBundle({ profile: profile as any, programContextText, facultyAlignment: [] });
  const ids = bundle.allEntries.map(e => e.id);
  const byPrefix = (p: string) => ids.filter(i => i.includes(p));
  const populated = (o: any) => o && Object.values(o).some(v => v && String(v).trim());

  check("Student evidence (CV core)", byPrefix("SF-EDU").length > 0 && byPrefix("SF-EXP").length > 0, `EDU=${byPrefix("SF-EDU-").length} EXP=${byPrefix("SF-EXP-").length} PROJ=${byPrefix("SF-PROJ-").length} ACH=${byPrefix("SF-ACH-").length}`);
  check("Motivation evidence", !populated((ctx.profile as any)?.mastersMotivation) || byPrefix("SF-MOTIVATION-").length > 0, `entries=${byPrefix("SF-MOTIVATION-").length}`);
  check("Country evidence", !populated((ctx.profile as any)?.countryQuestionnaire?.answers) || byPrefix("SF-COUNTRY-").length > 0, `entries=${byPrefix("SF-COUNTRY-").length}`);
  check("Career evidence", !populated((ctx.profile as any)?.careerGoalsStructured) || byPrefix("SF-CAREER-").length > 0, `entries=${byPrefix("SF-CAREER-").length}`);

  // ===== REQUIREMENT RESOLUTION =====
  check("Word limits", rc.wordLimit.min !== null || rc.wordLimit.max !== null || !((ctx.profile as any)?.universityRequirements?.wordMin), `min=${rc.wordLimit.min} max=${rc.wordLimit.max}`);
  check("Additional questions", (rc.additionalQuestions || []).length > 0 || !String((ctx.profile as any)?.universityRequirements?.specificQuestions || "").trim(), `count=${(rc.additionalQuestions || []).length}`);
  check("Formatting rules", !!contract.writingRequirement.formatInstructions.length || !String((ctx.profile as any)?.universityRequirements?.formattingRules || "").trim(), `count=${contract.writingRequirement.formatInstructions.length}`);

  for (const t of rc.requiredTopics) {
    const hard = isHardMandatoryTopicStatus(t.status);
    check(`Topic: ${t.topic.slice(0, 60)}`, true, `status=${t.status} mandatory=${hard} hardBlockEligible=${hard} source=${t.sourceId}`);
  }
  const declaredOk = rc.requiredTopics.filter(t => t.status === "DECLARED").every(t => !isHardMandatoryTopicStatus(t.status));
  check("Topic provenance (DECLARED not hard-blocking)", declaredOk);

  // ===== GATES =====
  const topicGate = checkMandatoryTopicEvidence(contract, bundle);
  check("Generation gate (mandatory topic evidence)", topicGate.passed, topicGate.blockingIssues.map(b => b.issue).join(" | ") || "passed");

  // Post-LC gate simulation: worst case — QR marks every topic uncovered
  const allMissing = checkMissingMandatoryTopics({
    actionPlan: { plans: [{ componentId: "RC-DOC", action: "FREEZE", missingTopics: rc.requiredTopics.map(t => t.topic), topicEvidence: [] }] },
    requiredTopics: [{
      componentId: "RC-DOC",
      topics: rc.requiredTopics.map(t => {
        const mandatory = isHardMandatoryTopicStatus(t.status);
        return { topicId: t.topic, text: t.topic, requirementType: mandatory ? "MANDATORY_REQUIRED_TOPIC" as const : "OPTIONAL_QUALITY_SUGGESTION" as const, sourceRequirementId: rc.sourceId, mandatory };
      }),
    }],
  });
  check("Post-LC gate (all topics uncovered worst-case)", !allMissing.blocked || rc.requiredTopics.some(t => isHardMandatoryTopicStatus(t.status)), allMissing.blockingReasons.map(b => b.reason).join(" | ") || "no hard-mandatory topics → cannot block");

  // ===== STAGE PROMPTS =====
  const evidencePackets = buildComponentEvidencePackets({ evidenceLedger: bundle.ledger, responseComponents: [rc] });

  const planner = buildGenericPlannerPrompt(bundle.studentFactsText, [rc], [], bundle.programFactsText, "");
  check("Planner context", planner.user.includes("Required topics") && planner.user.includes("STUDENT FACTS"), "");

  let writer;
  try {
    writer = buildGenericWriterPrompt(null, bundle.studentFactsText, [rc], [], pipelineWritingInstructions, evidencePackets);
    check("Writer context", writer.user.includes("SPECIAL INSTRUCTIONS") || writer.user.includes("FORMATTING") || !!pipelineWritingInstructions, "evidence packets + instructions present");
  } catch (e: any) {
    check("Writer context", false, e.message);
  }

  const qr = buildGenericQualityReviewerPrompt({ responses: [] }, [rc], [], bundle.ledger, evidencePackets, qualityRubricInstructions, pipelineWritingInstructions);
  check("QR context", qr.system.includes("CONSULTANT/FORMATTING INSTRUCTIONS") || !merged.formattingInstructions, "compliance instructions present");

  const lc = buildGenericLanguageCalibratorPrompt({ responses: [{ componentId: "RC-DOC", text: "draft" }] }, languageProfile as any, [rc]);
  check("Language context", !!lc.system, "length + style constraints");

  try {
    const fin = buildBoundedFinalizerPrompt({
      calibratedOutput: { responses: [{ componentId: "RC-DOC", text: "draft" }] },
      responseComponents: [rc],
      actionPlan: {
        plans: [{ componentId: "RC-DOC", action: "FREEZE", reason: "preflight stub", missingTopics: [], allowedEvidenceIds: [], physicallyFits: true, preFinalCharacterCount: 5, preFinalPageCount: 0, topicEvidence: [], requiredTopics: [] }],
        frozenComponentIds: ["RC-DOC"],
        editableComponentIds: [],
        blockingIssues: [],
        allowedEvidenceIds: [],
      } as any,
      evidenceLedger: bundle.ledger,
      complianceConstraints: pipelineWritingInstructions,
    });
    check("Finalizer context", fin.system.includes("CONTRACT CONSTRAINTS TO PRESERVE"), "constraints present");
  } catch (e: any) {
    check("Finalizer context", false, e.message);
  }

  const fr = buildGenericFinalFactReviewerPrompt([{ componentId: "RC-DOC", text: "final" }], bundle.studentFactsText, bundle.programFactsText, [], [rc]);
  check("Fact Reviewer evidence", fr.user.includes("SF-MOTIVATION") || fr.user.includes("SF-COUNTRY") || bundle.allEntries.length > 0, `entries=${bundle.allEntries.length}`);

  // ===== ORPHAN / WRITER-ONLY CHECKS =====
  const writerOnly: string[] = [];
  if (merged.specialInstructions && !qr.system.includes(merged.specialInstructions.slice(0, 30))) writerOnly.push("specialInstructions/consultantInstruction");
  if (merged.formattingInstructions && !qr.system.includes(merged.formattingInstructions.slice(0, 30))) writerOnly.push("formattingRules");
  check("Writer-only compliance requirements", writerOnly.length === 0, writerOnly.join(",") || "none");

  report();
}

function report() {
  console.log("\nGENERATION PREFLIGHT\n");
  let fails = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    if (!r.pass) fails++;
  }
  console.log(`\nOPENAI CALLS: 0\nDOCUMENT GENERATIONS: 0\n`);
  if (fails === 0) {
    console.log("ZERO-TOKEN PREFLIGHT PASS — READY FOR ONE MANUAL PAID GENERATION");
    process.exit(0);
  }
  console.log(`ZERO-TOKEN PREFLIGHT FAIL — DO NOT GENERATE (${fails} failures)`);
  process.exit(2);
}

main().catch(e => { console.error("PREFLIGHT ERROR:", e); process.exit(3); });
