// ============================================================
// CV PARSER SERVICE
// ============================================================
// Extracts structured data from CV/resume text using
// rule-based pattern matching (no AI calls).
//
// Supports:
//   - Personal information (name, email, phone, location)
//   - Education records
//   - Work experience
//   - Projects
//   - Skills
//
// Limitations:
//   - Rule-based extraction is not perfect for all CV formats
//   - Consultant must review and edit extracted data
//   - Missing fields are left empty (never fabricated)
// ============================================================

// ============================================================
// DETERMINISTIC FAILURE CLASSIFICATION
// ============================================================

export type CVParseFailureCode =
  | "IMAGE_ONLY_PDF"
  | "CORRUPT_OR_UNREADABLE_PDF"
  | "INSUFFICIENT_TEXT"
  | "PARSE_FAILED";

export interface CVParseFailure extends Error {
  code: CVParseFailureCode;
  userMessage: string;
}

const FAILURE_MESSAGES: Record<CVParseFailureCode, string> = {
  IMAGE_ONLY_PDF:
    "This CV appears to be a scanned or image-based PDF. Please upload a searchable PDF or DOCX.",
  INSUFFICIENT_TEXT:
    "We could read this file, but there isn't enough CV text to import reliably. Please upload a more complete PDF/DOCX or enter the details manually.",
  CORRUPT_OR_UNREADABLE_PDF:
    "This file could not be read as a valid PDF. It may be corrupted. Please try a different file.",
  PARSE_FAILED:
    "We could not process this file. Please try a different PDF or DOCX, or enter the details manually.",
};

export function createCVParseFailure(code: CVParseFailureCode, detail?: string): CVParseFailure {
  const err = new Error(detail || FAILURE_MESSAGES[code]) as CVParseFailure;
  err.code = code;
  err.userMessage = FAILURE_MESSAGES[code];
  return err;
}

/** Minimum text length (chars) for reliable CV parsing */
const MIN_CV_TEXT_LENGTH = 50;
/** Threshold below which text is considered "near-empty" (image-only PDF) */
const NEAR_EMPTY_TEXT_LENGTH = 10;

export interface ParsedCV {
  personalData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    currentCity?: string;
    currentCountry?: string;
    /** Explicit "Nationality:"/"Citizenship:" label only — never inferred. */
    nationality?: string;
    linkedin?: string;
    github?: string;
  };
  education: ParsedEducation[];
  experience: ParsedExperience[];
  projects: ParsedProject[];
  skills: {
    technical: string[];
    programming: string[];
    tools: string[];
    software: string[];
    domain: string[];
    soft: string[];
  };
  /** Explicit "CERTIFICATIONS"/"LICENSES" section lines only. */
  certifications: string[];
  achievements: string[];
  rawTextLength: number;
  parseWarnings: string[];
  /** Parser provenance — present on docling-path results. Never
   * persisted to canonical profile (cv-apply maps fields explicitly). */
  parserMeta?: {
    engine: "legacy" | "docling";
    mapperVersion?: string;
    doclingVersion?: string;
    sourceHash?: string;
    ocrUsed?: boolean;
    durationMs?: number;
    parsedAt?: string;
  };
}

/** Field-level confidence + source — review UI hints, not persisted. */
export interface ParsedFieldMeta {
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  source?: { text: string; page?: number | null };
}

export interface ParsedEducation extends ParsedFieldMeta {
  id: string;
  institution: string;
  degree: string;
  specialization: string;
  startYear: string;
  endYear: string;
  cgpa: string;
  cgpaScale: string;
}

export interface ParsedExperience extends ParsedFieldMeta {
  id: string;
  type: string;
  organization: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  currentlyWorking: boolean;
  responsibilities: string;
}

export interface ParsedProject extends ParsedFieldMeta {
  id: string;
  name: string;
  type: string;
  description: string;
  technologies: string;
  role: string;
}

// ============================================================
// TEXT EXTRACTION
// ============================================================

