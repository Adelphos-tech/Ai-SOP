/**
 * Debug: Compare computed hashes with stored run-state hashes
 */
import { promises as fs } from "fs";
import path from "path";
import { buildGenerationContract } from "../src/lib/requirements/generation-contract";
import { checkGenerationGate } from "../src/lib/requirements/generation-gate";
import { buildEvidenceLedger } from "../src/lib/ai/evidence-ledger";
import { computeHash } from "../src/lib/ai/pipeline-checkpoint";
import { AI_CONFIG, getPromptVersionHash, getAllModelsUsed, STAGE_MAX_COMPLETION_TOKENS } from "../src/lib/ai/config";

const ARTIFACT_BASE = path.join(process.cwd(), "logs", "requirements", "ai-permitted-live-test");
const ATTEMPT_DIR = path.join(process.cwd(), "logs", "attempts", "3dc28fa9-611f-4f42-86b6-da6a721aee58");

async function loadJson(p: string): Promise<any> {
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function main() {
  // Load stored run-state
  const runState = await loadJson(path.join(ATTEMPT_DIR, "run-state.json"));
  const storedHashes = runState.state.hashes;
  const storedDeps = runState.state.dependenciesHash;

  // Load artifacts
  const brief = await loadJson(path.join(ARTIFACT_BASE, "verified-application-brief.json"));
  const aiPolicy = await loadJson(path.join(ARTIFACT_BASE, "ai-usage-policy.json"));
  const rcData = await loadJson(path.join(ARTIFACT_BASE, "response-components.json"));
  const proposalsData = await loadJson(path.join(ARTIFACT_BASE, "faculty-alignment-proposals.json"));
  const contractData = await loadJson(path.join(ARTIFACT_BASE, "generation-contract-approved.json"));
  const profile = contractData.contract.studentFacts;

  const responseComponents = rcData.responseComponents;
  const pageLimit = rcData.totalPageLimit;
  const facultyAlignment = proposalsData.proposals
    .filter((p: any) => p.status === "STUDENT_APPROVED")
    .map((p: any) => ({
      facultyName: p.facultyName,
      verifiedProgramFactSource: p.verifiedFacultyEvidence[0],
      studentInterestEvidence: p.studentInterestEvidence,
      alignmentReason: p.alignmentReason,
      status: "STUDENT_APPROVED" as const,
    }));

  // Build contract
  const contractResult = buildGenerationContract(profile, brief, aiPolicy, {
    responseComponents, pageLimit, facultyAlignment, programContext: null,
  });
  const contract = contractResult.contract!;

  // Build evidence ledger
  const programContextText = contract.programContext ? JSON.stringify(contract.programContext) : "";
  const evidenceLedger = buildEvidenceLedger({
    studentFacts: profile as any,
    programContextText,
    facultyAlignment,
  });

  // Compute hashes
  const modelConfigurationHash = computeHash({
    models: Object.fromEntries(getAllModelsUsed().map(m => [m, m])),
    stageTokens: STAGE_MAX_COMPLETION_TOKENS,
    config: AI_CONFIG,
  });

  const computedHashes = {
    generationContractHash: computeHash(contract),
    studentFactsHash: computeHash(contract.studentFacts),
    applicationRequirementsHash: computeHash(brief),
    aiPolicyHash: computeHash(aiPolicy),
    applicationSpecificFactsHash: evidenceLedger.ledgerHash,
    modelConfigurationHash,
    promptVersionHash: getPromptVersionHash(),
    renderProfileVersion: "1.0.0",
  };

  const computedDeps = computeHash(computedHashes);

  // Compare
  console.log("=== HASH COMPARISON ===\n");
  const keys = Object.keys(storedHashes);
  for (const key of keys) {
    const stored = storedHashes[key];
    const computed = (computedHashes as any)[key];
    const match = stored === computed;
    console.log(`  ${match ? "MATCH" : "DIFF"}  ${key}`);
    if (!match) {
      console.log(`    stored:    ${stored}`);
      console.log(`    computed:  ${computed}`);
    }
  }

  console.log("\n  dependenciesHash:");
  console.log(`    stored:    ${storedDeps}`);
  console.log(`    computed:  ${computedDeps}`);
  console.log(`    match:     ${storedDeps === computedDeps}`);

  // Also check exchange rate
  console.log("\n  exchangeRate:");
  console.log(`    stored:    ${runState.state.exchangeRate}`);
}

main().catch(e => { console.error(e); process.exit(1); });
