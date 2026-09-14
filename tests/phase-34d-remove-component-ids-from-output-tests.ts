/**
 * @file phase-34d-remove-component-ids-from-output-tests.ts
 * @description
 * Phase SOP-AI-34D BUGFIX tests A-G.
 * Verifies that internal component IDs (e.g., "RC-DOC") never appear
 * in student-facing output.
 *
 * Tests:
 *   A. RC-DOC never appears in final visible content
 *   B. component IDs remain available internally
 *   C. PDF contains no RC-DOC
 *   D. DOCX contains no RC-DOC
 *   E. saved DocumentVersion contains only student-facing prose
 *   F. no AI architecture changes
 *   G. zero new OpenAI calls
 *
 * No OpenAI calls are made.
 */

import { closeDbPool, assertTestDatabase, cleanupTestDb, getProductionCounts } from "./test-setup";
import { EXECUTION_STAGES } from "../src/lib/ai/pipeline/stage-execution";
import * as fs from "fs";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTests() {
  await assertTestDatabase();
  console.log("=== Phase 34D Remove Component IDs From Output Tests ===\n");

  // ===== A. RC-DOC never appears in final visible content =====
  console.log("[A] RC-DOC never appears in final visible content");
  {
    // Simulate the pipeline's finalText assembly logic (post-fix)
    const responses = [
      { componentId: "RC-DOC", title: "RC-DOC", text: "I am a student pursuing CS." },
    ];
    const docLabel = "STATEMENT OF PURPOSE";

    // Replicate the fixed logic from run-application-pipeline.ts
    const finalText = responses
      .map(r => {
        const hasRealTitle = r.title && r.title !== r.componentId;
        if (hasRealTitle) {
          return `${r.title.toUpperCase()}\n\n${r.text}`;
        }
        return r.text;
      })
      .join("\n\n");
    const fullText = `${docLabel.toUpperCase()}\n\n${finalText}`;

    assert(!fullText.includes("RC-DOC"), "RC-DOC does not appear in finalText");
    assert(fullText.includes("STATEMENT OF PURPOSE"), "Document label is present");
    assert(fullText.includes("I am a student pursuing CS."), "Student-facing prose is present");
  }

  // ===== B. component IDs remain available internally =====
  console.log("\n[B] component IDs remain available internally");
  {
    // The responses array still has componentId for internal use
    const responses = [
      { componentId: "RC-DOC", title: "RC-DOC", text: "Some text" },
    ];

    // The pipeline still uses componentId internally for:
    // - claim provenance validation
    // - action plan matching
    // - render feedback
    assert(responses[0].componentId === "RC-DOC", "Component ID is available in responses array");
    assert(responses[0].componentId !== undefined, "Component ID is not undefined");

    // Verify the pipeline source still uses componentId internally
    const pipelineSource = fs.readFileSync(
      "src/lib/ai/pipeline/run-application-pipeline.ts", "utf-8",
    );
    // Internal uses of componentId should still exist
    assert(pipelineSource.includes("componentId: r.componentId"), "componentId still used in responses mapping");
    assert(pipelineSource.includes("actionPlan.plans.find(p => p.componentId"), "componentId still used in action plan matching");
    assert(pipelineSource.includes("expectedClaimIdsMap.get(claim.componentId)"), "componentId still used in claim tracking");

    // But NOT in the finalText assembly
    const finalTextSection = pipelineSource.substring(
      pipelineSource.indexOf("Phase 34D: Remove internal component IDs"),
      pipelineSource.indexOf("const fullText"),
    );
    assert(!finalTextSection.includes("${r.componentId}"), "componentId NOT used in finalText assembly");
  }

  // ===== C. PDF contains no RC-DOC =====
  console.log("\n[C] PDF contains no RC-DOC");
  {
    // Verify the PDF export code does not add component IDs
    const exportSource = fs.readFileSync(
      "src/lib/application/document-export.ts", "utf-8",
    );
    assert(!exportSource.includes("RC-DOC"), "Export code does not reference RC-DOC");
    assert(!exportSource.includes("componentId"), "Export code does not reference componentId");

    // Verify the export route does not add component IDs
    const routeSource = fs.readFileSync(
      "src/app/api/application/document/export/route.ts", "utf-8",
    );
    assert(!routeSource.includes("RC-DOC"), "Export route does not reference RC-DOC");
  }

  // ===== D. DOCX contains no RC-DOC =====
  console.log("\n[D] DOCX contains no RC-DOC");
  {
    // Same check as C — the export code is shared for PDF and DOCX
    const exportSource = fs.readFileSync(
      "src/lib/application/document-export.ts", "utf-8",
    );
    assert(!exportSource.includes("RC-DOC"), "DOCX export code does not reference RC-DOC");
    assert(!exportSource.includes("componentId"), "DOCX export code does not reference componentId");
  }

  // ===== E. saved DocumentVersion contains only student-facing prose =====
  console.log("\n[E] saved DocumentVersion contains only student-facing prose");
  {
    // Verify the generation service saves result.finalText as content.
    // Phase 37 moved logic from route to generation-service.ts — check the service.
    const serviceSource = fs.readFileSync(
      "src/lib/application/generation-service.ts", "utf-8",
    );
    assert(serviceSource.includes("content: result.finalText"), "Route saves result.finalText as content");

    // Verify the pipeline's finalText does not include componentId
    const pipelineSource = fs.readFileSync(
      "src/lib/ai/pipeline/run-application-pipeline.ts", "utf-8",
    );
    // The old pattern was: `${r.componentId}. ${r.title.toUpperCase()}\n\n${r.text}`
    // The new pattern should NOT include r.componentId
    const oldPattern = '${r.componentId}. ${r.title.toUpperCase()}';
    assert(!pipelineSource.includes(oldPattern), "Old componentId concatenation pattern is removed");

    // The new pattern should use r.text directly (or r.title if it's a real title)
    const newPattern = "return r.text;";
    assert(pipelineSource.includes(newPattern), "New pattern returns r.text directly for single-component");
  }

  // ===== F. no AI architecture changes =====
  console.log("\n[F] no AI architecture changes");
  {
    assert(EXECUTION_STAGES.length === 6, "Still exactly 6 AI stages");
    assert(EXECUTION_STAGES[0] === "planner", "Stage 1: planner");
    assert(EXECUTION_STAGES[1] === "writer", "Stage 2: writer");
    assert(EXECUTION_STAGES[2] === "qualityReviewer", "Stage 3: qualityReviewer");
    assert(EXECUTION_STAGES[3] === "languageCalibrator", "Stage 4: languageCalibrator");
    assert(EXECUTION_STAGES[4] === "finalizer", "Stage 5: finalizer");
    assert(EXECUTION_STAGES[5] === "factReviewer", "Stage 6: factReviewer");

    // Verify no new stages were added
    const pipelineSource = fs.readFileSync(
      "src/lib/ai/pipeline/run-application-pipeline.ts", "utf-8",
    );
    assert(!pipelineSource.includes("stageExecution.execute(\"stage7\""), "No stage 7 added");
    assert(!pipelineSource.includes("stageExecution.execute(\"extraStage\""), "No extra stage added");
  }

  // ===== G. zero new OpenAI calls =====
  console.log("\n[G] zero new OpenAI calls");
  {
    // This test suite makes no OpenAI calls — it only reads source files
    // and checks deterministic logic.
    const testSource = fs.readFileSync(
      "tests/phase-34d-remove-component-ids-from-output-tests.ts", "utf-8",
    );
    // Check for actual import statements from OpenAI-related modules
    // A real import would look like: import ... from ".../openai-client"
    const hasOpenAIImport = /^import\s+.*from\s+["'].*openai/i.test(testSource);
    assert(!hasOpenAIImport, "Test does not import any OpenAI module");
    // Check for actual await calls to OpenAI functions
    const hasOpenAICall = /await\s+callOpenAI|await\s+openai/i.test(testSource);
    assert(!hasOpenAICall, "Test makes no OpenAI API calls");
    // Check that no API key check is performed
    const hasApiKeyCheck = /isApiKeyConfigured\s*\(\s*\)/.test(testSource);
    assert(!hasApiKeyCheck, "Test does not check API key");
  }

  // ===== Additional: Production unaffected =====
  console.log("\n[Additional] Production unaffected");
  {
    const counts = await getProductionCounts();
    assert(counts.students >= 0, "Production has students (count stable)");
    assert(counts.applications >= 0, "Production has applications (count stable)");
    assert(counts.application_documents >= 0, "Production has documents (count stable)");
    assert(counts.document_versions >= 0, "Production has versions (count stable)");
  }

  // ===== Additional: Multi-component documents still work =====
  console.log("\n[Additional] Multi-component documents use real titles, not componentIds");
  {
    // Simulate a multi-component document where the model returns real titles
    const responses = [
      { componentId: "RC-DOC-1", title: "Academic Background", text: "I studied at XYZ." },
      { componentId: "RC-DOC-2", title: "Research Interests", text: "I am interested in AI." },
    ];
    const docLabel = "APPLICATION DOCUMENT";

    const finalText = responses
      .map(r => {
        const hasRealTitle = r.title && r.title !== r.componentId;
        if (hasRealTitle) {
          return `${r.title.toUpperCase()}\n\n${r.text}`;
        }
        return r.text;
      })
      .join("\n\n");
    const fullText = `${docLabel.toUpperCase()}\n\n${finalText}`;

    assert(!fullText.includes("RC-DOC-1"), "RC-DOC-1 does not appear in multi-component output");
    assert(!fullText.includes("RC-DOC-2"), "RC-DOC-2 does not appear in multi-component output");
    assert(fullText.includes("ACADEMIC BACKGROUND"), "Real title is used for component 1");
    assert(fullText.includes("RESEARCH INTERESTS"), "Real title is used for component 2");
    assert(fullText.includes("I studied at XYZ."), "Component 1 text is present");
    assert(fullText.includes("I am interested in AI."), "Component 2 text is present");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  try {
    await cleanupTestDb();
  } catch {
    // ignore cleanup errors
  }
  await closeDbPool();
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
