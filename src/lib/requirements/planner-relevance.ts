/**
 * @file planner-relevance.ts
 * @description
 * Course Relevance Engine — selects student facts based on relevance
 * to the VERIFIED target program.
 *
 * The Planner should select student facts based on relevance to:
 *   - target program
 *   - official prompt
 *   - required topics
 *   - verified program context
 *   - career goals
 *
 * Do NOT select facts based on invented curriculum knowledge.
 */

import { FactRelevanceDecision, RequiredTopicMapping, MissingRequiredInfo, PlannerRelevanceOutput } from "./generation-contract-types";

/* ------------------------------------------------------------------ */
/* Student fact extraction helpers                                     */
/* ------------------------------------------------------------------ */

interface StudentFact {
  factId: string;
  factType: string;
  content: string;
}

function extractStudentFacts(profile: any): StudentFact[] {
  const facts: StudentFact[] = [];

  // Education
  if (profile?.education) {
    profile.education.forEach((e: any, i: number) => {
      facts.push({
        factId: `education-${i}`,
        factType: "education",
        content: [e.degree, e.specialization, e.institution, e.cgpa, e.percentage].filter(Boolean).join(" "),
      });
    });
  }

  // Experience
  if (profile?.experience) {
    profile.experience.forEach((e: any, i: number) => {
      facts.push({
        factId: `experience-${i}`,
        factType: "experience",
        content: [e.role, e.organization, e.responsibilities, e.keyAchievements, e.skillsLearned].filter(Boolean).join(" "),
      });
    });
  }

  // Projects
  if (profile?.projects) {
    profile.projects.forEach((p: any, i: number) => {
      facts.push({
        factId: `project-${i}`,
        factType: "project",
        content: [p.name, p.description, p.studentRole, p.technologies, p.outcome, p.whatLearned].filter(Boolean).join(" "),
      });
    });
  }

  // Research
  if (profile?.research) {
    profile.research.forEach((r: any, i: number) => {
      facts.push({
        factId: `research-${i}`,
        factType: "research",
        content: [r.topic, r.institution, r.role, r.description, r.outcome].filter(Boolean).join(" "),
      });
    });
  }

  // Publications
  if (profile?.publications) {
    profile.publications.forEach((p: any, i: number) => {
      facts.push({
        factId: `publication-${i}`,
        factType: "publication",
        content: [p.title, p.venue, p.status, p.year].filter(Boolean).join(" "),
      });
    });
  }

  // Achievements
  if (profile?.achievements) {
    profile.achievements.forEach((a: any, i: number) => {
      facts.push({
        factId: `achievement-${i}`,
        factType: "achievement",
        content: [a.title, a.description, a.year].filter(Boolean).join(" "),
      });
    });
  }

  // Career goals
  if (profile?.careerGoals) {
    const cg = profile.careerGoals;
    facts.push({
      factId: "career-goals",
      factType: "careerGoals",
      content: [cg.whyField, cg.whyProgram, cg.shortTermGoals, cg.longTermGoals, cg.desiredRole, cg.industries].filter(Boolean).join(" "),
    });
  }

  // Personal story
  if (profile?.personalStory) {
    const ps = profile.personalStory;
    facts.push({
      factId: "personal-story",
      factType: "personalStory",
      content: [ps.motivation, ps.influencingExperience, ps.challenges, ps.proudOf, ps.qualities].filter(Boolean).join(" "),
    });
  }

  return facts;
}

/* ------------------------------------------------------------------ */
/* Topic keyword matching                                              */
/* ------------------------------------------------------------------ */

