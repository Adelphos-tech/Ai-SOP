// ============================================================
// INTAKE PROFILE — FORM SCHEMA (React Hook Form + Zod)
// ============================================================
// STRUCTURAL validation only — this is NOT application readiness.
//
//   Zod:       "is this field/form structurally valid?"
//   readiness: "is this application sufficiently complete?"
//              → stays in calculateIntakeCompletion / getProfileReadiness
//
// Everything is OPTIONAL: intake is a draft — sections may be
// legitimately empty and still savable (readiness marks them missing).
// .passthrough() everywhere so unregistered canonical fields
// (linkedin, github, _revision, publications, research, …) survive
// the getValues() → PUT round trip untouched.
// ============================================================

import { z } from "zod";

const optStr = z.string().optional();
const email = z
  .string()
  .optional()
  .refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address");

const personalData = z
  .object({
    firstName: optStr,
    lastName: optStr,
    email,
    phone: optStr,
    dateOfBirth: optStr,
    nationality: optStr,
    currentCity: optStr,
    currentCountry: optStr,
    linkedin: optStr,
    github: optStr,
  })
  .passthrough()
  .optional();

const educationItem = z
  .object({
    id: optStr,
    level: optStr,
    institution: optStr,
    degree: optStr,
    specialization: optStr,
    startYear: optStr,
    endYear: optStr,
    cgpa: optStr,
    cgpaScale: optStr,
    percentage: optStr,
    backlogs: optStr,
    status: optStr,
  })
  .passthrough();

const projectItem = z
  .object({
    id: optStr,
    name: optStr,
    type: optStr,
    description: optStr,
    role: optStr,
    objective: optStr,
    technologies: optStr,
    methods: optStr,
    outcome: optStr,
    challenges: optStr,
    whatLearned: optStr,
    whyChosen: optStr,
  })
  .passthrough();

const subjectItem = z
  .object({ id: optStr, name: optStr, topics: optStr, relevance: optStr })
  .passthrough();

const experienceItem = z
  .object({
    id: optStr,
    type: optStr,
    organization: optStr,
    role: optStr,
    location: optStr,
    startDate: optStr,
    endDate: optStr,
    currentlyWorking: z.boolean().optional(),
    responsibilities: optStr,
    achievements: optStr,
    skillsUsed: optStr,
    keyLearning: optStr,
    relevanceToMasters: optStr,
  })
  .passthrough();

const skills = z
  .object({
    technical: z.array(z.string()).optional(),
    programming: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    software: z.array(z.string()).optional(),
    domain: z.array(z.string()).optional(),
    soft: z.array(z.string()).optional(),
  })
  .passthrough()
  .optional();

const noteItem = z
  .object({ id: optStr, type: optStr, content: optStr })
  .passthrough();

export const IntakeProfileSchema = z
  .object({
    personalData,
    education: z.array(educationItem).optional(),
    fieldMotivation: optStr,
    projects: z.array(projectItem).optional(),
    subjects: z.array(subjectItem).optional(),
    skills,
    experience: z.array(experienceItem).optional(),
    noWorkExperience: z.boolean().optional(),
    mastersMotivation: z
      .object({
        whyField: optStr,
        whyNow: optStr,
        skillGaps: optStr,
        academicMotivation: optStr,
        professionalMotivation: optStr,
        expectedLearning: optStr,
        careerSupport: optStr,
      })
      .passthrough()
      .optional(),
    countryQuestionnaire: z
      .object({
        countryCode: optStr,
        answers: z.record(z.string(), z.string()).optional(),
      })
      .passthrough()
      .optional(),
    subjectRequirements: z
      .object({ notes: z.array(noteItem).optional() })
      .passthrough()
      .optional(),
    universityRequirements: z
      .object({
        promptText: optStr,
        wordMin: optStr,
        wordMax: optStr,
        characterLimit: optStr,
        pageLimit: optStr,
        mandatoryTopics: optStr,
        specificQuestions: optStr,
        formattingRules: optStr,
        officialSourceUrl: optStr,
      })
      .passthrough()
      .optional(),
    careerGoals: z
      .object({
        shortTerm: z
          .object({ role: optStr, industry: optStr, responsibilities: optStr, location: optStr })
          .passthrough()
          .optional(),
        longTerm: z
          .object({ vision: optStr, goals: optStr, impact: optStr, homeCountryPlans: optStr })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type IntakeProfileForm = z.infer<typeof IntakeProfileSchema>;
