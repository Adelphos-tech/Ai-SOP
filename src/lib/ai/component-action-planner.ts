/**
 * @file component-action-planner.ts
 * @description
 * Deterministically assigns an action to EVERY response component
 * before the Finalizer runs.
 *
 * The Finalizer does NOT decide its own scope. Code decides what
 * each component needs.
 *
 * Actions:
 *   FREEZE                      — return text EXACTLY unchanged
 *   COMPRESS                    — shorten to fit page limit
 *   TARGETED_COMPLIANCE_REPAIR  — fix missing required topic using allowed evidence
 *   COMPRESS_AND_REPAIR         — both compress and repair
 */

import type { ResponseComponent, ResponseComponentTopic } from "@/lib/requirements/generation-contract-types";
import type { RenderFeedback } from "@/lib/render/render-lifecycle-types";
import type { EvidenceLedger } from "./evidence-ledger";
import { buildAuthorizedRepairEvidence, CandidateEvidence, TopicCoverageWithSuitability } from "./evidence-suitability";

export type ComponentAction =
  | "FREEZE"
  | "COMPRESS"
  | "TARGETED_COMPLIANCE_REPAIR"
  | "COMPRESS_AND_REPAIR";

export interface TopicCoverage {
  topic: string;
  covered: boolean;
  allowedEvidenceIds?: string[];
  /** Phase 16B: structured evidence suitability */
  candidateEvidence?: Array<{
    evidenceId: string;
    suitability: "SUITABLE" | "INSUFFICIENT" | "AMBIGUOUS";
    reason: string;
    supportedContext: string;
    requiredContext: string;
  }>;
}

export interface TopicEvidence {
  topic: string;
  allowedEvidenceIds: string[];
}

export interface MaterialQualityIssue {
  code: "MISSING_REQUIRED_TOPIC" | "OTHER";
  message: string;
  topic?: string;
}

export interface ActionPlanIssue {
  componentId: string;
  code: "FINALIZER_SCOPE_VIOLATION" | "REQUIRED_TOPIC_COVERAGE_UNKNOWN" | "FINALIZER_EVIDENCE_VIOLATION" | "MISSING_REQUIRED_STUDENT_INFORMATION" | "RENDER_VALIDATION_REQUIRED";
  message: string;
  topic?: string;
}

export interface FactualCleanupClaim {
  claim: string;
  allowedEvidenceIds: string[];
}

export interface FactualCleanupDirective {
  required: boolean;
  claims: FactualCleanupClaim[];
}

export interface ComponentActionPlan {
  componentId: string;
  action: ComponentAction;
  reason: string;
  /** For TARGETED_COMPLIANCE_REPAIR: the missing topics */
  missingTopics: string[];
  /** For TARGETED_COMPLIANCE_REPAIR: allowed evidence fact IDs */
  allowedEvidenceIds: string[];
  /** Whether this component physically fits its page limit */
  physicallyFits: boolean;
  /** Pre-final character count for length regression guard */
  preFinalCharacterCount: number;
  /** Pre-final page count for page regression guard */
  preFinalPageCount: number;
  topicEvidence?: TopicEvidence[];
  requiredTopics?: string[];
  requiresRenderValidation?: boolean;
  requiredTopicConstraints?: ResponseComponentTopic[];
  materialIssues?: MaterialQualityIssue[] | boolean;
  /** Phase 14: Factual cleanup directive (orthogonal to action) */
  factualCleanup?: FactualCleanupDirective;
}

export interface ActionPlanResult {
  plans: ComponentActionPlan[];
  /** Components that are frozen (Finalizer must not change) */
  frozenComponentIds: string[];
  /** Components that may be modified */
  editableComponentIds: string[];
  blocked?: boolean;
  blockingIssues?: ActionPlanIssue[];
  expectedComponentIds?: string[];
  ledgerHash?: string;
  combinedOverflow?: boolean;
  combinedMaxPages?: number | null;
}

