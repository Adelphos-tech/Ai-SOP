/**
 * @file claim-provenance.ts
 * @description
 * Phase 16: Claim Provenance Model + Deterministic Validator.
 *
 * Every factual claim produced by the Writer gets a stable claimId.
 * Claims are tracked through Language Calibrator and Finalizer.
 *
 * Rules:
 *   - Writer produces claims with stable IDs
 *   - Language Calibrator may retain/remove/rephrase claims but NOT create new ones
 *   - Finalizer COMPRESS: FINAL_CLAIMS ⊆ PRE_FINAL_CLAIMS (no new claims)
 *   - Finalizer TARGETED_REPAIR: repair claims allowed with authorized evidence only
 *   - Finalizer FREEZE: claim set must be identical
 *
 * This is DETERMINISTIC validation. No AI calls.
 * The Final Fact Reviewer (Stage 6) remains the semantic authority.
 */

import { createHash } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Claim Provenance Types                                              */
/* ------------------------------------------------------------------ */

export interface WriterClaim {
  claimId: string;
  componentId: string;
  text: string;
  evidenceIds: string[];
}

export interface CalibratedClaim {
  claimId: string;
  componentId: string;
  rewrittenText: string;
  evidenceIds: string[];
}

export interface FinalizerRepairClaim {
  /** Phase 21: Unique claim ID for this repair claim */
  claimId?: string;
  text: string;
  topicId: string;
  evidenceIds: string[];
  /** Phase 21: Context scope — which component/section this repair applies to */
  contextScope?: string;
}

export interface FinalizerClaimOutput {
  componentId: string;
  text: string;
  retainedClaimIds: string[];
  removedClaimIds: string[];
  repairClaims: FinalizerRepairClaim[];
}

export interface ClaimProvenanceViolation {
  componentId: string;
  code: ClaimProvenanceViolationCode;
  claimId?: string;
  evidenceId?: string;
  message: string;
}

export type ClaimProvenanceViolationCode =
  | "FINALIZER_UNKNOWN_CLAIM"
  | "FINALIZER_NEW_FACTUAL_CLAIM"
  | "FINALIZER_UNAUTHORIZED_REPAIR"
  | "FINALIZER_EVIDENCE_VIOLATION"
  | "FINALIZER_CLAIM_SET_VIOLATION"
  | "FINALIZER_REQUIRED_TOPIC_LOST"
  | "FINALIZER_EVIDENCE_CONTEXT_VIOLATION"
  | "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM"
  | "MISSING_REQUIRED_STUDENT_INFORMATION"
  | "FINALIZER_GUARD_INCOMPLETE";

export interface ClaimProvenanceResult {
  valid: boolean;
  violations: ClaimProvenanceViolation[];
  writerClaimCount: number;
  calibratedClaimCount: number;
  finalizerClaimCount: number;
  claimSetHash: string;
}

/* ------------------------------------------------------------------ */
/* Required Topic Provenance                                          */
/* ------------------------------------------------------------------ */