/**
 * Extract text from a PDF buffer using pdf-parse.
 * Handles both v1.x (default function) and v2.x (PDFParse class) APIs.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfParseModule: any = await import("pdf-parse");

  // v1.x API: default export is a function
  if (typeof pdfParseModule === "function" || typeof pdfParseModule.default === "function") {
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const data = await pdfParse(buffer);
    return data.text || "";
  }

  // v2.x API: PDFParse class
  if (pdfParseModule.PDFParse) {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    await parser.load();
    const result = await parser.getText();
    // v2.x returns { text, pages, total } — extract the combined text
    // Strip pdf-parse's page separator markers (e.g. "\n\n-- 1 of 1 --\n\n")
    if (result && typeof result.text === "string") {
      return result.text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "").trim();
    }
    if (typeof result === "string") return result;
    return "";
  }

  throw new Error("Unsupported pdf-parse API version");
}

/**
 * Extract text from a DOCX buffer using mammoth.
 * Uses bounded extraction with zip bomb protection.
 */
export async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  const { extractDocxTextBounded } = await import("./docx-validator");
  return extractDocxTextBounded(buffer);
}

/**
 * Extract text from a file buffer based on file type.
 */
export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    return extractTextFromPDF(buffer);
  } else if (ext === "docx") {
    return extractTextFromDOCX(buffer);
  } else if (ext === "txt") {
    return buffer.toString("utf-8");
  }
  throw new Error(`Unsupported file type: .${ext}. Supported: PDF, DOCX, TXT.`);
}

// ============================================================
// RULE-BASED FIELD EXTRACTION
// ============================================================

const COMMON_SKILLS: Record<string, string[]> = {
  programming: [
    "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Go", "Rust",
    "Ruby", "PHP", "Swift", "Kotlin", "Scala", "R", "MATLAB", "SQL", "HTML", "CSS",
    "Bash", "Shell", "Perl", "Dart", "Lua", "Julia",
  ],
  technical: [
    "Machine Learning", "Deep Learning", "Data Analysis", "Data Science",
    "Artificial Intelligence", "NLP", "Natural Language Processing",
    "Computer Vision", "Image Processing", "Signal Processing",
    "Cloud Computing", "Distributed Systems", "Microservices",
    "DevOps", "CI/CD", "Containerization", "Virtualization",
    "Cybersecurity", "Cryptography", "Blockchain",
    "Web Development", "Mobile Development", "Game Development",
    "UI/UX", "Design Thinking", "Agile", "Scrum",
    "Statistical Analysis", "Quantitative Analysis", "Qualitative Analysis",
    "Research", "Algorithm Design", "Data Structures",
    "TensorFlow", "PyTorch", "Keras", "Scikit-learn", "Pandas", "NumPy",
    "React", "Angular", "Vue", "Node.js", "Express", "Django", "Flask",
    "Spring", "Hibernate", ".NET", "Android", "iOS",
  ],
  tools: [
    "Git", "GitHub", "GitLab", "Bitbucket", "JIRA", "Confluence",
    "Docker", "Kubernetes", "Jenkins", "CircleCI", "Travis CI",
    "AWS", "Azure", "GCP", "Heroku", "Vercel",
    "VS Code", "IntelliJ", "Eclipse", "Vim",
    "MySQL", "PostgreSQL", "MongoDB", "Redis", "Elasticsearch",
    "Kafka", "RabbitMQ", "Nginx", "Apache",
  ],
  // Software/design/analysis applications — maps to canonical skills.software
  software: [
    "Tableau", "Power BI", "Excel", "Google Analytics",
    "Figma", "Sketch", "Adobe XD", "Photoshop", "Illustrator",
    "Jupyter", "RStudio", "SPSS", "Stata", "SAS",
    "AutoCAD", "SolidWorks", "MATLAB", "Simulink",
  ],
  domain: [
    "Finance", "Healthcare", "Education", "E-commerce", "Marketing",
    "Supply Chain", "Manufacturing", "Automotive", "Aerospace",
    "Energy", "Telecommunications", "Real Estate", "Insurance",
    "Banking", "Investment", "Consulting", "Audit", "Tax",
    "Civil Engineering", "Mechanical Engineering", "Electrical Engineering",
    "Chemical Engineering", "Biotechnology", "Pharmaceutical",
  ],
  soft: [
    "Leadership", "Communication", "Teamwork", "Problem Solving",
    "Critical Thinking", "Time Management", "Project Management",
    "Presentation", "Public Speaking", "Writing", "Negotiation",
    "Mentoring", "Collaboration", "Adaptability", "Creativity",
    "Decision Making", "Strategic Planning", "Conflict Resolution",
  ],
};

