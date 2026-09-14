/**
 * @file generation-build-manifest.ts
 * @description
 * Generation Build Manifest — persisted BEFORE stage 1 of any paid
 * golden generation. Records the exact code/config/prompt/evidence
 * state so that the generation is immutable and reproducible.
 *
 * If code changes after the manifest is created, the generation must
 * be ABORTED and a new generation number assigned.
 *
 * Phase SOP-AI-19.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "fs";
import path from "path";

export interface GenerationBuildManifest {
  /** Generation number (e.g., "006") */
  generationNumber: string;
  /** Timestamp when manifest was created */
  timestamp: string;
  /** Source commit hash or "unknown" */
  sourceCommit: string;
  /** Hashes of critical source files */
  criticalSourceHashes: Record<string, string>;
  /** Prompt version hash */
  promptVersionHash: string;
  /** Model configuration hash */
  modelConfigurationHash: string;
  /** Generation Contract hash (raw, includes volatile fields) */
  generationContractHash: string;
  /** Phase 21: Contract instance ID (volatile, for audit) */
  contractInstanceId: string;
  /** Phase 21: Deterministic semantic hash (excludes volatile fields) */
  contractSemanticHash: string;
  /** Student facts hash */
  studentFactsHash: string;
  /** Evidence Ledger hash */
  evidenceLedgerHash: string;
  /** Evidence Bundle hash */
  evidenceBundleHash: string;
  /** Render profile ID and version */
  renderProfileId: string;
  renderProfileVersion: string;
  /** Schema versions */
  schemaVersions: {
    evidenceLedger: string;
    evidenceBundle: string;
    generationContract: string;
    claimProvenance: string;
  };
  /** Model name */
  model: string;
  /** Pipeline stage list */
  pipelineStages: string[];
}

/**
 * Compute SHA-256 hash of a file's contents.
 */
export async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex").substring(0, 16);
  } catch {
    return "FILE_NOT_FOUND";
  }
}

/**
 * Create a generation build manifest.
 *
 * This must be called and persisted BEFORE stage 1 of any paid generation.
 */
export async function createGenerationBuildManifest(args: {
  generationNumber: string;
  sourceCommit?: string;
  generationContractHash: string;
  contractInstanceId: string;
  contractSemanticHash: string;
  studentFactsHash: string;
  evidenceLedgerHash: string;
  evidenceBundleHash: string;
  promptVersionHash: string;
  modelConfigurationHash: string;
  renderProfileId: string;
  renderProfileVersion: string;
  model: string;
  pipelineStages: string[];
  projectRoot: string;
}): Promise<GenerationBuildManifest> {
  // Hash critical source files
  const criticalFiles = [
    "src/lib/ai/pipeline/run-application-pipeline.ts",
    "src/lib/ai/pipeline/build-ai-input.ts",
    "src/lib/ai/evidence-ledger.ts",
    "src/lib/ai/application-evidence-bundle.ts",
    "src/lib/ai/claim-provenance.ts",
    "src/lib/ai/bounded-finalizer.ts",
    "src/lib/ai/component-action-planner.ts",
    "src/lib/ai/specificity-guard.ts",
    "src/lib/ai/writer-claim-types.ts",
    "src/lib/ai/prompts/generic/writer.ts",
    "src/lib/ai/prompts/generic/quality-reviewer.ts",
    "src/lib/ai/prompts/generic/finalizer.ts",
    "src/lib/ai/prompts/generic/final-fact-reviewer.ts",
  ];

  const criticalSourceHashes: Record<string, string> = {};
  for (const file of criticalFiles) {
    criticalSourceHashes[file] = await hashFile(path.join(args.projectRoot, file));
  }

  return {
    generationNumber: args.generationNumber,
    timestamp: new Date().toISOString(),
    sourceCommit: args.sourceCommit || "unknown",
    criticalSourceHashes,
    promptVersionHash: args.promptVersionHash,
    modelConfigurationHash: args.modelConfigurationHash,
    generationContractHash: args.generationContractHash,
    contractInstanceId: args.contractInstanceId,
    contractSemanticHash: args.contractSemanticHash,
    studentFactsHash: args.studentFactsHash,
    evidenceLedgerHash: args.evidenceLedgerHash,
    evidenceBundleHash: args.evidenceBundleHash,
    renderProfileId: args.renderProfileId,
    renderProfileVersion: args.renderProfileVersion,
    schemaVersions: {
      evidenceLedger: "evidence-ledger-v1",
      evidenceBundle: "evidence-bundle-v1",
      generationContract: "generation-contract-v1",
      claimProvenance: "claim-provenance-v1",
    },
    model: args.model,
    pipelineStages: args.pipelineStages,
  };
}

/**
 * Persist a generation build manifest to the output directory.
 */
export async function saveGenerationBuildManifest(
  manifest: GenerationBuildManifest,
  outputDir: string
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "generation-build-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Verify that the current source files match the manifest's recorded hashes.
 * If any critical file has changed, the generation is invalid.
 */
export async function verifyGenerationBuildManifest(
  manifest: GenerationBuildManifest,
  projectRoot: string
): Promise<{ valid: boolean; changedFiles: string[] }> {
  const changedFiles: string[] = [];
  for (const [file, expectedHash] of Object.entries(manifest.criticalSourceHashes)) {
    const currentHash = await hashFile(path.join(projectRoot, file));
    if (currentHash !== expectedHash) {
      changedFiles.push(file);
    }
  }
  return { valid: changedFiles.length === 0, changedFiles };
}
