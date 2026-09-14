import {
  VerifiedApplicationBrief,
  BlockingIssue,
  RequirementStatus,
} from "./types";
import { AiUsagePolicy, GenerationEligibility } from "./ai-policy-types";
import { computeGenerationEligibility } from "./ai-policy-verifier";
import type { GenerationContract } from "./generation-contract-types";
import type { ApplicationEvidenceBundle } from "../ai/application-evidence-bundle";

interface GateCheckResult {
  allowed: boolean;
  blockingIssues: BlockingIssue[];
  aiPolicyBlocked: boolean;
  aiPolicy?: AiUsagePolicy;
}

/**
 * Server-side generation blocking gate.
 *
 * TWO SEPARATE GATES:
 *   1. Requirements Verification Gate — "Do we know what the application requires?"
 *   2. AI Usage Policy Gate — "Does the official institution permit generative AI?"
 *
 * BOTH must pass before OpenAI writing pipeline runs.
 * There is NO bypass path.
 */
export function checkGenerationGate(
  profile: any,
  brief: VerifiedApplicationBrief | null,
  aiPolicy?: AiUsagePolicy | null
): GateCheckResult {
  const blockingIssues: BlockingIssue[] = [];
  let aiPolicyBlocked = false;

  // ===== GATE 1: Requirements Verification =====

  // 1. Check fact sheet approval
  if (!profile?.factSheetApproval?.approved) {
    blockingIssues.push({
      field: "factSheet",
      issue: "Fact sheet has not been approved",
      severity: "BLOCK",
    });
  }

  // 2. Check requirements brief exists
  if (!brief) {
    blockingIssues.push({
      field: "requirements",
      issue: "Official application requirements have not been verified",
      severity: "BLOCK",
    });
    return { allowed: false, blockingIssues, aiPolicyBlocked: false };
  }

  // 3. Check requirements confirmation
  if (!profile?.factSheetApproval?.requirementsConfirmed) {
    blockingIssues.push({
      field: "requirementsConfirmation",
      issue: "Application requirements have not been confirmed by the user",
      severity: "BLOCK",
    });
  }

  // 4. Check verification status
  if (brief.verification.status === "BLOCKED" || brief.verification.status === "UNVERIFIED") {
    blockingIssues.push({
      field: "verification",
      issue: "Official application requirements could not be verified",
      severity: "BLOCK",
    });
  }

  // 5. Check for blocking conflicts
  if (brief.verification.status === "CONFLICT") {
    blockingIssues.push({
      field: "conflict",
      issue: "Conflicting requirements from official sources — cannot proceed",
      severity: "BLOCK",
    });
  }

  // 6. Check for blocking issues from verification
  for (const issue of brief.verification.blockingIssues) {
    if (issue.severity === "BLOCK") {
      blockingIssues.push(issue);
    }
  }

  // 7. Check that at least one official source exists
  if (brief.sources.length === 0) {
    blockingIssues.push({
      field: "sources",
      issue: "No official sources verified — cannot generate SOP without verified requirements",
      severity: "BLOCK",
    });
  }

  // 8. Check that official prompt is verified or explicitly not specified
  for (const doc of brief.documents) {
    if (doc.officialPrompt.status === "UNKNOWN") {
      blockingIssues.push({
        field: `documents.${doc.documentType}.officialPrompt`,
        issue: `Official prompt for ${doc.documentTypeLabel} is unknown — cannot generate`,
        severity: "BLOCK",
      });
    }
    if (doc.officialPrompt.status === "PORTAL_ONLY_UNAVAILABLE") {
      blockingIssues.push({
        field: `documents.${doc.documentType}.officialPrompt`,
        issue: `Official prompt for ${doc.documentTypeLabel} is only available in the application portal — cannot generate`,
        severity: "BLOCK",
      });
    }
    if (doc.officialPrompt.status === "CONFLICT") {
      blockingIssues.push({
        field: `documents.${doc.documentType}.officialPrompt`,
        issue: `Official prompt for ${doc.documentTypeLabel} has conflicting sources`,
        severity: "BLOCK",
      });
    }
  }

  // ===== GATE 2: AI Usage Policy =====

  if (aiPolicy && !aiPolicy.generationAllowed) {
    aiPolicyBlocked = true;
    blockingIssues.push({
      field: "aiPolicy",
      issue: aiPolicy.blockingReasons[0] || "AI usage policy blocks generation",
      severity: "BLOCK",
    });
  }

  // If no AI policy provided, block (fail-closed)
  if (!aiPolicy) {
    aiPolicyBlocked = true;
    blockingIssues.push({
      field: "aiPolicy",
      issue: "AI_USAGE_POLICY_NOT_CHECKED: AI usage policy has not been verified. Generation blocked.",
      severity: "BLOCK",
    });
  }

  return {
    allowed: blockingIssues.length === 0,
    blockingIssues,
    aiPolicyBlocked,
    aiPolicy: aiPolicy || undefined,
  };
}