export interface RequiredTopicProvenance {
  topicId: string;
  text: string;
  requirementType: "MANDATORY_REQUIRED_TOPIC" | "OPTIONAL_QUALITY_SUGGESTION";
  sourceRequirementId: string;
  sourceUrl?: string;
  mandatory: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export function hashClaimSet(claims: Array<{ claimId: string; componentId: string; text?: string; rewrittenText?: string }>): string {
  const sorted = [...claims].sort((a, b) => a.claimId.localeCompare(b.claimId));
  const text = JSON.stringify(sorted.map(c => ({ id: c.claimId, comp: c.componentId, text: c.text || c.rewrittenText || "" })));
  return createHash("sha256").update(text).digest("hex").substring(0, 16);
}

/* ------------------------------------------------------------------ */
/* Language Calibrator Claim Guard                                    */
/* ------------------------------------------------------------------ */

export function validateLanguageCalibratorClaims(args: {
  writerClaims: WriterClaim[];
  calibratedClaims: CalibratedClaim[];
}): { valid: boolean; violations: ClaimProvenanceViolation[] } {
  const violations: ClaimProvenanceViolation[] = [];
  const writerClaimIds = new Set(args.writerClaims.map(c => c.claimId));
  const calibratedClaimIds = new Set(args.calibratedClaims.map(c => c.claimId));

  // Phase 38: Check for new unknown claim IDs introduced by Calibrator
  for (const cal of args.calibratedClaims) {
    if (!writerClaimIds.has(cal.claimId)) {
      violations.push({
        componentId: cal.componentId,
        code: "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM",
        claimId: cal.claimId,
        message: `Language Calibrator introduced unknown claim ID "${cal.claimId}" not present in Writer output.`,
      });
    }
    // Phase 38: rewrittenText must be non-null (no claim deletion)
    if (cal.rewrittenText === null || cal.rewrittenText === undefined) {
      violations.push({
        componentId: cal.componentId,
        code: "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM",
        claimId: cal.claimId,
        message: `Language Calibrator set rewrittenText to null for claim "${cal.claimId}". Claims may not be deleted.`,
      });
    }
  }

  // Phase 38: Check that ALL writer claim IDs are preserved (not just subset)
  for (const writerClaim of args.writerClaims) {
    if (!calibratedClaimIds.has(writerClaim.claimId)) {
      violations.push({
        componentId: writerClaim.componentId,
        code: "LANGUAGE_CALIBRATOR_NEW_FACTUAL_CLAIM",
        claimId: writerClaim.claimId,
        message: `Language Calibrator dropped claim ID "${writerClaim.claimId}" from Writer output. All claim IDs must be preserved.`,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ */
/* Finalizer Claim Provenance Validator                               */
/* ------------------------------------------------------------------ */

export function validateFinalizerClaims(args: {
  preFinalClaims: CalibratedClaim[];
  finalizerOutputs: FinalizerClaimOutput[];
  actionPlan: {
    plans: Array<{
      componentId: string;
      action: "FREEZE" | "COMPRESS" | "TARGETED_COMPLIANCE_REPAIR" | "COMPRESS_AND_REPAIR";
      missingTopics: string[];
      topicEvidence?: Array<{ topic: string; allowedEvidenceIds: string[] }>;
      factualCleanup?: { required: boolean; claims: Array<{ claim: string; allowedEvidenceIds: string[] }> };
    }>;
  };
  requiredTopics: Array<{ componentId: string; topics: RequiredTopicProvenance[] }>;
}): ClaimProvenanceResult {
  const violations: ClaimProvenanceViolation[] = [];
  const preFinalByComponent = new Map<string, CalibratedClaim[]>();
  for (const c of args.preFinalClaims) {
    if (!preFinalByComponent.has(c.componentId)) preFinalByComponent.set(c.componentId, []);
    preFinalByComponent.get(c.componentId)!.push(c);
  }

  for (const output of args.finalizerOutputs) {
    const plan = args.actionPlan.plans.find(p => p.componentId === output.componentId);
    if (!plan) {
      violations.push({
        componentId: output.componentId,
        code: "FINALIZER_CLAIM_SET_VIOLATION",
        message: "No action plan found for component.",
      });
      continue;
    }

    const preFinalClaims = preFinalByComponent.get(output.componentId) || [];
    const preFinalClaimIds = new Set(preFinalClaims.map(c => c.claimId));

    // Phase 21: Check for individually missing required fields.
    // For non-FREEZE actions, all three fields must be PRESENT (not undefined).
    // Missing any field = FINALIZER_GUARD_INCOMPLETE.
    const hasRetained = "retainedClaimIds" in output && output.retainedClaimIds !== undefined;
    const hasRemoved = "removedClaimIds" in output && output.removedClaimIds !== undefined;
    const hasRepair = "repairClaims" in output && output.repairClaims !== undefined;
    if (plan.action !== "FREEZE" && (!hasRetained || !hasRemoved || !hasRepair)) {
      const missing: string[] = [];
      if (!hasRetained) missing.push("retainedClaimIds");
      if (!hasRemoved) missing.push("removedClaimIds");
      if (!hasRepair) missing.push("repairClaims");
      violations.push({
        componentId: output.componentId,
        code: "FINALIZER_GUARD_INCOMPLETE",
        message: `Finalizer missing required claim metadata fields [${missing.join(", ")}] for ${plan.action} action.`,
      });
      continue;
    }
    // Phase 19: Fail-closed on missing claim provenance metadata.
    // Only FREEZE with byte-for-byte unchanged text may deterministically
    // infer the claim set (all retained). All other actions must fail.
    // Phase 34C: Zero-claim edge case — if there are no pre-final claims
    // for this component, empty retained/removed arrays are VALID.
    const metadataMissing = (output.retainedClaimIds?.length ?? 0) === 0 && (output.removedClaimIds?.length ?? 0) === 0;
    if (metadataMissing) {
      if (plan.action === "FREEZE") {
        // Deterministic inference: if text is byte-for-byte identical to pre-final,
        // all claims are retained. This is mathematically certain.
        const preFinalText = (args.preFinalClaims.find(c => c.componentId === output.componentId)?.rewrittenText || "").trim();
        const finalizerText = (output.text || "").trim();
        if (preFinalText && finalizerText && preFinalText === finalizerText) {
          // Safe deterministic inference: byte-for-byte unchanged — skip further checks
          // Phase 21: Record that claim metadata was deterministically inferred.
          // claimMetadataSource = DETERMINISTIC_FREEZE_INFERENCE
          continue;
        }
      }
      // Phase 34C: Zero-claim edge case — no claims to classify
      if (preFinalClaims.length === 0) {
        continue;
      }
      // COMPRESS, REPAIR, COMPRESS_AND_REPAIR, or FREEZE with changed text:
      // missing metadata is a guard failure
      violations.push({
        componentId: output.componentId,
        code: "FINALIZER_GUARD_INCOMPLETE",
        message: "Finalizer returned empty retainedClaimIds and removedClaimIds for " + plan.action + " action. Missing claim provenance metadata. Only FREEZE with byte-for-byte unchanged text may deterministically infer the claim set.",
      });
      continue;
    }

    const retainedSet = new Set(output.retainedClaimIds || []);
    const removedSet = new Set(output.removedClaimIds || []);

    // Check 1: All retainedClaimIds must exist in pre-final
    for (const id of (output.retainedClaimIds || [])) {
      if (!preFinalClaimIds.has(id)) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_UNKNOWN_CLAIM",
          claimId: id,
          message: `Finalizer retained unknown claim ID "${id}" not in pre-final claim set.`,
        });
      }
    }

    // Check 2: All removedClaimIds must exist in pre-final
    for (const id of (output.removedClaimIds || [])) {
      if (!preFinalClaimIds.has(id)) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_UNKNOWN_CLAIM",
          claimId: id,
          message: `Finalizer removed unknown claim ID "${id}" not in pre-final claim set.`,
        });
      }
    }

    // Check 3: retained + removed = pre-final set (no claims unaccounted for)
    const allAccounted = new Set(Array.from(retainedSet).concat(Array.from(removedSet)));
    for (const preClaim of preFinalClaims) {
      if (!allAccounted.has(preClaim.claimId)) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_CLAIM_SET_VIOLATION",
          claimId: preClaim.claimId,
          message: `Pre-final claim "${preClaim.claimId}" is neither retained nor removed by Finalizer.`,
        });
      }
    }

    // Phase 21 Check 3b: retained ∩ removed = ∅ (no claim in both sets)
    for (const id of (output.retainedClaimIds || [])) {
      if (removedSet.has(id)) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_CLAIM_SET_VIOLATION",
          claimId: id,
          message: `Claim "${id}" appears in both retainedClaimIds and removedClaimIds.`,
        });
      }
    }

    // Phase 21 Check 3c: No duplicate IDs within retained or removed
    const retainedDuplicates = (output.retainedClaimIds || []).filter((id: string, i: number) => (output.retainedClaimIds || []).indexOf(id) !== i);
    const removedDuplicates = (output.removedClaimIds || []).filter((id: string, i: number) => (output.removedClaimIds || []).indexOf(id) !== i);
    for (const id of Array.from(new Set([...retainedDuplicates, ...removedDuplicates]))) {
      violations.push({
        componentId: output.componentId,
        code: "FINALIZER_CLAIM_SET_VIOLATION",
        claimId: id,
        message: `Duplicate claim ID "${id}" in retained or removed claim lists.`,
      });
    }

    // Check 4: FREEZE — claim set must be identical
    if (plan.action === "FREEZE") {
      if (retainedSet.size !== preFinalClaimIds.size || Array.from(retainedSet).some(id => !preFinalClaimIds.has(id))) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_CLAIM_SET_VIOLATION",
          message: "FREEZE component claim set changed.",
        });
      }
      if ((output.repairClaims?.length ?? 0) > 0) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_UNAUTHORIZED_REPAIR",
          message: "FREEZE component must not have repair claims.",
        });
      }
    }

    // Check 5: COMPRESS — no new claims (no repair claims allowed)
    if (plan.action === "COMPRESS") {
      if (output.repairClaims.length > 0) {
        violations.push({
          componentId: output.componentId,
          code: "FINALIZER_NEW_FACTUAL_CLAIM",
          message: "COMPRESS action must not introduce repair claims. New factual claims are forbidden during compression.",
        });
      }
      // retained must be subset of pre-final (already checked above)
    }

    // Check 6: TARGETED_COMPLIANCE_REPAIR / COMPRESS_AND_REPAIR — repair claims allowed with constraints
    const isRepair = plan.action === "TARGETED_COMPLIANCE_REPAIR" || plan.action === "COMPRESS_AND_REPAIR";
    if (isRepair) {
      const missingTopicsSet = new Set(plan.missingTopics);
      const topicEvidenceMap = new Map((plan.topicEvidence || []).map(t => [t.topic, t.allowedEvidenceIds]));

      for (const repair of output.repairClaims) {
        // Repair topic must be a missing topic
        if (!missingTopicsSet.has(repair.topicId)) {
          violations.push({
            componentId: output.componentId,
            code: "FINALIZER_UNAUTHORIZED_REPAIR",
            message: `Repair claim for topic "${repair.topicId}" is not an authorized missing topic.`,
          });
        }

        // Repair evidence IDs must be in the allowed list for that topic
        const allowedIds = topicEvidenceMap.get(repair.topicId) || [];
        const allowedSet = new Set(allowedIds);
        for (const eid of repair.evidenceIds) {
          if (!allowedSet.has(eid)) {
            violations.push({
              componentId: output.componentId,
              code: "FINALIZER_EVIDENCE_VIOLATION",
              evidenceId: eid,
              message: `Repair claim for topic "${repair.topicId}" uses unauthorized evidence ID "${eid}".`,
            });
          }
        }

        // Repair evidence IDs must be non-empty
        if (repair.evidenceIds.length === 0) {
          violations.push({
            componentId: output.componentId,
            code: "FINALIZER_EVIDENCE_VIOLATION",
            message: `Repair claim for topic "${repair.topicId}" has no evidence IDs.`,
          });
        }
      }
    }

    // Check 7: Non-repair actions must not have repair claims
    if (!isRepair && output.repairClaims.length > 0) {
      violations.push({
        componentId: output.componentId,
        code: "FINALIZER_UNAUTHORIZED_REPAIR",
        message: "Non-repair action must not have repair claims.",
      });
    }

    // Check 8: Required topic preservation — compression cannot remove the last supported claim for a mandatory topic
    const componentTopics = args.requiredTopics.find(rt => rt.componentId === output.componentId);
    if (componentTopics && (plan.action === "COMPRESS" || plan.action === "COMPRESS_AND_REPAIR")) {
      for (const topic of componentTopics.topics) {
        if (!topic.mandatory) continue;
        // Check if any retained claim or repair claim covers this topic
        const retainedClaimsForTopic = preFinalClaims.filter(c => retainedSet.has(c.claimId));
        const hasRepairForTopic = output.repairClaims.some(rc => rc.topicId === topic.topicId || rc.topicId === topic.text);
        
        // If no retained claims and no repair for this mandatory topic, check if there were any pre-final claims for it
        // This is a simplified check — the actual topic-claim mapping is semantic
        // We check if the topic was covered before and is now lost
        const wasMissing = plan.missingTopics.includes(topic.text) || plan.missingTopics.includes(topic.topicId);
        if (wasMissing && !hasRepairForTopic) {
          // Topic was already missing and no repair was done — this should have been caught earlier
          // But if the topic was missing and there's no repair, it's a required topic lost
          violations.push({
            componentId: output.componentId,
            code: "FINALIZER_REQUIRED_TOPIC_LOST",
            message: `Mandatory topic "${topic.text}" was missing and no repair claim was provided.`,
          });
        }
      }
    }
  }

  const claimSetHash = hashClaimSet(args.preFinalClaims);
  return {
    valid: violations.length === 0,
    violations,
    writerClaimCount: 0, // Set by caller
    calibratedClaimCount: args.preFinalClaims.length,
    finalizerClaimCount: args.finalizerOutputs.length,
    claimSetHash,
  };
}