function generateId(): string {
  return `cv-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Extract email from text.
 */
function extractEmail(text: string): string | undefined {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : undefined;
}

/**
 * Extract phone number from text.
 */
function extractPhone(text: string): string | undefined {
  // International and Indian phone formats
  const patterns = [
    /\+91[-.\s]?\d{5}[-.\s]?\d{5}/,
    /\+91[-.\s]?\d{10}/,
    /\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\+?\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return undefined;
}

/**
 * Extract LinkedIn URL from text.
 */
function extractLinkedIn(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[\w-]+\/?/i);
  return match ? match[0] : undefined;
}

/**
 * Extract GitHub URL from text.
 */
function extractGitHub(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i);
  return match ? match[0] : undefined;
}

/**
 * Extract name from the first few lines of text.
 * Heuristic: The name is usually at the top, in a larger font,
 * and consists of 2-4 capitalized words.
 */
function extractName(text: string): { firstName?: string; lastName?: string } {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines.slice(0, 5)) {
    // Skip lines that look like contact info or job titles
    if (line.match(/@|phone|email|address|curriculum|cv\b/i)) continue;

    // Strip common suffixes like "| Resume", "| CV", "| Curriculum Vitae"
    let cleaned = line.replace(/\s*\|\s*.*$/i, "").replace(/\s*[-–—]\s*.*$/i, "").trim();

    // Skip if cleaning removed too much
    if (!cleaned || cleaned.length < 3) continue;

    // Handle all-caps names (e.g., "KUNJ MANOJKUMAR MODH") — convert to title case
    if (cleaned === cleaned.toUpperCase() && cleaned.match(/^[A-Z\s]+$/) && cleaned.split(/\s+/).length >= 2) {
      cleaned = cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    // Match 2-word names (allow lowercase last name for Europass format)
    const nameMatch = cleaned.match(/^([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*)\s+([A-Z][a-z]+(?:[-'][A-Za-z]+)*)$/);
    if (nameMatch) {
      return { firstName: nameMatch[1], lastName: nameMatch[2] };
    }

    // Match 2-word names with lowercase last name (e.g., "Kunj Manojkumar modh")
    const lowerLastNameMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+\s+[a-z]+)$/);
    if (lowerLastNameMatch) {
      const parts = lowerLastNameMatch[2].split(/\s+/);
      return { firstName: lowerLastNameMatch[1], lastName: parts[parts.length - 1] };
    }

    // Match 3-word names
    const threeWordMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)$/);
    if (threeWordMatch) {
      return { firstName: threeWordMatch[1], lastName: threeWordMatch[3] };
    }

    // Match 3-word names with lowercase last name (e.g., "Kunj Manojkumar modh")
    const threeWordLowerMatch = cleaned.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([a-z]+)$/);
    if (threeWordLowerMatch) {
      return { firstName: threeWordLowerMatch[1], lastName: threeWordLowerMatch[3].replace(/\b\w/, c => c.toUpperCase()) };
    }
  }
  return {};
}

/**
 * Extract location (city, country) from text.
 */
function extractLocation(text: string): { city?: string; country?: string } {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  // Look for common location patterns in first 10 lines
  for (const line of lines.slice(0, 10)) {
    // "City, Country" or "City, State, Country"
    const locMatch = line.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    if (locMatch && !line.match(/@|phone|email|university|institute|college/i)) {
      return { city: locMatch[1], country: locMatch[2] };
    }
  }

  // Common Indian cities
  const indianCities = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Surat", "Jaipur"];
  for (const city of indianCities) {
    if (text.includes(city)) {
      return { city, country: "India" };
    }
  }

  return {};
}

/**
 * Extract education records from text.
 */
function extractEducation(text: string): ParsedEducation[] {
  const education: ParsedEducation[] = [];

  // Look for education section
  const eduSectionMatch = text.match(/(?:education|academic|qualifications)\s*:?\s*([\s\S]*?)(?=\n\s*(?:experience|employment|work|projects|skills|certifications|awards|$))/i);
  const eduText = eduSectionMatch ? eduSectionMatch[1] : text;

  const lines = eduText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  // Common degree keywords
  const degreeKeywords = /(?:B\.?Tech\.?|B\.?E\.?|Bachelor|M\.?Tech\.?|M\.?E\.?|M\.?S\.?|M\.?Sc\.?|Master|Ph\.?D\.?|Doctorate|Diploma|12th|10th|Senior Secondary|Secondary|SSLC|SSC)/i;

  // Common institution keywords
  const institutionKeywords = /(?:University|Institute|College|School|IIT|NIT|IIIT|BITS|VIT|MIT|Stanford|Harvard|Oxford|Cambridge|Polytechnic)/i;

  let currentEdu: Partial<ParsedEducation> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";

    // Check for degree keyword
    const hasDegree = degreeKeywords.test(line);
    const hasInstitution = institutionKeywords.test(line);

    if (hasDegree || hasInstitution) {
      // Start new education record
      if (currentEdu && (currentEdu.institution || currentEdu.degree)) {
        education.push({
          id: generateId(),
          institution: currentEdu.institution || "",
          degree: currentEdu.degree || "",
          specialization: currentEdu.specialization || "",
          startYear: currentEdu.startYear || "",
          endYear: currentEdu.endYear || "",
          cgpa: currentEdu.cgpa || "",
          cgpaScale: currentEdu.cgpaScale || "10",
        });
      }
      currentEdu = {};

      // Try to parse "Degree in Field, Institution" or "Degree, Institution"
      const degreeInInstMatch = line.match(/^([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?)\s+(?:in|of)\s+([A-Za-z\s&+]+),\s*(.+)$/);
      if (degreeInInstMatch) {
        currentEdu.degree = degreeInInstMatch[1].trim();
        currentEdu.specialization = degreeInInstMatch[2].trim();
        currentEdu.institution = degreeInInstMatch[3].trim();
      } else {
        // Try to split by comma: "B.Tech in CS, IIT Bombay"
        const parts = line.split(",").map(p => p.trim());
        if (parts.length >= 2) {
          // First part has degree, last part has institution
          currentEdu.degree = parts[0].split(/\s+(?:in|of)\s+/)[0].trim();
          const specMatch = parts[0].match(/(?:in|of)\s+(.+)/i);
          if (specMatch) currentEdu.specialization = specMatch[1].trim();
          currentEdu.institution = parts[parts.length - 1];
        } else {
          // Single line — try to extract degree and institution
          if (hasDegree) currentEdu.degree = line.match(degreeKeywords)?.[0] || line;
          if (hasInstitution) currentEdu.institution = line.match(institutionKeywords)?.[0] || line;
        }
      }
    }

    if (currentEdu) {
      // Check next line for year range
      const yearMatch = (line + " " + nextLine).match(/((?:20|19)\d{2})\s*(?:-|–|to)\s*((?:20|19)\d{2}|present|current|ongoing)/i);
      if (yearMatch && !currentEdu.startYear) {
        currentEdu.startYear = yearMatch[1];
        currentEdu.endYear = yearMatch[2]?.match(/\d{4}/)?.[0] || "";
      }

      // Check for CGPA
      const cgpaMatch = line.match(/(?:CGPA|GPA|CPI|SGPA)\s*:?\s*(\d+\.?\d*)\s*(?:\/|out of)?\s*(\d+\.?\d*)?/i);
      if (cgpaMatch) {
        currentEdu.cgpa = cgpaMatch[1];
        if (cgpaMatch[2]) currentEdu.cgpaScale = cgpaMatch[2];
      }
    }
  }

  // Push last education record
  if (currentEdu && (currentEdu.institution || currentEdu.degree)) {
    education.push({
      id: generateId(),
      institution: currentEdu.institution || "",
      degree: currentEdu.degree || "",
      specialization: currentEdu.specialization || "",
      startYear: currentEdu.startYear || "",
      endYear: currentEdu.endYear || "",
      cgpa: currentEdu.cgpa || "",
      cgpaScale: currentEdu.cgpaScale || "10",
    });
  }

  return education;
}

/**
 * Extract work experience from text.
 */
function extractExperience(text: string): ParsedExperience[] {
  const experience: ParsedExperience[] = [];

  // Look for experience section
  const expSectionMatch = text.match(/(?:experience|employment|work history|professional experience)\s*:?\s*([\s\S]*?)(?=\n\s*(?:projects|education|skills|certifications|awards|$))/i);
  const expText = expSectionMatch ? expSectionMatch[1] : text;

  const lines = expText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let currentExp: Partial<ParsedExperience> | null = null;

  for (const line of lines) {
    // Check for date patterns (indicates a new experience entry)
    const dateMatch = line.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?[a-z]*\s*(?:20|19)\d{2})\s*(?:-|–|to)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?[a-z]*\s*(?:(?:20|19)\d{2}|present|current|ongoing))/i);

    // Check for job title patterns
    const titleMatch = line.match(/(?:intern|engineer|developer|analyst|consultant|manager|designer|researcher|assistant|associate|lead|architect|specialist|officer|trainee)/i);

    // Check for company patterns
    const companyMatch = line.match(/(?:at|@|\|\s*)\s*([A-Z][A-Za-z0-9\s&.,]+)/);

    if (dateMatch || (titleMatch && !currentExp)) {
      // Start new experience
      if (currentExp && currentExp.organization) {
        experience.push({
          id: generateId(),
          type: currentExp.type || "Full-time Job",
          organization: currentExp.organization || "",
          role: currentExp.role || "",
          location: currentExp.location || "",
          startDate: currentExp.startDate || "",
          endDate: currentExp.endDate || "",
          currentlyWorking: currentExp.currentlyWorking || false,
          responsibilities: currentExp.responsibilities || "",
        });
      }
      currentExp = {};
      if (dateMatch) {
        currentExp.startDate = dateMatch[1].trim();
        currentExp.endDate = dateMatch[2].trim();
        currentExp.currentlyWorking = /present|current|ongoing/i.test(dateMatch[2]);
      }
    }

    if (currentExp) {
      if (titleMatch && !currentExp.role) {
        currentExp.role = line.split(/\s+at\s+|\s*@\s*|\s*\|\s*/)[0].trim();
      }
      if (companyMatch && !currentExp.organization) {
        currentExp.organization = companyMatch[1].trim();
      }
      // Check for "Intern" keyword
      if (/intern/i.test(line) && !currentExp.type) {
        currentExp.type = "Internship";
      }
    }
  }

  // Push last experience
  if (currentExp && currentExp.organization) {
    experience.push({
      id: generateId(),
      type: currentExp.type || "Full-time Job",
      organization: currentExp.organization || "",
      role: currentExp.role || "",
      location: currentExp.location || "",
      startDate: currentExp.startDate || "",
      endDate: currentExp.endDate || "",
      currentlyWorking: currentExp.currentlyWorking || false,
      responsibilities: currentExp.responsibilities || "",
    });
  }

  return experience;
}

/**
 * Extract projects from text.
 */
function extractProjects(text: string): ParsedProject[] {
  const projects: ParsedProject[] = [];

  // Look for projects section
  const projSectionMatch = text.match(/(?:projects|personal projects|academic projects|key projects)\s*:?\s*([\s\S]*?)(?=\n\s*(?:skills|certifications|awards|interests|hobbies|$))/i);
  const projText = projSectionMatch ? projSectionMatch[1] : "";

  if (!projText) return projects;

  const lines = projText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let currentProj: Partial<ParsedProject> | null = null;

  for (const line of lines) {
    // Project names are often short lines that aren't bullet points
    if (line.length < 80 && !line.startsWith("•") && !line.startsWith("-") && !line.startsWith("*")) {
      if (currentProj && currentProj.name) {
        projects.push({
          id: generateId(),
          name: currentProj.name || "",
          type: currentProj.type || "",
          description: currentProj.description || "",
          technologies: currentProj.technologies || "",
          role: currentProj.role || "",
        });
      }
      currentProj = { name: line, type: "Academic", description: "", technologies: "" };
    } else if (currentProj) {
      // Accumulate description
      const desc = line.replace(/^[•\-*]\s*/, "");
      if (currentProj.description) {
        currentProj.description += " " + desc;
      } else {
        currentProj.description = desc;
      }
      // Check for tech keywords
      const techMatch = line.match(/(?:technologies|tools|tech stack|built with|using)\s*:?\s*(.+)/i);
      if (techMatch) {
        currentProj.technologies = techMatch[1].trim();
      }
    }
  }

  // Push last project
  if (currentProj && currentProj.name) {
    projects.push({
      id: generateId(),
      name: currentProj.name || "",
      type: currentProj.type || "",
      description: currentProj.description || "",
      technologies: currentProj.technologies || "",
      role: currentProj.role || "",
    });
  }

  return projects;
}

/**
 * Extract nationality — EXPLICIT LABEL ONLY.
 * Matches "Nationality: Indian" / "Citizenship: Indian" style lines.
 * Never inferred from name, address, phone prefix, or university.
 */
function extractNationality(text: string): string | undefined {
  const match = text.match(/(?:nationality|citizenship)\s*[:|–—-]\s*([A-Za-z][A-Za-z' -]{1,40})/i);
  if (!match) return undefined;
  // Stop at likely line-endings embedded in the match (labels in multi-column CVs)
  const value = match[1].split(/[|•,;]/)[0].trim();
  return value || undefined;
}

/**
 * Extract lines from a clearly-labelled CV section.
 * Conservative: only the labelled section's bullet/line items are returned;
 * no inference from other sections (e.g. job bullets are NOT achievements).
 */
function extractLabelledSection(text: string, labels: string[]): string[] {
  const labelPattern = labels.join("|");
  const sectionMatch = text.match(
    new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:[A-Z][A-Z&/ ]{3,}|education|experience|employment|work|projects|skills|summary|objective|references|interests|hobbies|declaration)\\s*:?\\s*\\n|$)`, "i")
  );
  if (!sectionMatch) return [];
  return sectionMatch[1]
    .split("\n")
    .map(l => l.replace(/^[•\-*▪◦·]\s*/, "").trim())
    .filter(l => l.length > 3 && l.length < 200);
}