// ===== GATE 3: Mandatory Topic Evidence (Phase 24) =====
//
// #007 lesson: "motivation for the work" was a mandatory official topic
// but no suitable approved student evidence existed. The pipeline ran 4
// paid stages before discovering this. This gate checks BEFORE Stage 1.
//
// This is NOT a new subsystem. It reuses:
//   - Generation Contract (for mandatory topics from official requirements)
//   - ApplicationEvidenceBundle (for approved student evidence)
//   - Existing BlockingIssue pattern
//
// Topic classification is deterministic (pattern-based, no AI calls).
// Evidence suitability is deterministic (category-based matching).

/**
 * Topics that require student-specific approved evidence.
 * Program/faculty facts alone cannot answer these.
 */
const STUDENT_EVIDENCE_TOPIC_PATTERNS = [
  /motivation|why.*choose|why.*undertake|what.*motivated/i,
  /challenge|obstacle|difficulty|overcome|unforeseen/i,
  /career.*goal|future.*goal|long.*term|short.*term|aspiration/i,
  /research.*experience|academic.*experience/i,
  /leadership|initiative/i,
  /achievement|accomplishment|award/i,
  /personal.*background|personal.*story/i,
  /responsibilities|tasks|role|duties/i,
  /conclusion|outcome|what.*learned|takeaway/i,
];

/**
 * Topics that can be answered from program/faculty evidence alone.
 */
const PROGRAM_SUFFICIENT_TOPIC_PATTERNS = [
  /faculty|professor/i,
  /why.*program|why.*university|program.*fit/i,
];

function topicRequiresStudentEvidence(topicText: string): boolean {
  for (const pattern of STUDENT_EVIDENCE_TOPIC_PATTERNS) {
    if (pattern.test(topicText)) return true;
  }
  return false;
}

function topicIsProgramSufficient(topicText: string): boolean {
  for (const pattern of PROGRAM_SUFFICIENT_TOPIC_PATTERNS) {
    if (pattern.test(topicText)) return true;
  }
  return false;
}

/**
 * Deterministic evidence-to-topic suitability check.
 * Matches evidence categories to topic patterns.
 */
