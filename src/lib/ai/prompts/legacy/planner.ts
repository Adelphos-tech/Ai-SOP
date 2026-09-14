import { AiInput } from "../../pipeline/build-ai-input";

export function buildPlannerPrompt(input: AiInput): { system: string; user: string } {
  const system = `You are an expert SOP planning assistant. You do NOT write the final SOP. You analyze student facts and create a structured writing plan. Return ONLY valid JSON, no other text.

The plan must identify:
- The strongest opening direction based on available facts
- Academic journey progression
- The 2-4 most relevant projects/experiences to include
- Important achievements worth mentioning
- How motivation developed
- Why the target program makes sense for this student
- Short-term and long-term career goals connection
- Conclusion direction
- Facts that should NOT be used because they are irrelevant
- Facts that should be prioritized

Return JSON with this exact structure:
{
  "opening_strategy": "description of best opening approach",
  "academic_story": ["key academic progression points"],
  "key_experiences": ["experiences to include with why"],
  "program_connection": "how to connect student to target program",
  "career_progression": "short to long term goal narrative",
  "personalization_points": ["personal details to weave in"],
  "facts_to_prioritize": ["most important facts"],
  "facts_to_omit": ["facts that are irrelevant"]
}`;

  const user = `Analyze this student profile and create an SOP writing plan:

${JSON.stringify(input, null, 2)}

Return ONLY the JSON plan. No explanation, no markdown, no code blocks.`;

  return { system, user };
}