/**
 * Extract certifications — only from an explicit section label.
 */
function extractCertifications(text: string): string[] {
  return extractLabelledSection(text, [
    "certifications?", "certificates", "licenses?", "certified courses", "professional certifications",
  ]);
}

/**
 * Extract achievements — only from an explicit section label.
 * Ordinary job responsibilities are never promoted to achievements.
 */
function extractAchievements(text: string): string[] {
  return extractLabelledSection(text, [
    "achievements", "awards?(?:\\s+and\\s+honou?rs?)?", "honou?rs?", "accomplishments", "recognitions?",
  ]);
}

/**
 * Extract skills from text by matching against known skill lists.
 */
function extractSkills(text: string): ParsedCV["skills"] {
  const skills: ParsedCV["skills"] = {
    technical: [],
    programming: [],
    tools: [],
    software: [],
    domain: [],
    soft: [],
  };

  // Look for skills section
  const skillsSectionMatch = text.match(/(?:skills|technical skills|core competencies|technologies)\s*:?\s*([\s\S]*?)(?=\n\s*(?:experience|education|projects|certifications|awards|interests|$))/i);
  const skillsText = skillsSectionMatch ? skillsSectionMatch[1] : text;

  for (const [category, knownSkills] of Object.entries(COMMON_SKILLS)) {
    for (const skill of knownSkills) {
      // Case-insensitive word boundary match
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(skillsText)) {
        (skills as any)[category].push(skill);
      }
    }
  }

  // Deduplicate
  for (const key of Object.keys(skills)) {
    (skills as any)[key] = Array.from(new Set((skills as any)[key]));
  }

  return skills;
}

