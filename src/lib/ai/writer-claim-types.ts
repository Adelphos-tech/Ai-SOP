/**
 * @file writer-claim-types.ts
 * @description
 * Writer claim type taxonomy and support structure.
 *
 * Each factual/narrative proposition in the Writer output must identify
 * a claim type so downstream stages can apply type-specific rules.
 *
 * Phase SOP-AI-19.
 */

export type WriterClaimType =
  | "DIRECT_FACT"
  | "CONSERVATIVE_PARAPHRASE"
  | "INTERPRETIVE_LINK"
  | "STATED_MOTIVATION"
  | "STATED_GOAL"
  | "PROGRAM_FACT"
  | "FACULTY_FACT";

export type SupportMode = "DIRECT" | "PARAPHRASE" | "INTERPRETIVE_LINK";

/**
 * Semantic attributes that can be extracted from an approved fact.
 * Used to detect novel specificity in Writer claims.
 */
export interface FactAttributes {
  actor?: string;
  action?: string;
  object?: string;
  context?: string;
  time?: string;
  frequency?: string;
  location?: string;
  quantity?: string;
  method?: string;
  tool?: string;
  purpose?: string;
  causality?: string;
  result?: string;
  relationship?: string;
}

/**
 * Extended Writer claim metadata with type and support information.
 */
export interface WriterClaimMetadata {
  claimId: string;
  componentId: string;
  text: string;
  claimType: WriterClaimType;
  evidenceIds: string[];
  supportMode: SupportMode;
  /** Attributes the Writer asserts in this claim */
  assertedAttributes?: Partial<FactAttributes>;
  /** Attributes present in the supporting evidence */
  sourceAttributes?: Partial<FactAttributes>;
}

/**
 * Quality Reviewer claim support classification.
 */
export type ClaimSupportStatus =
  | "SUPPORTED"
  | "POTENTIALLY_UNSUPPORTED"
  | "SEMANTIC_EXPANSION"
  | "AMBIGUOUS";

export interface QualityClaimAudit {
  claimId: string;
  componentId: string;
  claimText: string;
  claimType: WriterClaimType;
  supportStatus: ClaimSupportStatus;
  reason: string;
  /** True if the claim introduces unsupported motivation/intent */
  unsupportedMotivation?: boolean;
  /** True if the claim adds novel specificity not in evidence */
  novelSpecificity?: boolean;
  /** True if the claim broadens or narrows the evidence context */
  contextShift?: boolean;
}

/**
 * Motivation/intent phrases that require explicit approved evidence.
 * If a Writer claim matches these patterns, it must be backed by
 * STATED_MOTIVATION evidence or remain a bounded INTERPRETIVE_LINK.
 */
export const MOTIVATION_PATTERNS: RegExp[] = [
  /\bi\s+(undertook|chose|decided|wanted|hoped|sought|aimed|intended)\b/i,
  /\bmy\s+(goal|aim|purpose|objective|intent|motivation)\s+(was|is|were|are)\b/i,
  /\bi\s+(chose|selected|pursued)\s+this\s+(because|to|in\s+order\s+to)\b/i,
  /\bthis\s+(motivated|inspired|drove|prompted|led)\s+me\s+to\b/i,
  /\bi\s+(wanted|hoped|sought)\s+to\s+(understand|learn|explore|investigate|examine|study)\b/i,
];

/**
 * Check if a claim text contains a motivation/intent assertion.
 */
export function containsMotivationAssertion(claimText: string): boolean {
  return MOTIVATION_PATTERNS.some(pattern => pattern.test(claimText));
}

/**
 * Novel specificity indicator phrases.
 * These patterns suggest the Writer is adding specificity not in the evidence.
 */
export const NOVEL_SPECIFICITY_PATTERNS: Record<keyof FactAttributes, RegExp[]> = {
  frequency: [/\b(every|each|weekly|daily|monthly|regularly|routinely|consistently|always)\b/i],
  location: [/\b(in|at|during|before)\s+((the|each|every)\s+)?(lab|laboratory|workshop|classroom|office|field|site|session)\b/i],
  quantity: [/\b\d+\s*(percent|%|hours?|days?|weeks?|months?|years?|times?|students?|projects?|papers?|buildings?|models?)\b/i],
  time: [/\b(in\s+\d{4}|last\s+(year|month|week|summer)|during\s+(my\s+)?(first|second|third|final)\s+(year|semester|month))\b/i],
  method: [/\b(using|via|through|by\s+means\s+of|employing|applying)\s+(finite\s+element|response\s+spectrum|modal|time\s+history|pushover)\b/i],
  tool: [/\b(MATLAB|SAP2000|ETABS|STAAD\.Pro|ANSYS|Abaqus|Python|R|Excel|AutoCAD|Revit|ETABS)\b/i],
  purpose: [/\b(to\s+(understand|determine|evaluate|assess|identify|examine|investigate|improve|optimize|reduce|minimize|maximize))\b/i],
  causality: [/\b(because|due\s+to|as\s+a\s+result\s+of|consequently|therefore|thus|hence|leading\s+to|resulting\s+in)\b/i],
  result: [/\b(reduced|improved|increased|decreased|achieved|obtained|yielded|produced|demonstrated|showed)\b/i],
  relationship: [/\b(under\s+the\s+supervision\s+of|advised\s+by|mentored\s+by|collaborated\s+with|in\s+partnership\s+with)\b/i],
  actor: [],
  action: [],
  object: [],
  context: [],
};

/**
 * Check if a claim text contains novel specificity patterns for a given
 * attribute type that are NOT present in the source evidence text.
 */
export function detectNovelSpecificity(
  claimText: string,
  sourceText: string
): { attribute: keyof FactAttributes; pattern: string }[] {
  const novel: { attribute: keyof FactAttributes; pattern: string }[] = [];

  for (const [attr, patterns] of Object.entries(NOVEL_SPECIFICITY_PATTERNS)) {
    for (const pattern of patterns) {
      const claimMatch = claimText.match(pattern);
      if (claimMatch && !pattern.test(sourceText)) {
        novel.push({ attribute: attr as keyof FactAttributes, pattern: claimMatch[0] });
      }
    }
  }

  return novel;
}
