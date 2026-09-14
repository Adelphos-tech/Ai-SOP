export type Gender = "" | "Male" | "Female" | "Non-binary" | "Other" | "Prefer not to say";

export type EducationLevel = "10th" | "12th" | "Diploma" | "Bachelor's" | "Master's" | "PhD" | "Other";
export type EducationStatus = "Completed" | "Ongoing";

export interface EducationRecord {
  id: string;
  level: EducationLevel | "";
  institution: string;
  board: string;
  degree: string;
  specialization: string;
  startYear: string;
  endYear: string;
  percentage: string;
  cgpa: string;
  cgpaScale: string;
  backlogs: string;
  status: EducationStatus | "";
}

export type EnglishTestType = "" | "IELTS" | "PTE" | "TOEFL" | "Duolingo" | "None" | "Other";
export type EnglishTestStatus = "Completed" | "Scheduled" | "Not Taken";

export interface EnglishProficiency {
  testType: EnglishTestType;
  status: EnglishTestStatus;
  overallScore: string;
  listening: string;
  reading: string;
  writing: string;
  speaking: string;
}

export type WritingLevel = "Simple & Clear" | "Natural Professional" | "Advanced Academic" | "Consultant Polished" | "Custom";
export type Tone = "Professional & Personal" | "Academic" | "Story-Driven" | "Formal";
export type Personalization = "Balanced" | "Highly Personalized" | "Mostly Academic";
export type TechnicalDetail = "Low" | "Medium" | "High";
export type OpeningStyle = "Natural Academic Journey" | "Project/Experience Led" | "Personal Story Led" | "Professional Experience Led" | "Let AI Choose Best Opening";
export type SOPLength = "Use University Requirement" | "500-700" | "700-900" | "900-1100" | "Custom";

export interface SopWritingProfile {
  level: WritingLevel | "";
  tone: Tone | "";
  personalization: Personalization | "";
  technicalDetail: TechnicalDetail | "";
  openingStyle: OpeningStyle | "";
  sopLength: SOPLength | "";
  customMinWords: string;
  customMaxWords: string;
}

export interface WritingPreferences {
  actualEnglishProficiency: EnglishProficiency;
  sopWritingProfile: SopWritingProfile;
}

export type ExperienceType = "Internship" | "Full-Time Work" | "Part-Time Work" | "Training";

export interface ExperienceRecord {
  id: string;
  type: ExperienceType | "";
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  currentlyWorking: boolean;
  location: string;
  responsibilities: string;
  keyAchievements: string;
  skillsLearned: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  type: string;
  description: string;
  studentRole: string;
  technologies: string;
  outcome: string;
  whatLearned: string;
}

export interface ResearchRecord {
  id: string;
  topic: string;
  institution: string;
  role: string;
  description: string;
  outcome: string;
}

export interface PublicationRecord {
  id: string;
  title: string;
  venue: string;
  status: string;
  year: string;
  link: string;
}

export type AchievementType = "Certification" | "Award" | "Academic Achievement" | "Competition" | "Scholarship" | "Volunteer Work" | "Leadership" | "Extracurricular";

export interface AchievementRecord {
  id: string;
  type: AchievementType | "";
  title: string;
  description: string;
  year: string;
}

export interface Application {
  targetCountry: string;
  targetUniversity: string;
  targetProgram: string;
  degreeLevel: string;
  intake: string;
  intakeYear: string;
  wordRequirement: "Known" | "Unknown" | "";
  minWords: string;
  maxWords: string;
  maxCharacters: string;
  sopQuestion: string;
  aiPolicyAttestation: "ALLOWED" | "PROHIBITED" | "UNKNOWN" | "";
  officialRequirementsUrl: string;
  officialAiPolicyUrl: string;
}

export interface CareerGoals {
  whyField: string;
  whyProgram: string;
  shortTermGoals: string;
  longTermGoals: string;
  desiredRole: string;
  industries: string;
  returnHomeCountry: "Yes" | "No" | "" | "Not applicable";
  returnPlans: string;
}

export interface PersonalStory {
  motivation: string;
  influencingExperience: string;
  challenges: string;
  proudOf: string;
  qualities: string;
  leadershipExample: string;
  teamworkExample: string;
  outsideAcademics: string;
  communityService: string;
  familyBackground: string;
}

export type DocumentType = "CV/Resume" | "Academic Transcript" | "Degree Certificate" | "English Test Result" | "Experience Letter" | "Internship Certificate" | "Project Document" | "Publication" | "Other";

export interface DocumentRecord {
  id: string;
  type: DocumentType | "";
  fileName: string;
  fileSize: string;
  uploadDate: string;
}

export interface PersonalDetails {
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: Gender;
  nationality: string;
  currentCity: string;
  currentCountry: string;
  languages: string;
}

export interface FactSheetApproval {
  approved: boolean;
  approvedAt: string;
  /** Whether the student has confirmed requirements on the /requirements page */
  requirementsConfirmed?: boolean;
}

export interface StudentProfile {
  personalDetails: PersonalDetails;
  education: EducationRecord[];
  englishProficiency: EnglishProficiency;
  writingPreferences: WritingPreferences;
  experience: ExperienceRecord[];
  projects: ProjectRecord[];
  research: ResearchRecord[];
  publications: PublicationRecord[];
  achievements: AchievementRecord[];
  application: Application;
  careerGoals: CareerGoals;
  personalStory: PersonalStory;
  documents: DocumentRecord[];
  factSheetApproval: FactSheetApproval;
  projectClarifications?: unknown[];
}

export type SectionStatus = "complete" | "in-progress" | "missing" | "not-started";
export interface SectionInfo {
  id: string;
  label: string;
  status: SectionStatus;
  completionPct: number;
}