// ============================================================
// MAIN PARSE FUNCTION
// ============================================================

/**
 * Parse CV text into structured data using rule-based extraction.
 */
export function parseCVText(text: string): ParsedCV {
  const warnings: string[] = [];

  const personal = extractName(text);
  const email = extractEmail(text);
  const phone = extractPhone(text);
  const linkedin = extractLinkedIn(text);
  const github = extractGitHub(text);
  const location = extractLocation(text);

  const nationality = extractNationality(text);
  const certifications = extractCertifications(text);
  const achievements = extractAchievements(text);
  const education = extractEducation(text);
  const experience = extractExperience(text);
  const projects = extractProjects(text);
  const skills = extractSkills(text);

  if (!personal.firstName) warnings.push("Could not detect name. Please enter manually.");
  if (!email) warnings.push("Could not detect email. Please enter manually.");
  if (!phone) warnings.push("Could not detect phone. Please enter manually.");
  if (education.length === 0) warnings.push("No education records detected.");
  if (experience.length === 0) warnings.push("No work experience detected.");
  if (projects.length === 0) warnings.push("No projects detected.");
  if (skills.technical.length + skills.programming.length + skills.tools.length + skills.software.length === 0) {
    warnings.push("No skills detected.");
  }

  return {
    personalData: {
      firstName: personal.firstName,
      lastName: personal.lastName,
      email,
      phone,
      currentCity: location.city,
      currentCountry: location.country,
      nationality,
      linkedin,
      github,
    },
    education,
    experience,
    projects,
    skills,
    certifications,
    achievements,
    rawTextLength: text.length,
    parseWarnings: warnings,
  };
}

