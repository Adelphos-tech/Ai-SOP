/**
 * @file experiment-replay.ts
 * @description
 * Controlled experiment harness. Rebuilds the exact pipelineInput that
 * generation-service.ts constructs for a document, then runs
 * runApplicationPipeline() directly — no DB writes, no version creation.
 *
 * Experiments (env toggles):
 *   EXPERIMENT_COMPACT_REVIEWS=1   → compact QR/FR output instructions
 *   EXPERIMENT_WRITER_NARRATIVE=1  → writer narrative rules block
 *   EXPERIMENT_CACHE_PREFIX=1      → identical shared prefix for caching
 *   OPENAI_MODEL_<STAGE>=<model>   → per-stage model override (Exp D)
 *
 * Usage:
 *   EXP_NAME=A SOP_DB_*=<prod> OPENAI_API_KEY=<key> \
 *     npx tsx tests/experiment-replay.ts <studentId> <applicationId> <documentId>
 */

import { randomUUID } from "crypto";
import {
  loadDocumentGenerationContext,
  buildPipelineWritingInstructions,
} from "../src/lib/application/generation-context";
import { buildQualityRubricInstructions } from "../src/lib/application/document-type-config";
import { adaptProfile } from "../src/lib/application/profile-adapter";
import {
  runApplicationPipeline,
  ApplicationPipelineInput,
} from "../src/lib/ai/pipeline/run-application-pipeline";
import {
  ResponseComponent,
  PageLimitConstraint,
  GenerationContract,
  ContractWritingRequirement,
  ContractLanguageProfile,
} from "../src/lib/requirements/generation-contract-types";
import { computeContractSemanticHash } from "../src/lib/requirements/generation-contract";
import { setExperimentSharedPrefix } from "../src/lib/ai/prompts/prompt-safety-block";
import { closeDbPool } from "../src/lib/application/db";