/* ------------------------------------------------------------------ */
/* Missing Mandatory Topic Check                                      */
/* ------------------------------------------------------------------ */

export function checkMissingMandatoryTopics(args: {
  actionPlan: {
    plans: Array<{
      componentId: string;
      action: string;
      missingTopics: string[];
      topicEvidence?: Array<{ topic: string; allowedEvidenceIds: string[] }>;
    }>;
  };
  requiredTopics: Array<{ componentId: string; topics: RequiredTopicProvenance[] }>;
}): { blocked: boolean; blockingReasons: Array<{ componentId: string; topic: string; reason: string }> } {
  const blockingReasons: Array<{ componentId: string; topic: string; reason: string }> = [];

  for (const plan of args.actionPlan.plans) {
    const componentTopics = args.requiredTopics.find(rt => rt.componentId === plan.componentId);
    if (!componentTopics) continue;

    for (const topic of componentTopics.topics) {
      if (!topic.mandatory) continue;
      const isMissing = plan.missingTopics.includes(topic.text) || plan.missingTopics.includes(topic.topicId);
      if (!isMissing) continue;

      // Check if there's adequate evidence for this topic
      const topicEvidence = plan.topicEvidence?.find(te => te.topic === topic.text || te.topic === topic.topicId);
      const hasAdequateEvidence = topicEvidence && topicEvidence.allowedEvidenceIds.length > 0;

      if (!hasAdequateEvidence) {
        blockingReasons.push({
          componentId: plan.componentId,
          topic: topic.text,
          reason: `MISSING_REQUIRED_STUDENT_INFORMATION: Mandatory topic "${topic.text}" has no authorized evidence. Pipeline must fail closed.`,
        });
      }
    }
  }

  return {
    blocked: blockingReasons.length > 0,
    blockingReasons,
  };
}