/**
 * Full pipeline: extract text from file buffer, then parse.
 *
 * Deterministic failure classification:
 *   - IMAGE_ONLY_PDF: PDF parsed but text is empty/near-empty (scanned/image PDF)
 *   - INSUFFICIENT_TEXT: Some text exists but too short for reliable parsing
 *   - CORRUPT_OR_UNREADABLE_PDF: PDF parser threw (corrupt/invalid structure)
 *   - PARSE_FAILED: Other unexpected extraction error
 */
export async function parseCVFile(buffer: Buffer, filename: string): Promise<ParsedCV> {
  let text: string;
  try {
    text = await extractTextFromFile(buffer, filename);
  } catch (extractError: any) {
    // PDF parser threw — classify based on file type
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf") {
      throw createCVParseFailure("CORRUPT_OR_UNREADABLE_PDF", extractError?.message);
    }
    // DOCX/TXT extraction failure
    throw createCVParseFailure("PARSE_FAILED", extractError?.message);
  }

  const trimmedLength = text ? text.trim().length : 0;

  // Image-only PDF: structurally valid PDF but no text layer
  if (trimmedLength <= NEAR_EMPTY_TEXT_LENGTH) {
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf") {
      throw createCVParseFailure("IMAGE_ONLY_PDF");
    }
    // Empty DOCX/TXT
    throw createCVParseFailure("INSUFFICIENT_TEXT");
  }

  // Insufficient text: some content but too short for reliable parsing
  if (trimmedLength < MIN_CV_TEXT_LENGTH) {
    throw createCVParseFailure("INSUFFICIENT_TEXT");
  }

  return parseCVText(text);
}