async function run() {
  const [studentId, applicationId, documentId] = process.argv.slice(2);
  if (!studentId || !applicationId || !documentId) {
    console.error("usage: experiment-replay.ts <studentId> <applicationId> <documentId>");
    process.exit(1);
  }
  const expName = process.env.EXP_NAME || "EXP";

  const ctxResult = await loadDocumentGenerationContext(studentId, applicationId, documentId);
  if (!ctxResult.ok) throw new Error(`context: ${ctxResult.error}`);
  const ctx = ctxResult.context!;
  if (ctx.blocked) throw new Error(`blocked: ${ctx.blockReasons.join("; ")}`);

  // ===== Replicate generation-service pipelineInput construction =====
  const profile = adaptProfile(ctx.student, ctx.profile);
  const merged = ctx.mergedPrompt;
  const config = ctx.documentTypeConfig;

  const responseComponent: ResponseComponent = {
    componentId: "RC-DOC",
    label: ctx.document.documentTitle || config.displayName,
    exactPrompt: merged.promptText,
    pageLimit: {
      type: "PER_DOCUMENT" as const,
      maxPages: merged.pageLimit || null,
      status: merged.pageLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    wordLimit: {
      min: merged.wordMin || null,
      max: merged.wordMax || null,
      status: merged.wordMax ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    characterLimit: {
      min: null,
      max: merged.characterLimit || null,
      status: merged.characterLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    requiredTopics: [],
    sourceId: merged.writingRequirementId || "document",
    status: merged.resolutionPath === "OFFICIAL_VERIFIED" ? "VERIFIED" : "MANUAL",
    verifiedAt: new Date().toISOString(),
  };

  const pageLimit: PageLimitConstraint = {
    type: "PER_DOCUMENT",
    maxPages: merged.pageLimit || null,
    status: merged.pageLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
  };

  const pipelineWritingInstructions = buildPipelineWritingInstructions(ctx);
  const qualityRubricInstructions = buildQualityRubricInstructions(config);

  const programContextText = ctx.application
    ? `University: ${ctx.application.universityName}\nProgram: ${ctx.application.programName}\nDegree: ${ctx.application.degree}\nIntake: ${ctx.application.intake} ${ctx.application.intakeYear}\nCountry: ${ctx.application.country}`
    : "";

  const writingRequirement: ContractWritingRequirement = {
    documentType: ctx.document.documentType,
    documentTypeLabel: config.displayName,
    officialPrompt: merged.promptText,
    officialPromptStatus: merged.resolutionPath === "OFFICIAL_VERIFIED" ? "VERIFIED" : "MANUAL",
    wordLimit: {
      min: merged.wordMin || null,
      max: merged.wordMax || null,
      status: merged.wordMax ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    characterLimit: {
      min: null,
      max: merged.characterLimit || null,
      status: merged.characterLimit ? "VERIFIED" : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
    },
    requiredTopics: [],
    formatInstructions: merged.formattingInstructions ? [merged.formattingInstructions] : [],
    additionalQuestions: [],
    sourceId: merged.writingRequirementId || null,
    responseComponentCount: 1,
  };

  const languageProfile: ContractLanguageProfile = {
    testType: (profile as any).englishProficiency?.testType || "",
    overallScore: (profile as any).englishProficiency?.overallScore || "",
    writingScore: (profile as any).englishProficiency?.writing || "",
    desiredProfile: (profile as any).writingPreferences?.sopWritingProfile?.level || "Natural Professional",
    tone: (profile as any).writingPreferences?.sopWritingProfile?.tone || "Professional & Personal",
    personalization: (profile as any).writingPreferences?.sopWritingProfile?.personalization || "Balanced",
    technicalDetail: (profile as any).writingPreferences?.sopWritingProfile?.technicalDetail || "Medium",
    openingStyle: (profile as any).writingPreferences?.sopWritingProfile?.openingStyle || "Let AI Choose Best Opening",
  };

  const contract: GenerationContract = {
    contractId: "GC-EXP-" + expName + "-" + Date.now(),
    createdAt: new Date().toISOString(),
    studentFacts: profile,
    application: {
      country: ctx.application?.country || "",
      university: ctx.application?.universityName || "",
      program: ctx.application?.programName || "",
      degreeLevel: ctx.application?.degree || "",
      intake: ctx.application?.intake || "",
      intakeYear: ctx.application?.intakeYear || "",
    },
    writingRequirement,
    responseComponents: [responseComponent],
    pageLimit,
    programContext: null,
    countryGuidance: null,
    languageProfile,
    facultyAlignment: [],
    verification: {
      requirementsVerified: true,
      aiWritingAllowed: true,
      aiPolicyStatus: "AI_GENERATION_ALLOWED",
      conflicts: [],
      factSheetApproved: true,
    },
    clearedForWriting: true,
    blockingReasons: [],
  };
  contract.contractSemanticHash = computeContractSemanticHash(contract);

  const generationId = process.env.EXP_GENERATION_ID || `exp-${expName.toLowerCase()}-${randomUUID()}`;

  // Experiment C: build a large identical shared prefix so OpenAI prompt
  // caching can match it across all 6 stage calls.
  if (process.env.EXPERIMENT_CACHE_PREFIX) {
    const shared = `SHARED APPLICATION CONTEXT (identical across all pipeline stages):
${JSON.stringify({
      application: contract.application,
      writingRequirement: {
        documentType: writingRequirement.documentType,
        documentTypeLabel: writingRequirement.documentTypeLabel,
        officialPrompt: writingRequirement.officialPrompt,
        wordLimit: writingRequirement.wordLimit,
        characterLimit: writingRequirement.characterLimit,
        pageLimit,
      },
      programContextText,
      languageProfile,
      studentFacts: profile,
    }, null, 2)}`;
    setExperimentSharedPrefix(shared);
    console.log(`EXP ${expName}: shared prefix ${shared.length} chars (~${Math.round(shared.length / 4)} tokens)`);
  }

  const pipelineInput: ApplicationPipelineInput = {
    profile,
    responseComponents: [responseComponent],
    facultyAlignment: [],
    pageLimit,
    programContextText,
    documentTypeLabel: config.displayName,
    documentTypeConfig: config,
    pipelineWritingInstructions,
    qualityRubricInstructions,
    generationContract: contract,
    execution: { generationId, mode: "CONTENT_REGENERATION" as const },
  };

  console.log(`EXP ${expName}: generation ${generationId} starting...`);
  const result = await runApplicationPipeline(pipelineInput);

  console.log(`\n=== EXP ${expName} RESULT ===`);
  console.log(`status: ${result.status}${result.error ? " | error: " + result.error : ""}`);
  console.log(`wordCount: ${result.metrics.wordCount} | duration: ${result.metrics.duration}ms`);
  if (result.metrics.cost) {
    const c = result.metrics.cost;
    console.log(`cost: $${c.estimatedApiCostUSD} / ₹${c.estimatedApiCostINR}`);
    console.log(`tokens: in=${c.totalInputTokens} cached=${c.totalCachedInputTokens} out=${c.totalOutputTokens}`);
    for (const s of c.stages) {
      console.log(
        `  ${s.stage}: in=${s.inputTokens} cached=${s.cachedInputTokens} out=${s.outputTokens} reason=${s.reasoningTokens} $${s.estimatedCostUsd.toFixed(6)}`
      );
    }
  }
  const outFile = `exp-${expName.toLowerCase()}-output.txt`;
  await (await import("fs")).promises.writeFile(outFile, result.finalText || "");
  console.log(`final text -> ${outFile}`);
  await closeDbPool();
  process.exit(result.status === "success" ? 0 : 1);
}

run().catch(async (e) => {
  console.error("FATAL:", e?.message || e);
  await closeDbPool().catch(() => undefined);
  process.exit(1);
});
