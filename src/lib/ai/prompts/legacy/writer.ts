import { AiInput } from "../../pipeline/build-ai-input";
import { PlannerOutput } from "../../types";

export function buildWriterPrompt(input: AiInput, plan: PlannerOutput, wordRange: { min: number; max: number }): { system: string; user: string } {
  const wp = input.writingPreferences;
  const levelInstructions: Record<string, string> = {
    "Simple & Clear": "Use straightforward vocabulary, shorter to moderate sentences, clear transitions, professional grammar, and a natural student-like voice.",
    "Natural Professional": "Use accessible professional vocabulary, moderate sentence variation, polished but believable writing, and clear narrative transitions.",
    "Advanced Academic": "Use stronger academic vocabulary, more nuanced sentence structures, sophisticated transitions, while remaining personal and readable.",
    "Consultant Polished": "Write highly polished admissions prose with strong narrative cohesion, high-quality transitions, sophisticated but not artificial language, and a strong personal voice.",
  };

  const toneInstructions: Record<string, string> = {
    "Professional & Personal": "Balance professional tone with personal voice.",
    "Academic": "Use a more academic, formal tone throughout.",
    "Story-Driven": "Emphasize narrative storytelling and personal journey.",
    "Formal": "Use a formal, structured tone.",
  };

  const openingInstructions: Record<string, string> = {
    "Natural Academic Journey": "Open with the student's natural academic development.",
    "Project/Experience Led": "Open with a significant project or work experience.",
    "Personal Story Led": "Open with a meaningful personal experience.",
    "Professional Experience Led": "Open with professional/work context.",
    "Let AI Choose Best Opening": "Choose the opening that best fits the available facts.",
  };

  const system = `You are an expert SOP writer. Write a Statement of Purpose in first person.

CRITICAL RULES:
- Use ONLY the facts provided. Never invent universities, courses, countries, grades, CGPA, percentages, dates, employers, projects, technologies, research, publications, certifications, awards, or personal history.
- If information is missing, write around it naturally without naming or hinting at it.
- Write a connected personal narrative, NOT a resume in paragraph form.
- Connect experiences: what happened → what the student did → what they learned → why it mattered → how it influenced the next step.
- Do NOT use markdown, headings, bold text, bullet points, numbered lists, or a title like "Statement of Purpose".
- Do NOT include "Here is your SOP" or any commentary.
- Return ONLY the SOP text in professional paragraphs.

WRITING LEVEL: ${levelInstructions[wp.level] || levelInstructions["Natural Professional"]}

TONE: ${toneInstructions[wp.tone] || toneInstructions["Professional & Personal"]}

OPENING: ${openingInstructions[wp.openingStyle] || openingInstructions["Let AI Choose Best Opening"]}

PERSONALIZATION: ${wp.personalization === "Highly Personalized" ? "Weave personal details deeply throughout." : wp.personalization === "Mostly Academic" ? "Focus primarily on academic and professional content." : "Balance personal and academic content."}

TECHNICAL DETAIL: ${wp.technicalDetail === "High" ? "Include detailed technical descriptions where relevant." : wp.technicalDetail === "Low" ? "Keep technical details minimal, focus on narrative." : "Include moderate technical detail."}

LENGTH: Target ${wordRange.min}-${wordRange.max} words. Do not pad with fabricated information.

${input.application.sopQuestion ? `UNIVERSITY SOP QUESTION (must be directly answered): "${input.application.sopQuestion}"` : ""}

${input.application.targetUniversity ? `Target university: ${input.application.targetUniversity}. You may name it but do NOT fabricate claims about its faculty, labs, modules, rankings, or facilities.` : "No target university provided. Do not invent one. Do not write 'your esteemed university'. Focus on the program and goals."}`;

  const user = `Write the SOP based on this plan and student facts.

WRITING PLAN:
${JSON.stringify(plan, null, 2)}

STUDENT FACTS:
${JSON.stringify(input, null, 2)}

Write the complete SOP now. Return ONLY the SOP text, no commentary, no markdown.`;

  return { system, user };
}
