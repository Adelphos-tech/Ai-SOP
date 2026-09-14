// ============================================================
// AI PAGE CLASSIFIER + REQUIREMENTS EXTRACTOR
// Phase SOP-AI-27
// ============================================================
// AI is used for:
//   1. Page classification (is this page relevant? what type?)
//   2. Structured extraction (what are the requirements?)
//
// AI is NEVER the source of truth. Every extracted field must
// be supported by evidence text from the official page.
// ============================================================

import { getOpenAIClient } from "../ai/openai-client";
import { DISCOVERY_MODEL, DISCOVERY_TEMPERATURE, DISCOVERY_MAX_TOKENS } from "./discovery-types";
import {
  PageClassification,
  ExtractedRequirements,
  ExtractedField,
  CandidateSourceType,
  SourceScope,
} from "./discovery-types";
import { RequirementStatus } from "./types";

// ============================================================
// PAGE CLASSIFICATION
// ============================================================

export async function classifyPage(args: {
  url: string;
  title: string;
  headings: string[];
  extractedText: string;
  applicationIdentity: { university: string; program: string; degree: string; intake: string; country: string };
}): Promise<PageClassification | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const textSnippet = args.extractedText.substring(0, 3000);
  const headingsText = args.headings.join(" | ").substring(0, 500);

  const systemPrompt = `You are an official university admissions page classifier. You classify pages for relevance to application requirements discovery.

You MUST return ONLY valid JSON with this exact schema:
{
  "pageType": one of ["PROGRAM_REQUIREMENTS", "APPLICATION_REQUIREMENTS", "STATEMENT_REQUIREMENTS", "PERSONAL_STATEMENT_REQUIREMENTS", "AI_USAGE_POLICY", "GRADUATE_ADMISSIONS_POLICY", "FACULTY_DIRECTORY", "PROGRAM_FACULTY", "OFFICIAL_PDF", "OTHER_OFFICIAL"],
  "relevance": one of ["HIGH", "MEDIUM", "LOW", "NONE"],
  "scope": one of ["UNIVERSITY", "GRADUATE_SCHOOL", "SCHOOL", "DEPARTMENT", "PROGRAM", "APPLICATION", "INTAKE_SPECIFIC"],
  "programMatch": boolean,
  "intakeMatch": boolean,
  "usefulFor": string[],
  "confidence": number (0-1)
}

Rules:
- You can ONLY classify based on the provided page content.
- You CANNOT determine if a page is official — that is determined by domain verification.
- If the page does not mention application requirements, statement of purpose, or AI policy, return relevance "NONE".
- If the page mentions the specific program, set programMatch true.
- Be conservative: when in doubt, return lower relevance.`;

  const userPrompt = `Application: ${args.applicationIdentity.university} ${args.applicationIdentity.program} ${args.applicationIdentity.degree}

URL: ${args.url}
Title: ${args.title}
Headings: ${headingsText}

Page text (first 3000 chars):
${textSnippet}

Classify this page:`;

  try {
    const response = await client.chat.completions.create({
      model: DISCOVERY_MODEL,
      temperature: DISCOVERY_TEMPERATURE,
      max_completion_tokens: DISCOVERY_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    return {
      pageType: parsed.pageType as CandidateSourceType,
      relevance: parsed.relevance as "HIGH" | "MEDIUM" | "LOW" | "NONE",
      scope: parsed.scope as SourceScope,
      programMatch: Boolean(parsed.programMatch),
      intakeMatch: Boolean(parsed.intakeMatch),
      usefulFor: Array.isArray(parsed.usefulFor) ? parsed.usefulFor : [],
      confidence: Number(parsed.confidence) || 0,
      model: DISCOVERY_MODEL,
    };
  } catch (err: any) {
    console.error("[discovery] Page classification failed:", err?.message);
    return null;
  }
}

// ============================================================
// REQUIREMENTS EXTRACTION
// ============================================================

export async function extractRequirementsFromPage(args: {
  url: string;
  sourceId: string;
  sourceScope: SourceScope;
  extractedText: string;
  applicationIdentity: { university: string; program: string; degree: string; intake: string; country: string };
}): Promise<ExtractedRequirements | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const textSnippet = args.extractedText.substring(0, 6000);

  const systemPrompt = `You are an official university application requirements extractor. You extract structured requirements from official university admissions pages.

CRITICAL RULES:
1. You may ONLY extract information that is EXPLICITLY stated in the provided page text.
2. You may NOT use your own knowledge about the university or program.
3. You may NOT infer, guess, or fill in missing information.
4. For every field you extract, you MUST provide the exact evidence text from the page that supports it.
5. If a field is not mentioned in the page text, set its status to "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" and value to null.
6. If the page mentions an AI/ChatGPT/Generative AI policy, extract it. If not, set AI policy fields to null with status "NOT_SPECIFIED_BY_OFFICIAL_SOURCE".

You MUST return ONLY valid JSON with this exact schema:
{
  "sopRequired": { "value": boolean|null, "evidenceText": "exact quote from page", "confidence": 0-1 },
  "documentName": { "value": string|null, "evidenceText": "...", "confidence": 0-1 },
  "officialPrompt": { "value": string|null, "evidenceText": "...", "confidence": 0-1 },
  "numberOfComponents": { "value": number|null, "evidenceText": "...", "confidence": 0-1 },
  "wordMin": { "value": number|null, "evidenceText": "...", "confidence": 0-1 },
  "wordMax": { "value": number|null, "evidenceText": "...", "confidence": 0-1 },
  "characterLimit": { "value": number|null, "evidenceText": "...", "confidence": 0-1 },
  "pageMax": { "value": number|null, "evidenceText": "...", "confidence": 0-1 },
  "formattingRequirements": { "value": string[], "evidenceText": "...", "confidence": 0-1 },
  "mandatoryTopics": { "value": string[], "evidenceText": "...", "confidence": 0-1 },
  "facultyRequired": { "value": boolean|null, "evidenceText": "...", "confidence": 0-1 },
  "programSpecificInstructions": { "value": string|null, "evidenceText": "...", "confidence": 0-1 },
  "aiGenerationPolicy": { "value": string|null, "evidenceText": "...", "confidence": 0-1 },
  "aiEditingPolicy": { "value": string|null, "evidenceText": "...", "confidence": 0-1 },
  "aiProofreadingPolicy": { "value": string|null, "evidenceText": "...", "confidence": 0-1 },
  "aiBrainstormingPolicy": { "value": string|null, "evidenceText": "...", "confidence": 0-1 }
}`;

  const userPrompt = `Application: ${args.applicationIdentity.university} ${args.applicationIdentity.program} ${args.applicationIdentity.degree}

URL: ${args.url}

Page text:
${textSnippet}

Extract all application requirements from this page. Remember: ONLY extract what is EXPLICITLY stated. Include evidence text for every field.`;

  try {
    const response = await client.chat.completions.create({
      model: DISCOVERY_MODEL,
      temperature: DISCOVERY_TEMPERATURE,
      max_completion_tokens: DISCOVERY_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    return buildExtractedRequirements(parsed, args.url, args.sourceId, args.sourceScope);
  } catch (err: any) {
    console.error("[discovery] Requirements extraction failed:", err?.message);
    return null;
  }
}

function buildExtractedRequirements(
  parsed: any,
  url: string,
  sourceId: string,
  scope: SourceScope,
): ExtractedRequirements {
  const makeField = (fieldName: string, raw: any): ExtractedField => {
    if (!raw || typeof raw !== "object") {
      return {
        fieldName,
        value: null,
        status: "NOT_SPECIFIED_BY_OFFICIAL_SOURCE",
        evidenceText: "",
        sourceId,
        sourceUrl: url,
        sourceScope: scope,
        confidence: 0,
        extractionMethod: "AI" as const,
      };
    }
    const hasValue = raw.value !== null && raw.value !== undefined;
    return {
      fieldName,
      value: raw.value,
      status: hasValue ? "VERIFIED" as RequirementStatus : "NOT_SPECIFIED_BY_OFFICIAL_SOURCE" as RequirementStatus,
      evidenceText: raw.evidenceText || "",
      sourceId,
      sourceUrl: url,
      sourceScope: scope,
      confidence: Number(raw.confidence) || 0,
      extractionMethod: "AI" as const,
    };
  };

  return {
    sopRequired: makeField("sopRequired", parsed.sopRequired),
    documentName: makeField("documentName", parsed.documentName),
    officialPrompt: makeField("officialPrompt", parsed.officialPrompt),
    numberOfComponents: makeField("numberOfComponents", parsed.numberOfComponents),
    wordMin: makeField("wordMin", parsed.wordMin),
    wordMax: makeField("wordMax", parsed.wordMax),
    characterLimit: makeField("characterLimit", parsed.characterLimit),
    pageMax: makeField("pageMax", parsed.pageMax),
    formattingRequirements: makeField("formattingRequirements", parsed.formattingRequirements),
    mandatoryTopics: makeField("mandatoryTopics", parsed.mandatoryTopics),
    facultyRequired: makeField("facultyRequired", parsed.facultyRequired),
    programSpecificInstructions: makeField("programSpecificInstructions", parsed.programSpecificInstructions),
    aiGenerationPolicy: makeField("aiGenerationPolicy", parsed.aiGenerationPolicy),
    aiEditingPolicy: makeField("aiEditingPolicy", parsed.aiEditingPolicy),
    aiProofreadingPolicy: makeField("aiProofreadingPolicy", parsed.aiProofreadingPolicy),
    aiBrainstormingPolicy: makeField("aiBrainstormingPolicy", parsed.aiBrainstormingPolicy),
  };
}