export function componentSetIssues(expected: string[], actual: string[], label: string): ActionPlanIssue[] {
  const issues: ActionPlanIssue[] = [];
  for (const id of Array.from(new Set([...expected, ...actual]))) {
    const count = actual.filter(value => value === id).length;
    if (!id || !expected.includes(id) || count !== 1) {
      issues.push({ componentId: id, code: "FINALIZER_SCOPE_VIOLATION", message: `${label}: expected exactly one authorized component ${id}; found ${count}.` });
    }
  }
  return issues;
}

export function isLedgerEvidenceId(id: unknown, ledger: EvidenceLedger | null | undefined): id is string {
  if (typeof id !== "string" || !Array.isArray(ledger?.allEntries)) return false;
  const entries = ledger.allEntries.filter(entry => entry.id === id);
  return entries.length === 1 && typeof entries[0].canonicalText === "string" && entries[0].canonicalText.trim().length > 0;
}

export function hasRequiredStudentEvidence(topic: Pick<ResponseComponentTopic, "requiresStudentSpecificFact" | "studentFactType"> | undefined, ids: string[], ledger: EvidenceLedger | null | undefined): boolean {
  if (topic?.requiresStudentSpecificFact !== true) return true;
  return ids.some(id => {
    if (!isLedgerEvidenceId(id, ledger)) return false;
    const entry = ledger!.allEntries.find(value => value.id === id)!;
    let facultyRecord = false;
    let approvedFaculty = false;
    try {
      const record = JSON.parse(entry.canonicalText);
      facultyRecord = !!record && typeof record === "object" && "facultyName" in record;
      approvedFaculty = facultyRecord && record.status === "STUDENT_APPROVED" && typeof record.facultyName === "string" && record.facultyName.trim().length > 0;
    } catch {}
    if (entry.category === "faculty" || facultyRecord) {
      return topic.studentFactType === "FACULTY_ALIGNMENT" && approvedFaculty;
    }
    return entry.category === "student" || entry.category === "application_specific";
  });
}

export function materialIssueProblems(materialIssues: unknown, topicEvidence: TopicEvidence[]): string[] {
  if (materialIssues === undefined || materialIssues === false) return [];
  if (!Array.isArray(materialIssues)) return ["Material quality/compliance issue lacks an explicit authorized missing-topic repair mapping."];
  return materialIssues.flatMap(issue => {
    const authorized = issue && issue.code === "MISSING_REQUIRED_TOPIC" && typeof issue.message === "string" && issue.message.trim() && typeof issue.topic === "string" && topicEvidence.some(mapping => mapping.topic === issue.topic && mapping.allowedEvidenceIds.length > 0);
    return authorized ? [] : ["Material quality/compliance issue is malformed, non-topic-specific, or outside authorized missing-topic repairs."];
  });
}

/**
 * Determine the action for each component based on:
 *   - Render feedback (physical page compliance)
 *   - Quality review output (required topic coverage)
 *   - Evidence ledger (available evidence for repair)
 */