function isEvidenceSuitableForTopic(evidenceId: string, evidenceCategory: string, evidenceText: string, topicText: string): boolean {
  const id = evidenceId.toUpperCase();
  const text = evidenceText.toLowerCase();
  const topic = topicText.toLowerCase();

  // Motivation topics: only project_motivation facts are suitable
  if (/motivation|why.*choose|why.*undertake/.test(topic)) {
    if (id.includes("MOTIVATION") || text.includes("i chose") || text.includes("i wanted to")) {
      return true;
    }
    return false;
  }

  // Challenge topics: only project_challenge facts are suitable
  if (/challenge|obstacle|unforeseen/.test(topic)) {
    if (id.includes("CHALLENGE") || text.includes("challenge") || text.includes("limited access")) {
      return true;
    }
    return false;
  }

  // Career goal topics: CAREER evidence
  if (/career.*goal|future.*goal|aspiration/.test(topic)) {
    if (id.includes("CAREER") || id.includes("SF-CAREER")) return true;
    return false;
  }

  // Research/academic experience: PROJ, EXP, EDU evidence
  if (/research.*experience|academic.*experience/.test(topic)) {
    if (id.includes("PROJ") || id.includes("EXP") || id.includes("EDU")) return true;
    return false;
  }

  // Responsibilities/tasks: PROJ, EXP evidence
  if (/responsibilities|tasks|role|duties/.test(topic)) {
    if (id.includes("PROJ") || id.includes("EXP")) return true;
    return false;
  }

  // Conclusions: PROJ evidence
  if (/conclusion|outcome|what.*learned|takeaway/.test(topic)) {
    if (id.includes("PROJ")) return true;
    return false;
  }

  // Personal background: STORY evidence
  if (/personal.*background|personal.*story/.test(topic)) {
    if (id.includes("STORY") || id.includes("SF-STORY")) return true;
    return false;
  }

  // Faculty topics: FF evidence
  if (/faculty|professor/.test(topic)) {
    if (id.includes("FF-") || evidenceCategory === "faculty") return true;
    return false;
  }

  // Program topics: PF evidence
  if (/why.*program|why.*university|program.*fit/.test(topic)) {
    if (id.includes("PF-") || evidenceCategory === "program") return true;
    return false;
  }

  return false;
}

/**
 * Generate a deterministic clarification question for a missing topic.
 * Does NOT fabricate an answer. Does NOT use AI.
 */
function generateClarificationQuestion(topicText: string): string {
  const topic = topicText.toLowerCase();

  if (/motivation|why.*choose|why.*undertake/.test(topic)) {
    return "Why did you choose to undertake this work? Please describe your specific motivation.";
  }
  if (/challenge|obstacle|unforeseen/.test(topic)) {
    return "What unforeseen challenges did you encounter, and how did you address them?";
  }
  if (/career.*goal|aspiration/.test(topic)) {
    return "What are your career goals, and how does this program support them?";
  }
  if (/research.*experience|academic.*experience/.test(topic)) {
    return "Please describe your research or academic experience relevant to this topic.";
  }
  if (/responsibilities|tasks|role/.test(topic)) {
    return "What were your specific responsibilities and tasks in this role or project?";
  }
  if (/conclusion|outcome|what.*learned/.test(topic)) {
    return "What conclusions or outcomes resulted from this experience, and what did you learn?";
  }

  return `Please provide specific information about: ${topicText}`;
}

export interface MandatoryTopicEvidenceResult {
  passed: boolean;
  blockingIssues: BlockingIssue[];
  topicEvaluations: Array<{
    componentId: string;
    topic: string;
    requiresStudentEvidence: boolean;
    suitableEvidenceIds: string[];
    status: "SUPPORTED" | "MISSING_REQUIRED_STUDENT_INFORMATION" | "NOT_APPLICABLE";
    suggestedStudentQuestion?: string;
  }>;
}

/**
 * GATE 3: Check that every mandatory official topic has suitable approved evidence.
 *
 * Runs BEFORE Stage 1 (Planner). No OpenAI calls.
 * Uses the Generation Contract (for mandatory topics from official requirements)
 * and the ApplicationEvidenceBundle (for approved student evidence).
 */
