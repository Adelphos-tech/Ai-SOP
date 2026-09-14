import { LanguageProfile } from "../../types";

export function buildLanguageCalibratorPrompt(draft: string, profile: LanguageProfile): { system: string; user: string } {
  const levelMap: Record<string, string> = {
    "Simple & Clear": "Simplify unnecessary complexity. Use straightforward vocabulary, shorter to moderate sentences, clear transitions. Maintain professional grammar and natural student voice.",
    "Natural Professional": "Maintain polished natural professional English. Use accessible professional vocabulary, moderate sentence variation, clear narrative transitions. Keep it polished but believable.",
    "Advanced Academic": "Allow more advanced academic expression. Use stronger academic vocabulary, more nuanced sentence structures, sophisticated transitions. Keep it personal and readable.",
    "Consultant Polished": "Maximize polish and narrative quality. Use highly polished admissions writing, strong narrative cohesion, high-quality transitions. Sophisticated but not artificial.",
  };

  const system = `You are a language calibration expert for SOPs. You adjust the language sophistication of an SOP draft while keeping ALL factual content unchanged.

CRITICAL RULES:
- Do NOT add any new factual content
- Do NOT remove any factual content
- Do NOT invent any information
- Do NOT change names, dates, scores, institutions, or any facts
- ONLY adjust vocabulary sophistication, sentence complexity, transition complexity, and stylistic polish
- NEVER introduce grammar errors, spelling errors, or incorrect sentence structure
- Maintain correct English at all times
- Return ONLY the calibrated SOP text, no commentary, no markdown

CALIBRATION TARGET: ${levelMap[profile.level] || levelMap["Natural Professional"]}

ENGLISH PROFICIENCY CONTEXT: The student has ${profile.actualEnglishProficiency.testType || "no"} score of ${profile.actualEnglishProficiency.overallScore || "N/A"} (writing: ${profile.actualEnglishProficiency.writingScore || "N/A"}). This is context only — do NOT artificially imitate any English mistakes. Always produce correct English.

TONE: ${profile.tone}`;

  const user = `Calibrate this SOP draft to the target writing level:

${draft}

Return ONLY the calibrated SOP text.`;

  return { system, user };
}