function getTopicKeywords(topic: string): string[] {
  const lower = topic.toLowerCase();
  const keywords: string[] = [lower];

  // Map common required topics to relevant student fact types/keywords
  const topicMap: Record<string, string[]> = {
    "academic preparation": ["education", "degree", "specialization", "cgpa", "course", "academic", "transcript", "training"],
    "academic": ["education", "degree", "specialization", "cgpa", "course", "academic", "transcript", "training"],
    "research interests": ["research", "publication", "project", "thesis", "investigation", "study"],
    "research": ["research", "publication", "project", "thesis", "investigation", "study"],
    "professional experience": ["experience", "work", "internship", "job", "role", "organization", "professional"],
    "experience": ["experience", "work", "internship", "job", "role", "organization"],
    "motivation": ["motivation", "personal", "story", "why", "influence", "inspire"],
    "career goals": ["career", "goal", "future", "role", "industry", "short term", "long term"],
    "career": ["career", "goal", "future", "role", "industry"],
    "career objectives": ["career", "goal", "future", "role", "industry", "objective"],
    "why program": ["why", "program", "career", "goal", "interest"],
    "why this program": ["why", "program", "career", "goal", "interest"],
    "personal background": ["personal", "story", "background", "family", "challenge", "quality"],
    "personal": ["personal", "story", "background", "family", "challenge"],
    "experiences": ["experience", "project", "research", "education", "personal", "training"],
    "interests": ["interest", "research", "project", "career", "why"],
    "future goals": ["career", "goal", "future", "role", "industry"],
    "labs": ["research", "project", "lab", "technology", "technologies"],
    "past work": ["experience", "project", "research", "publication", "work"],
    "classroom": ["education", "course", "academic", "degree", "training"],
    "purpose": ["career", "goal", "why", "motivation", "program", "future", "objective", "interest"],
    "graduate school": ["career", "goal", "why", "motivation", "program", "future", "education"],
    "faculty": ["faculty", "professor", "research", "advisor", "mentor", "lab"],
    "motivation for the work": ["motivation", "why", "personal", "story", "influence", "inspire", "interest"],
    "responsibilities and tasks": ["experience", "work", "internship", "role", "responsibilities", "task", "duty"],
    "conclusions": ["conclusion", "outcome", "result", "finding", "achievement", "learning"],
    "unforeseen challenges": ["challenge", "obstacle", "difficulty", "problem", "overcome", "adapt"],
    "why graduate school": ["career", "goal", "why", "motivation", "program", "future", "objective"],
    "research interests at mit": ["research", "interest", "project", "career", "why", "field"],
    "mit faculty members": ["faculty", "professor", "research", "advisor"],
    "academic or research experience": ["academic", "research", "experience", "education", "project", "thesis", "investigation", "study", "work", "internship"],
  };

  for (const [key, vals] of Object.entries(topicMap)) {
    if (lower.includes(key)) {
      keywords.push(...vals);
      break;
    }
  }

  // Do NOT add general keywords — they cause false positives.
  // Only topic-specific keywords should be used for matching.
  return Array.from(new Set(keywords));
}

