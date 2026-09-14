import { WritingLevel, EnglishProficiency } from "@/types";

export function recommendWritingLevel(testType: string, overallScore: string): WritingLevel | "" {
  if (!testType || testType === "None" || !overallScore) return "";
  const score = parseFloat(overallScore);
  if (isNaN(score)) return "";

  if (testType === "IELTS") {
    if (score <= 6.0) return "Simple & Clear";
    if (score <= 6.5) return "Natural Professional";
    if (score <= 7.0) return "Natural Professional";
    if (score <= 7.5) return "Advanced Academic";
    return "Advanced Academic";
  }
  if (testType === "TOEFL") {
    if (score < 80) return "Simple & Clear";
    if (score < 90) return "Natural Professional";
    if (score < 100) return "Natural Professional";
    return "Advanced Academic";
  }
  if (testType === "PTE") {
    if (score < 58) return "Simple & Clear";
    if (score < 65) return "Natural Professional";
    if (score < 73) return "Natural Professional";
    return "Advanced Academic";
  }
  if (testType === "Duolingo") {
    if (score < 95) return "Simple & Clear";
    if (score < 115) return "Natural Professional";
    if (score < 130) return "Natural Professional";
    return "Advanced Academic";
  }
  return "";
}

export const writingLevelDescriptions: Record<WritingLevel, string> = {
  "Simple & Clear": "Correct grammar, simple vocabulary, mostly direct sentences, natural student voice.",
  "Natural Professional": "Professional but accessible vocabulary, moderate sentence complexity, natural transitions, polished student voice.",
  "Advanced Academic": "Stronger academic vocabulary, more complex sentence structures, sophisticated transitions, still readable and personal.",
  "Consultant Polished": "Highly polished admissions writing, strong narrative flow, professional vocabulary, avoids sounding artificial.",
  "Custom": "Custom writing profile — configure manually.",
};

export const writingLevelPreviews: Record<string, string> = {
  "Simple & Clear": "My academic projects helped me develop an interest in Data Science.",
  "Natural Professional": "My academic projects strengthened my interest in Data Science and helped me understand how data can be used to solve practical problems.",
  "Advanced Academic": "My academic projects progressively strengthened my interest in Data Science by showing me how analytical methods can transform complex information into practical insights.",
  "Consultant Polished": "Through my academic projects, I discovered the transformative potential of Data Science — not merely as a field of study, but as a powerful lens through which complex real-world challenges can be understood and addressed.",
  "Custom": "Custom preview — configure your writing profile to see a tailored example.",
};