export function checkMandatoryTopicEvidence(
  contract: GenerationContract,
  evidenceBundle: ApplicationEvidenceBundle
): MandatoryTopicEvidenceResult {
  const blockingIssues: BlockingIssue[] = [];
  const topicEvaluations: MandatoryTopicEvidenceResult["topicEvaluations"] = [];

  for (const rc of contract.responseComponents) {
    for (const topic of rc.requiredTopics) {
      const topicText = topic.topic || "";
      const isMandatory = topic.status === "VERIFIED" || topic.status === "REQUIRED" || topic.status === "MANDATORY_REQUIRED_TOPIC";

      if (!isMandatory) {
        topicEvaluations.push({
          componentId: rc.componentId,
          topic: topicText,
          requiresStudentEvidence: false,
          suitableEvidenceIds: [],
          status: "NOT_APPLICABLE",
        });
        continue;
      }

      const requiresStudent = topicRequiresStudentEvidence(topicText);
      const isProgramSufficient = topicIsProgramSufficient(topicText);

      // Find suitable evidence from the bundle
      const suitableEvidenceIds: string[] = [];
      for (const entry of evidenceBundle.allEntries) {
        if (isEvidenceSuitableForTopic(entry.id, entry.category, entry.canonicalText, topicText)) {
          suitableEvidenceIds.push(entry.id);
        }
      }

      let status: "SUPPORTED" | "MISSING_REQUIRED_STUDENT_INFORMATION" | "NOT_APPLICABLE";

      if (requiresStudent && suitableEvidenceIds.length === 0) {
        // Mandatory student-evidence-required topic with no suitable evidence
        status = "MISSING_REQUIRED_STUDENT_INFORMATION";
        const question = generateClarificationQuestion(topicText);
        blockingIssues.push({
          field: `mandatoryTopic.${rc.componentId}.${topicText}`,
          issue: `MISSING_REQUIRED_STUDENT_INFORMATION: Mandatory topic "${topicText}" has no suitable approved student evidence. ${question}`,
          severity: "BLOCK",
        });
        topicEvaluations.push({
          componentId: rc.componentId,
          topic: topicText,
          requiresStudentEvidence: true,
          suitableEvidenceIds: [],
          status,
          suggestedStudentQuestion: question,
        });
      } else if (isProgramSufficient && suitableEvidenceIds.length === 0) {
        // Program-sufficient topic — check if program/faculty evidence covers it
        const hasProgramOrFaculty = evidenceBundle.allEntries.some(
          e => (e.category === "program" || e.category === "faculty") &&
               isEvidenceSuitableForTopic(e.id, e.category, e.canonicalText, topicText)
        );
        if (hasProgramOrFaculty) {
          status = "SUPPORTED";
        } else {
          // Mixed topic — may need student evidence too
          status = "MISSING_REQUIRED_STUDENT_INFORMATION";
          const question = generateClarificationQuestion(topicText);
          blockingIssues.push({
            field: `mandatoryTopic.${rc.componentId}.${topicText}`,
            issue: `MISSING_REQUIRED_STUDENT_INFORMATION: Mandatory topic "${topicText}" has no suitable evidence. ${question}`,
            severity: "BLOCK",
          });
          topicEvaluations.push({
            componentId: rc.componentId,
            topic: topicText,
            requiresStudentEvidence: true,
            suitableEvidenceIds: [],
            status,
            suggestedStudentQuestion: question,
          });
          continue;
        }
        topicEvaluations.push({
          componentId: rc.componentId,
          topic: topicText,
          requiresStudentEvidence: false,
          suitableEvidenceIds,
          status,
        });
      } else {
        status = "SUPPORTED";
        topicEvaluations.push({
          componentId: rc.componentId,
          topic: topicText,
          requiresStudentEvidence: requiresStudent,
          suitableEvidenceIds,
          status,
        });
      }
    }
  }

  return {
    passed: blockingIssues.length === 0,
    blockingIssues,
    topicEvaluations,
  };
}

/**
 * Compute full generation eligibility from both gates.
 */
export function computeFullEligibility(
  requirementsEligible: boolean,
  aiPolicy: AiUsagePolicy
): GenerationEligibility {
  return computeGenerationEligibility(requirementsEligible, aiPolicy);
}