function factMatchesTopic(fact: StudentFact, topic: string): boolean {
  // If the fact content is empty or trivially short, it doesn't match
  // even if the fact type name contains a keyword.
  if (!fact.content || fact.content.trim().length < 5) {
    return false;
  }

  const keywords = getTopicKeywords(topic);
  const factLower = fact.content.toLowerCase();
  const factTypeLower = fact.factType.toLowerCase();

  // Check if any keyword matches in content or fact type
  for (const kw of keywords) {
    if (factLower.includes(kw) || factTypeLower.includes(kw)) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Map required topics to student facts                                */
/* ------------------------------------------------------------------ */

/**
 * Map each official required topic to student evidence.
 *
 * If a required topic has no matching student evidence:
 *   status = "NO_STUDENT_DATA" or "INSUFFICIENT_STUDENT_DATA"
 *
 * If a required topic has matching evidence:
 *   status = "COVERED"
 */
export function mapRequiredTopicsToStudentFacts(
  requiredTopics: string[],
  profile: any
): RequiredTopicMapping[] {
  const facts = extractStudentFacts(profile);

  return requiredTopics.map(topic => {
    const matchingFacts = facts.filter(f => factMatchesTopic(f, topic));

    if (matchingFacts.length === 0) {
      return {
        requiredTopic: topic,
        studentEvidence: [],
        status: "NO_STUDENT_DATA" as const,
        reason: `No student evidence found for required topic: "${topic}"`,
      };
    }

    // Check if the evidence is substantial (not just empty fields)
    const substantialFacts = matchingFacts.filter(f => f.content.trim().length > 10);

    if (substantialFacts.length === 0) {
      return {
        requiredTopic: topic,
        studentEvidence: matchingFacts.map(f => f.factId),
        status: "INSUFFICIENT_STUDENT_DATA" as const,
        reason: `Student evidence for "${topic}" exists but is insubstantial.`,
      };
    }

    return {
      requiredTopic: topic,
      studentEvidence: substantialFacts.map(f => f.factId),
      status: "COVERED" as const,
      reason: `${substantialFacts.length} student fact(s) support this topic.`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Compute fact relevance                                              */
/* ------------------------------------------------------------------ */

/**
 * Compute relevance of each student fact to the target program.
 */
export function computeFactRelevance(
  profile: any,
  requiredTopics: string[],
  programContext: any | null = null
): FactRelevanceDecision[] {
  const facts = extractStudentFacts(profile);

  return facts.map(fact => {
    let matchCount = 0;
    const matchedTopics: string[] = [];

    for (const topic of requiredTopics) {
      if (factMatchesTopic(fact, topic)) {
        matchCount++;
        matchedTopics.push(topic);
      }
    }

    let relevance: "HIGH" | "MEDIUM" | "LOW" | "IRRELEVANT";
    let useInSop: boolean;

    if (matchCount >= 2) {
      relevance = "HIGH";
      useInSop = true;
    } else if (matchCount === 1) {
      relevance = "MEDIUM";
      useInSop = true;
    } else if (fact.content.length > 50) {
      relevance = "LOW";
      useInSop = false;
    } else {
      relevance = "IRRELEVANT";
      useInSop = false;
    }

    return {
      factId: fact.factId,
      factType: fact.factType,
      relevance,
      reason: `Matches ${matchCount} required topic(s): ${matchedTopics.join(", ") || "none"}`,
      useInSop,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Check for material missing info                                     */
/* ------------------------------------------------------------------ */

/**
 * Determine if any missing required information is material (should block).
 *
 * Topics that are considered material:
 *   - academic preparation
 *   - research interests
 *   - career goals / career objectives
 *   - why program / why this program
 *   - experiences
 *
 * Topics that are NOT material (personal background, etc.) don't block.
 */
export function hasMaterialMissingInfo(mappings: RequiredTopicMapping[]): boolean {
  const materialTopics = [
    "academic preparation",
    "academic",
    "research interests",
    "research",
    "career goals",
    "career",
    "career objectives",
    "why program",
    "why this program",
    "experiences",
    "past work",
    "classroom",
    "purpose",
    "graduate school",
    "faculty",
    "motivation",
    "responsibilities",
    "conclusions",
    "challenges",
  ];

  for (const mapping of mappings) {
    if (mapping.status === "NO_STUDENT_DATA") {
      const topicLower = mapping.requiredTopic.toLowerCase();
      for (const mt of materialTopics) {
        if (topicLower.includes(mt)) {
          return true;
        }
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Full planner relevance output                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute the full planner relevance output.
 */
export function computePlannerRelevance(
  profile: any,
  requiredTopics: string[],
  programContext: any | null = null
): PlannerRelevanceOutput {
  const factRelevance = computeFactRelevance(profile, requiredTopics, programContext);
  const requiredTopicMappings = mapRequiredTopicsToStudentFacts(requiredTopics, profile);
  const materialMissing = hasMaterialMissingInfo(requiredTopicMappings);

  const missingRequiredInformation: MissingRequiredInfo[] = requiredTopicMappings
    .filter(m => m.status !== "COVERED")
    .map(m => ({
      requiredTopic: m.requiredTopic,
      reason: m.reason,
      studentEvidenceFields: m.studentEvidence,
    }));

  return {
    factRelevance,
    requiredTopicMappings,
    missingRequiredInformation,
    hasMaterialMissingInfo: materialMissing,
  };
}
