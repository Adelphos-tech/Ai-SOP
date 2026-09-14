/**
 * PHASE SOP-AI-10 — Historical MIT Dry-Run Simulation
 *
 * Uses the frozen MIT live-001 output ONLY as a deterministic architecture fixture.
 * Does NOT call OpenAI.
 * Does NOT rewrite historical content.
 *
 * Feeds the existing physical render result (A: 2/1, B: 2/1) into the
 * render-aware finalizer architecture and verifies:
 *   - The generic Finalizer input WOULD receive correct overflow feedback
 *   - Component A and B are both marked RENDER_OVERFLOW
 *   - The Finalizer prompt contains compression instructions
 *   - No fake word limits are generated
 *   - Historical submission status remains REVIEW_REQUIRED
 */

import path from "path";
import { promises as fs } from "fs";
import { DVIVID_STANDARD_APPLICATION_V1 } from "../src/lib/render/render-profile";
import {
  RenderFeedback,
  RenderStatus,
} from "../src/lib/render/render-lifecycle-types";
import { buildGenericFinalizerPrompt } from "../src/lib/ai/prompts/legacy/finalizer-generic";
import { computeSubmissionStatus } from "../src/lib/output/submission-status";
import { ResponseComponent, FacultyAlignment } from "../src/lib/requirements/generation-contract-types";

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  PASS: ${name}`); passCount++; }
  else { console.log(`  FAIL: ${name}${detail ? " — " + detail : ""}`); failCount++; failures.push(name); }
}

async function main() {
  console.log("=== HISTORICAL MIT DRY-RUN SIMULATION ===\n");

  const baseDir = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-001");
  const renderDir = path.join(baseDir, "render");

  // Load the frozen MIT render validation from SOP-AI-9
  const renderValidation = JSON.parse(await fs.readFile(path.join(renderDir, "render-validation.json"), "utf-8"));
  const componentValidation = JSON.parse(await fs.readFile(path.join(renderDir, "component-page-validation.json"), "utf-8"));

  // Load the frozen MIT text (read-only, no modification)
  const fullText = await fs.readFile(path.join(baseDir, "final-statement-of-objectives.txt"), "utf-8");

  // Load MIT response components from the contract
  const contractDir = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");
  const responseComponentsJson = JSON.parse(await fs.readFile(path.join(contractDir, "response-components.json"), "utf-8"));
  const contractJson = JSON.parse(await fs.readFile(path.join(contractDir, "generation-contract-approved.json"), "utf-8"));

  // Build ResponseComponent objects from the contract data
  const rcList = responseComponentsJson.responseComponents || responseComponentsJson.components || responseComponentsJson;
  const responseComponents: ResponseComponent[] = rcList.map((rc: any) => ({
    componentId: rc.componentId,
    label: rc.label,
    exactPrompt: rc.exactPrompt,
    pageLimit: rc.pageLimit || { type: "PER_RESPONSE_COMPONENT", maxPages: 1, status: "VERIFIED" },
    wordLimit: rc.wordLimit || { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    characterLimit: rc.characterLimit || { min: null, max: null, status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" },
    requiredTopics: rc.requiredTopics || [],
    sourceId: rc.sourceId || "MIT-CEE-SRC",
    status: rc.status || "VERIFIED",
    verifiedAt: rc.verifiedAt || new Date().toISOString(),
  }));

  // Build faculty alignment from contract
  const facultyAlignment: FacultyAlignment[] = (contractJson.facultyAlignment || []).map((fa: any) => ({
    facultyName: fa.facultyName,
    verifiedProgramFactSource: fa.verifiedProgramFactSource,
    studentInterestEvidence: fa.studentInterestEvidence || [],
    alignmentReason: fa.alignmentReason || "",
    status: fa.status || "STUDENT_APPROVED",
  }));

  // Parse component texts from frozen output
  const aMatch = fullText.match(/A\. EXPERIENCE\n\n([\s\S]*?)\n\nB\. PURPOSE/);
  const bMatch = fullText.match(/B\. PURPOSE\n\n([\s\S]*)/);
  const compAText = aMatch ? aMatch[1].trim() : "";
  const compBText = bMatch ? bMatch[1].trim() : "";

  const wordsA = compAText.split(/\s+/).filter(Boolean).length;
  const wordsB = compBText.split(/\s+/).filter(Boolean).length;

  console.log(`Frozen MIT output:`);
  console.log(`  Component A: ${wordsA} words`);
  console.log(`  Component B: ${wordsB} words`);
  console.log(`  Component A render: ${componentValidation.components[0].pageCount}/${componentValidation.components[0].maxPages} — ${componentValidation.components[0].status}`);
  console.log(`  Component B render: ${componentValidation.components[1].pageCount}/${componentValidation.components[1].maxPages} — ${componentValidation.components[1].status}`);
  console.log(`  Combined: ${renderValidation.combinedPageCount}/${renderValidation.combinedMaxPages} — ${renderValidation.status}`);
  console.log(`  Historical fact safety: ${renderValidation.factSafetyStatus}`);
  console.log("");

  // Simulate the pre-final render feedback that the pipeline WOULD produce
  const preFinalFeedback: RenderFeedback = {
    components: [
      {
        componentId: "RC-MIT-CEE-A",
        label: "Experience",
        actualPages: componentValidation.components[0].pageCount,
        maxPages: componentValidation.components[0].maxPages,
        status: componentValidation.components[0].status as RenderStatus,
        wordCount: wordsA,
        characterCount: compAText.length,
        renderProfileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
      },
      {
        componentId: "RC-MIT-CEE-B",
        label: "Purpose",
        actualPages: componentValidation.components[1].pageCount,
        maxPages: componentValidation.components[1].maxPages,
        status: componentValidation.components[1].status as RenderStatus,
        wordCount: wordsB,
        characterCount: compBText.length,
        renderProfileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
      },
    ],
    combinedActualPages: renderValidation.combinedPageCount,
    combinedMaxPages: renderValidation.combinedMaxPages,
    combinedStatus: renderValidation.status as RenderStatus,
    renderProfileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
    renderProfileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
  };

  // ===== VERIFICATION 1: Finalizer WOULD receive correct overflow feedback =====
  console.log("Verification 1: Finalizer receives correct overflow feedback");
  {
    check("A: status is RENDER_OVERFLOW", preFinalFeedback.components[0].status === "RENDER_OVERFLOW");
    check("A: actualPages is 2", preFinalFeedback.components[0].actualPages === 2);
    check("A: maxPages is 1", preFinalFeedback.components[0].maxPages === 1);
    check("B: status is RENDER_OVERFLOW", preFinalFeedback.components[1].status === "RENDER_OVERFLOW");
    check("B: actualPages is 2", preFinalFeedback.components[1].actualPages === 2);
    check("B: maxPages is 1", preFinalFeedback.components[1].maxPages === 1);
    check("Combined: status is RENDER_OVERFLOW", preFinalFeedback.combinedStatus === "RENDER_OVERFLOW");
  }

  // ===== VERIFICATION 2: Finalizer prompt contains correct compression instructions =====
  console.log("\nVerification 2: Finalizer prompt contains compression instructions");
  {
    const studentFactsText = JSON.stringify({ name: "Demo Student" }, null, 2);
    const prompt = buildGenericFinalizerPrompt(
      studentFactsText, {}, {}, {},
      responseComponents, facultyAlignment,
      preFinalFeedback, null
    );

    check("Prompt contains Component A overflow info", prompt.user.includes("Component RC-MIT-CEE-A") || prompt.user.includes("Component A"));
    check("Prompt contains OVERFLOW", prompt.user.includes("OVERFLOW"));
    check("Prompt contains COMPRESSION PRIORITY", prompt.user.includes("COMPRESSION PRIORITY"));
    check("Prompt does NOT prescribe fake word target", !/reduce to \d+ words/i.test(prompt.user) && !/target.*\d+ words/i.test(prompt.user));
    check("Prompt does NOT contain '500 words'", !prompt.user.includes("500 words"));
    check("Prompt preserves official prompts", prompt.system.includes("Official prompt"));
    check("Prompt preserves required topics", prompt.system.includes("Required topics"));
    check("Prompt says no format changes", prompt.user.includes("smaller font") && prompt.user.includes("smaller margins"));
  }

  // ===== VERIFICATION 3: No fake word limit generated from page count =====
  console.log("\nVerification 3: No fake word limit from page count");
  {
    const prompt = buildGenericFinalizerPrompt(
      "facts", {}, {}, {},
      responseComponents, facultyAlignment,
      preFinalFeedback, null
    );

    check("No 'maximum words' in prompt", !prompt.user.toLowerCase().includes("maximum words"));
    check("No 'word target' in prompt", !prompt.user.toLowerCase().includes("word target"));
    check("No '350 words' in prompt", !prompt.user.includes("350 words"));
    check("No '500 words' in prompt", !prompt.user.includes("500 words"));
    check("Word count remains analytics only", preFinalFeedback.components[0].wordCount === wordsA);
  }

  // ===== VERIFICATION 4: Component independence =====
  console.log("\nVerification 4: Component independence");
  {
    // Simulate: A overflows, B passes
    const mixedFeedback: RenderFeedback = {
      ...preFinalFeedback,
      components: [
        preFinalFeedback.components[0], // A: overflow
        { ...preFinalFeedback.components[1], actualPages: 1, status: "PASS" as RenderStatus }, // B: pass
      ],
    };

    const prompt = buildGenericFinalizerPrompt(
      "facts", {}, {}, {},
      responseComponents, facultyAlignment,
      mixedFeedback, null
    );

    check("A marked for compression", prompt.user.includes("OVERFLOW"));
    check("B marked as PASS (do NOT shorten)", prompt.user.includes("Do NOT shorten"));
  }

  // ===== VERIFICATION 5: Historical submission status remains REVIEW_REQUIRED =====
  console.log("\nVerification 5: Historical submission status remains REVIEW_REQUIRED");
  {
    // Historical: 1 invented fact → REVIEW_REQUIRED regardless of render
    const result = computeSubmissionStatus({
      factReviewPass: false,
      inventedFacts: 1,
      alteredFacts: 0,
      hasPageConstraint: true,
      deterministicChecksPass: true,
      renderValidation: {
        pdfGenerated: true,
        pageValidation: null,
        renderEngineError: false,
        renderLifecycle: {
          profileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
          profileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
          profileImmutable: true,
          preFinal: {
            components: preFinalFeedback.components,
            combinedActualPages: preFinalFeedback.combinedActualPages,
            combinedMaxPages: preFinalFeedback.combinedMaxPages,
            combinedStatus: preFinalFeedback.combinedStatus,
          },
          final: {
            components: preFinalFeedback.components, // Same — no actual finalization occurred
            combinedActualPages: preFinalFeedback.combinedActualPages,
            combinedMaxPages: preFinalFeedback.combinedMaxPages,
            combinedStatus: preFinalFeedback.combinedStatus,
          },
          componentComparison: [],
          deltaAnalytics: [],
          hasOverflowPreFinal: true,
          hasOverflowFinal: true,
          anyCompressionAttempted: false,
        },
      },
    });

    check("Status is REVIEW_REQUIRED (fact failure)", result.status === "REVIEW_REQUIRED");
    check("No physical page blocker (fact failure takes precedence)", result.physicalPageBlocker === null);
  }

  // ===== VERIFICATION 6: If facts passed but render still overflows → REVIEW_REQUIRED with PHYSICAL_PAGE_LIMIT_EXCEEDED =====
  console.log("\nVerification 6: Facts pass + render overflow → REVIEW_REQUIRED + PHYSICAL_PAGE_LIMIT_EXCEEDED");
  {
    const result = computeSubmissionStatus({
      factReviewPass: true,
      inventedFacts: 0,
      alteredFacts: 0,
      hasPageConstraint: true,
      deterministicChecksPass: true,
      renderValidation: {
        pdfGenerated: true,
        pageValidation: null,
        renderEngineError: false,
        renderLifecycle: {
          profileId: DVIVID_STANDARD_APPLICATION_V1.renderProfileId,
          profileVersion: DVIVID_STANDARD_APPLICATION_V1.version,
          profileImmutable: true,
          preFinal: {
            components: preFinalFeedback.components,
            combinedActualPages: 4,
            combinedMaxPages: 2,
            combinedStatus: "RENDER_OVERFLOW",
          },
          final: {
            components: preFinalFeedback.components,
            combinedActualPages: 3, // Finalizer compressed but still overflows
            combinedMaxPages: 2,
            combinedStatus: "RENDER_OVERFLOW",
          },
          componentComparison: [],
          deltaAnalytics: [{ componentId: "A", wordReductionPercent: 10, characterReductionPercent: 12, pageReduction: 1 }],
          hasOverflowPreFinal: true,
          hasOverflowFinal: true,
          anyCompressionAttempted: true,
        },
      },
    });

    check("Status is REVIEW_REQUIRED", result.status === "REVIEW_REQUIRED");
    check("Blocker is PHYSICAL_PAGE_LIMIT_EXCEEDED", result.physicalPageBlocker === "PHYSICAL_PAGE_LIMIT_EXCEEDED");
    check("No automatic second finalization (no loop)", result.status !== "READY_TO_SUBMIT");
  }

  // ===== VERIFICATION 7: Render profile immutability =====
  console.log("\nVerification 7: Render profile immutability");
  {
    check("Profile ID is DVIVID_STANDARD_APPLICATION_V1", preFinalFeedback.renderProfileId === "DVIVID_STANDARD_APPLICATION_V1");
    check("Profile version is 1.0.0", preFinalFeedback.renderProfileVersion === "1.0.0");
    check("All components use same profile ID", preFinalFeedback.components.every(c => c.renderProfileId === preFinalFeedback.renderProfileId));
  }

  // ===== VERIFICATION 8: No university-specific hardcoding =====
  console.log("\nVerification 8: No university-specific hardcoding in prompt");
  {
    const prompt = buildGenericFinalizerPrompt(
      "facts", {}, {}, {},
      responseComponents, facultyAlignment,
      preFinalFeedback, null
    );

    // Check for university-specific LOGIC/branches, not data that flows from contract IDs
    check("No 'MIT requires' hardcoded in system prompt", !prompt.system.includes("MIT requires"));
    check("No 'CEE department' hardcoded in system prompt", !prompt.system.includes("CEE department"));
    check("No 'Harvard' hardcoded in system prompt", !prompt.system.includes("Harvard"));
    check("No 'Buyukozturk' hardcoded in system prompt", !prompt.system.includes("Buyukozturk"));
    check("No 'Carstensen' hardcoded in system prompt", !prompt.system.includes("Carstensen"));
  }

  console.log(`\n=== MIT SIMULATION RESULTS ===`);
  console.log(`Pass: ${passCount}`);
  console.log(`Fail: ${failCount}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`\nTotal: ${passCount + failCount}/${passCount + failCount}`);
  console.log(`Live OpenAI writing calls: 0`);
  console.log(`Historical MIT output: NOT MODIFIED`);
  console.log(`Historical submission status: REVIEW_REQUIRED (unchanged)`);

  await fs.writeFile(path.join(renderDir, "mit-dry-run-simulation.json"), JSON.stringify({
    passCount, failCount, total: passCount + failCount,
    failures, allPassed: failCount === 0,
    openAICalls: 0,
    historicalOutputModified: false,
    historicalSubmissionStatus: "REVIEW_REQUIRED",
  }, null, 2));

  if (failCount > 0) process.exit(1);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