export function planComponentActions(args: {
  responseComponents: ResponseComponent[];
  renderFeedback: RenderFeedback | null;
  qualityReview: any;
  evidenceLedger: EvidenceLedger | null;
  calibratedResponses: Array<{ componentId: string; text: string }>;
}): ActionPlanResult {
  const plans: ComponentActionPlan[] = [];
  const frozenComponentIds: string[] = [];
  const editableComponentIds: string[] = [];
  const expectedComponentIds = args.responseComponents.map(rc => rc.componentId);
  const scores = Array.isArray(args.qualityReview?.componentScores) ? args.qualityReview.componentScores : [];
  const blockingIssues: ActionPlanIssue[] = [
    ...componentSetIssues(expectedComponentIds, expectedComponentIds, "Contract"),
    ...componentSetIssues(expectedComponentIds, args.calibratedResponses.map(r => r.componentId), "Calibrated responses"),
    ...componentSetIssues(expectedComponentIds, scores.map((score: any) => score?.componentId), "Quality review"),
    ...(args.renderFeedback ? componentSetIssues(expectedComponentIds, args.renderFeedback.components.map(c => c.componentId), "Pre-final render") : []),
  ];
  if (args.renderFeedback?.combinedStatus === "RENDER_ENGINE_ERROR") {
    blockingIssues.push({ componentId: "*", code: "RENDER_VALIDATION_REQUIRED", message: "Pre-final combined render failed." });
  }

  for (const rc of args.responseComponents) {
    const renderComp = args.renderFeedback?.components.find(c => c.componentId === rc.componentId);
    const calibratedResp = args.calibratedResponses.find(r => r.componentId === rc.componentId);
    const requiresRenderValidation = rc.pageLimit.maxPages !== null;
    const physicallyFits = renderComp
      ? renderComp.status === "PASS" || (!requiresRenderValidation && renderComp.status === "NOT_APPLICABLE")
      : !requiresRenderValidation;
    const preFinalCharacterCount = typeof calibratedResp?.text === "string" ? calibratedResp.text.length : 0;
    const preFinalPageCount = renderComp?.actualPages || 0;
    if (!calibratedResp || typeof calibratedResp.text !== "string" || !calibratedResp.text.trim()) {
      blockingIssues.push({ componentId: rc.componentId, code: "FINALIZER_SCOPE_VIOLATION", message: "Calibrated text is missing or empty." });
    }
    if (renderComp?.status === "RENDER_ENGINE_ERROR" || (requiresRenderValidation && (!renderComp || !["PASS", "RENDER_OVERFLOW"].includes(renderComp.status) || !Number.isFinite(renderComp.actualPages) || renderComp.actualPages <= 0))) {
      blockingIssues.push({ componentId: rc.componentId, code: "RENDER_VALIDATION_REQUIRED", message: "Valid pre-final render is required for this component." });
    }

    // Check for missing required topics from quality review
    const componentQuality = scores.find((cs: any) => cs?.componentId === rc.componentId);
    const requiredTopics = rc.requiredTopics.map(topic => topic.topic);
    const coverage: TopicCoverage[] = Array.isArray(componentQuality?.topicCoverage) ? componentQuality.topicCoverage : [];
    const coverageIssues = componentSetIssues(requiredTopics, coverage.map(t => t?.topic), "Required topic coverage");
    if (new Set(requiredTopics).size !== requiredTopics.length || coverageIssues.length || coverage.some(t => typeof t?.covered !== "boolean")) {
      blockingIssues.push({ componentId: rc.componentId, code: "REQUIRED_TOPIC_COVERAGE_UNKNOWN", message: "topicCoverage must contain each exact contract topic once, no extras, with explicit boolean covered." });
    }

    // Determine if this component has missing required topics
    const missingTopics: string[] = [];
    const topicEvidence: TopicEvidence[] = [];
    {
      // Check which specific topics are missing
      for (const topic of requiredTopics) {
        const entries = coverage.filter(t => t?.topic === topic);
        if (entries.length === 1 && entries[0].covered === false) missingTopics.push(topic);
      }
      // If no specific topic coverage data, infer from score
      if (!Array.isArray(componentQuality?.topicCoverage)) {
        blockingIssues.push({ componentId: rc.componentId, code: "REQUIRED_TOPIC_COVERAGE_UNKNOWN", message: "Missing component-local topicCoverage; scores and global compliance are not coverage evidence." });
      }
    }

    // Find allowed evidence for missing topics
    // Phase 16B: Use evidence suitability — only SUITABLE evidence authorizes repair
    const allowedEvidenceIds: string[] = [];
    for (const topic of missingTopics) {
      const topicCov = coverage.find(t => t?.topic === topic);
      // Phase 16B: Check candidateEvidence for SUITABLE items
      const candidateEvidence: CandidateEvidence[] = Array.isArray(topicCov?.candidateEvidence) ? topicCov.candidateEvidence : [];
      const suitableIds = candidateEvidence.filter(ce => ce.suitability === "SUITABLE").map(ce => ce.evidenceId);

      // Fallback: if no candidateEvidence structure, use legacy allowedEvidenceIds
      const legacyIds = Array.isArray(topicCov?.allowedEvidenceIds) ? topicCov.allowedEvidenceIds : [];

      if (candidateEvidence.length > 0) {
        // Phase 16B: Use suitability-based evidence
        if (suitableIds.length === 0) {
          // No SUITABLE evidence — BLOCK even if INSUFFICIENT/AMBIGUOUS evidence exists
          blockingIssues.push({ componentId: rc.componentId, topic, code: "MISSING_REQUIRED_STUDENT_INFORMATION", message: `Missing topic ${topic} has no SUITABLE evidence. Authorized but INSUFFICIENT/AMBIGUOUS evidence cannot be used for repair.` });
          topicEvidence.push({ topic, allowedEvidenceIds: [] });
        } else if (new Set(suitableIds).size !== suitableIds.length || suitableIds.some(id => !isLedgerEvidenceId(id, args.evidenceLedger))) {
          blockingIssues.push({ componentId: rc.componentId, topic, code: "FINALIZER_EVIDENCE_VIOLATION", message: `Missing topic ${topic} references duplicate, unknown or empty ledger evidence.` });
          topicEvidence.push({ topic, allowedEvidenceIds: [] });
        } else if (!hasRequiredStudentEvidence(rc.requiredTopics.find(required => required.topic === topic), suitableIds, args.evidenceLedger)) {
          blockingIssues.push({ componentId: rc.componentId, topic, code: "MISSING_REQUIRED_STUDENT_INFORMATION", message: `Missing topic ${topic} requires student-specific evidence; program or faculty context alone is insufficient.` });
          topicEvidence.push({ topic, allowedEvidenceIds: [] });
        } else {
          topicEvidence.push({ topic, allowedEvidenceIds: [...suitableIds] });
          allowedEvidenceIds.push(...suitableIds);
        }
      } else if (legacyIds.length === 0) {
        blockingIssues.push({ componentId: rc.componentId, topic, code: "MISSING_REQUIRED_STUDENT_INFORMATION", message: `Missing topic ${topic} has no explicitly authorized evidence.` });
        topicEvidence.push({ topic, allowedEvidenceIds: [] });
      } else if (new Set(legacyIds).size !== legacyIds.length || legacyIds.some(id => !isLedgerEvidenceId(id, args.evidenceLedger))) {
        blockingIssues.push({ componentId: rc.componentId, topic, code: "FINALIZER_EVIDENCE_VIOLATION", message: `Missing topic ${topic} references duplicate, unknown or empty ledger evidence.` });
        if (!legacyIds.some(id => isLedgerEvidenceId(id, args.evidenceLedger))) {
          blockingIssues.push({ componentId: rc.componentId, topic, code: "MISSING_REQUIRED_STUDENT_INFORMATION", message: `Missing topic ${topic} has no usable authorized ledger evidence.` });
        }
        topicEvidence.push({ topic, allowedEvidenceIds: [] });
      } else if (!hasRequiredStudentEvidence(rc.requiredTopics.find(required => required.topic === topic), legacyIds, args.evidenceLedger)) {
        blockingIssues.push({ componentId: rc.componentId, topic, code: "MISSING_REQUIRED_STUDENT_INFORMATION", message: `Missing topic ${topic} requires student-specific evidence; program or faculty context alone is insufficient.` });
        topicEvidence.push({ topic, allowedEvidenceIds: [] });
      } else {
        topicEvidence.push({ topic, allowedEvidenceIds: [...legacyIds] });
        allowedEvidenceIds.push(...legacyIds);
      }
    }
    for (const message of materialIssueProblems(componentQuality?.materialIssues, topicEvidence)) {
      blockingIssues.push({ componentId: rc.componentId, code: "REQUIRED_TOPIC_COVERAGE_UNKNOWN", message });
    }

    // Determine action
    let action: ComponentAction;
    let reason: string;

    const hasOverflow = renderComp?.status === "RENDER_OVERFLOW";
    const hasMissingTopics = missingTopics.length > 0;
    const hasEvidence = topicEvidence.length === missingTopics.length && topicEvidence.every(t => t.allowedEvidenceIds.length > 0);

    // Phase 14: Extract factual risk claims from Quality Reviewer
    const factualRiskClaims: Array<{ claim: string; status: string; supportingEvidenceIds: string[]; reason: string }> =
      Array.isArray(componentQuality?.factualRiskClaims) ? componentQuality.factualRiskClaims : [];
    // Phase 19: Include SEMANTIC_EXPANSION claims (unsupported motivation, novel specificity)
    const unsupportedClaims = factualRiskClaims.filter(c => c.status === "POTENTIALLY_UNSUPPORTED" || c.status === "SEMANTIC_EXPANSION");
    const hasFactualRisk = unsupportedClaims.length > 0;
    const hasSemanticExpansion = unsupportedClaims.some(c => c.status === "SEMANTIC_EXPANSION");

    // Phase 14: Build factual cleanup directive
    let factualCleanup: FactualCleanupDirective | undefined;
    if (hasFactualRisk) {
      factualCleanup = {
        required: true,
        claims: unsupportedClaims.map(c => ({
          claim: c.claim,
          allowedEvidenceIds: Array.isArray(c.supportingEvidenceIds) ? c.supportingEvidenceIds : [],
        })),
      };
    }

    if (hasOverflow && hasMissingTopics) {
      if (hasEvidence) {
        action = "COMPRESS_AND_REPAIR";
        reason = `Compress overflow and repair only these missing topics: ${missingTopics.join(", ")}.`;
      } else {
        // No evidence for repair — cannot fix missing topics
        action = "COMPRESS";
        reason = "BLOCKED: missing required topics lack authorized evidence; compression cannot resolve this.";
      }
    } else if (hasOverflow) {
      action = "COMPRESS";
      reason = "Compress to fit the verified page limit without adding facts.";
    } else if (hasMissingTopics) {
      if (hasEvidence) {
        action = "TARGETED_COMPLIANCE_REPAIR";
        reason = `Repair only these missing topics: ${missingTopics.join(", ")}.`;
      } else {
        // No evidence — cannot repair, mark for freeze and report
        action = "FREEZE";
        reason = "BLOCKED: MISSING_REQUIRED_STUDENT_INFORMATION or invalid evidence authorization.";
      }
    } else {
      // Phase 19: If semantic expansion claims exist, use COMPRESS to allow deletion
      if (hasSemanticExpansion) {
        action = "COMPRESS";
        reason = "Compress to remove SEMANTIC_EXPANSION claims flagged by Quality Reviewer. Delete unsafe claims; do not replace with new unsupported assertions.";
      } else {
        action = "FREEZE";
        reason = "Preserve text; finalization is permitted only if there are no blocking issues.";
      }
    }

    // Phase 14: If there are unsupported factual claims, the component cannot simply be FREEZE.
    // It requires factual cleanup. Change FREEZE to a minimal edit action.
    if (action === "FREEZE" && hasFactualRisk) {
      // The component fits physically and covers topics, but has unsupported claims.
      // The Finalizer must be allowed to delete/replace unsupported claims.
      // Use COMPRESS as the action since it allows editing without adding facts.
      action = "COMPRESS";
      reason = "Factual cleanup required: remove or generalize unsupported claims without adding new facts.";
    }

    plans.push({
      componentId: rc.componentId,
      action,
      reason,
      missingTopics,
      allowedEvidenceIds: Array.from(new Set(allowedEvidenceIds)),
      physicallyFits,
      preFinalCharacterCount,
      preFinalPageCount,
      topicEvidence,
      requiredTopics,
      requiresRenderValidation,
      factualCleanup,
    });

    if (action === "FREEZE") {
      frozenComponentIds.push(rc.componentId);
    } else {
      editableComponentIds.push(rc.componentId);
    }
  }

  return { plans, frozenComponentIds, editableComponentIds, blocked: blockingIssues.length > 0, blockingIssues, expectedComponentIds, ledgerHash: args.evidenceLedger?.ledgerHash };
}
