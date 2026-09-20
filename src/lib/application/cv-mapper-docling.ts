// ============================================================
// DOCLING → RESUME CANDIDATE → ParsedCV MAPPER
// ============================================================
// Section-aware semantic mapper. Docling provides block structure
// (type, page, order, bbox); this layer groups blocks into resume
// sections, then extracts fields ONLY within matching sections.
// A line in EXPERIENCE can never create an education record.
//
// Output is the existing ParsedCV shape (review UI + apply path
// unchanged) plus parserMeta + per-record confidence/provenance.
// No invented defaults: unsupported fields stay empty.
// ============================================================

import type { ParsedDocument, ResumeCandidate } from "./resume-candidate.schema";
import type {
  ParsedCV, ParsedEducation, ParsedExperience, ParsedProject,
} from "./cv-parser";
import { sanitizeCandidate } from "./cv-sanity";

type Section =
  | "PERSONAL" | "SUMMARY" | "EDUCATION" | "EXPERIENCE" | "PROJECTS"
  | "SKILLS" | "CERTIFICATIONS" | "ACHIEVEMENTS" | "LANGUAGES" | "OTHER";

const SECTION_KEYWORDS: Array<[RegExp, Section]> = [
  [/^(professional\s+)?(summary|profile|objective|about)/i, "SUMMARY"],
  [/^education|academic (background|qualification|history)/i, "EDUCATION"],
  [/(professional|work|research|employment|internship).*(experience|history)|experience/i, "EXPERIENCE"],
  [/project/i, "PROJECTS"],
  [/(technical )?skills|competenc|technologies|tech stack/i, "SKILLS"],
  [/certification|license|course ?work cert/i, "CERTIFICATIONS"],
  [/achievement|award|honor|leadership|activit|workshop|extra.?curricular/i, "ACHIEVEMENTS"],
  [/language/i, "LANGUAGES"],
];

const DATE_RANGE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?[a-z]*\.?\s*\d{4}\s*[-–—to]+\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?[a-z]*\.?\s*\d{4}|present|current|ongoing\b/i;
const DATE_RANGE_G = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?\d{4}\s*[-–—]+\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?\d{4}|present|current|ongoing)/gi;
const DATE_ONLY = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?[a-z]*\.?\s*\d{4}\s*[-–—to]+\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?[a-z]*\.?\s*\d{4}|present|current|ongoing)?\s*$/i;
const DEGREE_WORDS = /bachelor|master|phd|doctorate|diploma|b\.?tech|m\.?tech|b\.?e\.|m\.?e\.|bca|mca|b\.?sc|m\.?sc|mba|b\.?com|b\.?a\.|associate|12th|10th|intermediate|higher secondary|high school|secondary/i;
const GPA_RE = /(cgpa|gpa|percentage|score)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)|%)?/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
const LINKEDIN_RE = /(?:linkedin\.com\/|linkedin\s*[:|])/i;
const GITHUB_RE = /github\.com\//i;

function cvId(engine: string): string {
  return `${engine}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/** Known resume-section heading? → section; otherwise null (entry title). */
function sectionOf(text: string): Section | null {
  const t = text.trim().replace(/[:\-–—|]+$/, "").trim();
  if (t.length > 60) return null;
  for (const [re, sec] of SECTION_KEYWORDS) if (re.test(t)) return sec;
  return null;
}

function splitEntry(text: string): { title: string; location?: string } {
  // "Indus University, Ahmedabad" → title + trailing city
  const parts = text.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length > 1 && /^[A-Z][a-zA-Z. ]{1,30}$/.test(parts[parts.length - 1]) && parts.length <= 3) {
    return { title: parts.slice(0, -1).join(", "), location: parts[parts.length - 1] };
  }
  return { title: text.trim() };
}

function parseDateRange(text: string): { start?: string; end?: string } {
  const m = text.match(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4})\s*[-–—]+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}|present|current|ongoing)/i);
  if (!m) {
    const single = text.match(/\b(19|20)\d{2}\b/);
    return single ? { end: single[0] } : {};
  }
  return { start: m[1].trim(), end: m[2].trim() };
}

/** Split "Bachelor of Technology (B.Tech) - Computer Science & Engineering" */
function parseDegreeLine(text: string): { degree: string; fieldOfStudy: string } {
  const parts = text.split(/\s+[-–—|]\s+|\s+in\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return { degree: parts[0], fieldOfStudy: parts.slice(1).join(" ") };
  return { degree: text.trim(), fieldOfStudy: "" };
}

function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 60 || /\d|@|http/i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  // all-caps or title case words only
  return words.every(w => /^[A-Z][A-Za-z.'-]*$/.test(w) || /^[A-Z]+$/.test(w));
}

/**
 * Map a Docling ParsedDocument → ParsedCV (existing shape).
 */
export function mapDoclingToParsedCV(doc: ParsedDocument): ParsedCV {
  const warnings: string[] = [];
  const blocks = doc.blocks;

  // ===== SEGMENT INTO SECTIONS =====
  interface Seg { section: Section; blocks: typeof blocks }
  const segments: Seg[] = [{ section: "PERSONAL", blocks: [] }];
  for (const b of blocks) {
    if (b.type === "section_header" || b.type === "title") {
      const sec = sectionOf(b.text);
      if (sec) {
        segments.push({ section: sec, blocks: [b] });
        continue;
      }
    }
    segments[segments.length - 1].blocks.push(b);
  }

  const candidate: ResumeCandidate = {
    personalData: {},
    education: [],
    experience: [],
    projects: [],
    skills: { technical: [], programming: [], tools: [], software: [], domain: [], soft: [], languages: [] },
    certifications: [],
    achievements: [],
    warnings,
  };

  // ===== PERSONAL / CONTACT =====
  // Scan all blocks for email/phone/linkedin — contact data often lives
  // in a sidebar block that Docling merges with other sidebar text.
  const allText = blocks.map(b => b.text);
  for (const t of allText) {
    if (!candidate.personalData!.email) {
      const em = t.match(EMAIL_RE);
      if (em) candidate.personalData!.email = em[0];
    }
    if (!candidate.personalData!.phone) {
      const ph = t.match(PHONE_RE);
      if (ph) candidate.personalData!.phone = ph[0].trim();
    }
    if (!candidate.personalData!.linkedin && LINKEDIN_RE.test(t)) {
      const m = t.match(/linkedin\.com\/\S+/i);
      candidate.personalData!.linkedin = m ? m[0] : undefined;
    }
    if (!candidate.personalData!.github && GITHUB_RE.test(t)) {
      const m = t.match(/github\.com\/\S+/i);
      candidate.personalData!.github = m ? m[0] : undefined;
    }
    if (!candidate.personalData!.currentCity) {
      // "City, State, Country" segment inside the contact block
      const loc = t.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z][a-z]+)?,?\s*(India|USA|United States|United Kingdom|UK|Germany|Canada|Australia|France|Netherlands|Singapore|Ireland)\b/);
      if (loc) {
        candidate.personalData!.currentCity = loc[1];
        candidate.personalData!.currentCountry = loc[3];
      }
    }
  }

  // Name: prefer an ALL-CAPS name-like header anywhere on page 1
  // (typical CV name header — company/institution headers are
  // title case); fall back to a title-case name-like header in the
  // PERSONAL (pre-section) segment.
  let detectedName = "";
  {
    const nameLike = (b: (typeof blocks)[number]) =>
      (b.type === "section_header" || b.type === "title") &&
      b.page === 1 && looksLikeName(b.text) && !sectionOf(b.text);
    const allCaps = blocks.find(b => nameLike(b) && b.text.trim() === b.text.trim().toUpperCase() && /[A-Z]/.test(b.text));
    const personalPick = segments
      .filter(s => s.section === "PERSONAL" || s.section === "SUMMARY")
      .flatMap(s => s.blocks)
      .find(nameLike);
    const pick = allCaps || personalPick;
    if (pick) {
      detectedName = pick.text.trim();
      // Title-case ALL-CAPS name headers for display
      if (detectedName === detectedName.toUpperCase()) {
        detectedName = detectedName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      }
      candidate.personalData!.fullName = detectedName;
      const w = detectedName.split(/\s+/);
      candidate.personalData!.firstName = w[0];
      candidate.personalData!.lastName = w.slice(1).join(" ");
      candidate.personalData!.source = { text: detectedName, page: 1 };
      candidate.personalData!.confidence = "HIGH";
    }
  }
  const detectedNameNorm = detectedName.toLowerCase();
  // Blocks consumed as date-ranges — orphan dates (sidebar ordering)
  // attach to date-less education entries afterwards.
  const consumedBlocks = new Set<number>();

  // ===== EDUCATION =====
  // Handles BOTH layouts:
  //   A) per-entry headers ("Indus University, Ahmedabad" + degree/date lines)
  //   B) merged text blocks ("MBA in IT | Intl Univ, Berlin Sep 2024 - Dec 2025
  //      Bachelor of … | Indus University, Ahmedabad Jun 2016 - Sep 2020
  //      Product Management Certification - AltUni by Inside IIM")
  // Cert-looking sub-records inside a combined EDUCATION & CERTIFICATIONS
  // section are routed to certifications, not education.
  for (const seg of segments.filter(s => s.section === "EDUCATION")) {
    let cur: any = null;
    for (const b of seg.blocks.slice(1)) { // skip the EDUCATION heading itself
      const t = b.text.trim();
      if (b.type === "section_header" || b.type === "title") {
        if (detectedNameNorm && t.toLowerCase() === detectedNameNorm) { cur = null; continue; }
        cur = { institution: "", degree: "", fieldOfStudy: "", gpa: "", maxGpa: "", startYear: "", endYear: "", bullets: [] as string[], sourceText: [t], page: b.page };
        cur.institution = splitEntry(t).title;
        cur.confidence = "HIGH";
        candidate.education.push(cur);
        continue;
      }

      // Merged-block layout: one text block containing several records.
      // Split on date-range boundaries; trailing no-date tail = one more
      // record (e.g. a certification with no dates).
      DATE_RANGE_G.lastIndex = 0;
      const dateMatches: RegExpExecArray[] = [];
      let dm: RegExpExecArray | null;
      while ((dm = DATE_RANGE_G.exec(t))) dateMatches.push(dm);
      if (dateMatches.length && DEGREE_WORDS.test(t) && t.includes("|")) {
        const recs: string[] = [];
        let lastEnd = 0;
        for (const m of dateMatches) {
          recs.push(t.slice(lastEnd, m.index! + m[0].length));
          lastEnd = m.index! + m[0].length;
        }
        const tail = t.slice(lastEnd).trim();
        if (tail) recs.push(tail);
        for (const r of recs) {
          const rec = r.trim();
          if (!rec) continue;
          if (/certif|certified|certificate|course\b/i.test(rec) && !DEGREE_WORDS.test(rec)) {
            // "Product Management Certification - AltUni by Inside IIM"
            const parts = rec.split(/\s+[-–—]\s+/);
            candidate.certifications.push(parts.map(s => s.trim()).filter(Boolean).join(" - "));
            continue;
          }
          const pipeParts = rec.split("|").map(s => s.trim()).filter(Boolean);
          const e: any = { institution: "", degree: "", fieldOfStudy: "", gpa: "", maxGpa: "", startYear: "", endYear: "", confidence: "HIGH", sourceText: [rec], page: b.page };
          const d = parseDateRange(rec);
          e.startYear = d.start || ""; e.endYear = d.end || "";
          if (pipeParts.length > 1) {
            e.degree = pipeParts[0];
            const inM = pipeParts[0].match(/^(.+?)\s+in\s+(.+)$/i);
            if (inM) e.fieldOfStudy = inM[2];
            const instLoc = pipeParts[1].replace(DATE_RANGE_G, "").trim();
            const { title, location } = splitEntry(instLoc);
            e.institution = title;
            if (location) e.bullets = [];
          } else {
            e.institution = rec.replace(DATE_RANGE_G, "").trim();
          }
          candidate.education.push(e);
        }
        continue;
      }

      if (DATE_ONLY.test(t)) {
        const d = parseDateRange(t);
        if (cur) { cur.startYear = d.start || cur.startYear; cur.endYear = d.end || cur.endYear; consumedBlocks.add(b.order); }
        continue;
      }
      const gpa = t.match(GPA_RE);
      if (gpa && cur && !cur.gpa) {
        cur.gpa = gpa[2];
        if (gpa[3]) cur.maxGpa = gpa[3];
        else if (/%/.test(t)) cur.maxGpa = "100";
        continue;
      }
      if (cur && !cur.degree && DEGREE_WORDS.test(t)) {
        const d = parseDegreeLine(t);
        cur.degree = d.degree;
        cur.fieldOfStudy = d.fieldOfStudy;
        cur.sourceText.push(t);
        continue;
      }
      if (cur && t.length < 120 && !cur.degree) {
        cur.bullets.push(t);
      }
    }
  }
  // Drop education entries with <2 useful signals (never a lone "India")
  candidate.education = candidate.education.filter((e: any) => {
    const signals = [e.institution, e.degree, e.fieldOfStudy, e.gpa, e.startYear, e.endYear]
      .filter(v => !!v).length;
    if (signals < 2) { warnings.push(`Dropped weak education entry (evidence: "${e.sourceText?.[0] || ""}")`); return false; }
    return true;
  });

  // ===== EXPERIENCE =====
  for (const seg of segments.filter(s => s.section === "EXPERIENCE")) {
    const segHeading = seg.blocks[0]?.text || "";
    let cur: any = null;
    for (const b of seg.blocks.slice(1)) {
      const t = b.text.trim();
      if (b.type === "section_header" || b.type === "title") {
        // The person's own name header can land inside an experience
        // segment (sidebar reading order) — never an organization.
        // It also ENDS the current entry context so stray sidebar text
        // (e.g. the education date) can't attach to the previous org.
        if (detectedNameNorm && t.toLowerCase() === detectedNameNorm) { cur = null; continue; }

        // Header carrying a date-range → ROLE+DATE entry opener:
        //   "Business Analyst Sep 2023 - Aug 2024"
        DATE_RANGE_G.lastIndex = 0;
        if (DATE_RANGE_G.test(t)) {
          const d = parseDateRange(t);
          cur = {
            organization: "", role: t.replace(DATE_RANGE_G, "").replace(/[\s\-–—|,;:]+$/, "").trim(),
            location: "", startDate: d.start || "", endDate: d.end || "",
            bullets: [] as string[], sectionHeading: segHeading, confidence: "HIGH",
            source: { text: t, page: b.page },
          };
          consumedBlocks.add(b.order);
          candidate.experience.push(cur);
          continue;
        }

        // Location-only header ("| Philadelphia, PA (Remote)") → attach
        if (t.startsWith("|")) {
          if (cur && !cur.location) cur.location = t.replace(/^\|+/, "").trim();
          continue;
        }

        // Org (optionally "Org | Location") header — either opens a new
        // entry (org-first layout) or completes the pending one.
        if (cur === null || (cur.organization && cur.bullets.length > 0)) {
          const { title, location } = splitEntry(t.split("|")[0].trim());
          const locPart = t.split("|")[1]?.trim();
          cur = { organization: title, role: "", location: locPart || location || "", startDate: "", endDate: "", bullets: [] as string[], sectionHeading: segHeading, confidence: "HIGH", source: { text: t, page: b.page } };
          candidate.experience.push(cur);
        } else {
          // attach to pending entry: "Ambimat Electronics | Ahmedabad, India"
          const parts = t.split("|").map(s => s.trim()).filter(Boolean);
          if (!cur.organization) {
            const { title, location } = splitEntry(parts[0]);
            cur.organization = title;
            if (parts[1]) cur.location = parts.slice(1).join(", ");
            else if (location) cur.location = location;
          } else if (!cur.location) {
            cur.location = parts.join(", ");
          }
        }
        continue;
      }
      if (!cur) continue;
      if ((DATE_RANGE.test(t) && t.length < 60) || /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?[a-z]*\.?\s*\d{4}\s*$/i.test(t)) {
        if (!cur.startDate) {
          consumedBlocks.add(b.order);
          const d = parseDateRange(t);
          cur.startDate = d.start || t;
          cur.endDate = d.start ? (d.end || "") : "";
          continue;
        }
      }
      if (!cur.role && t.length < 100 && !/^(developed|built|created|designed|implemented|led|worked|contributed|strengthened|co-?authored)/i.test(t)) {
        // "Data Science Intern | Ahmedabad, India"
        const parts = t.split("|").map(s => s.trim());
        cur.role = parts[0];
        if (parts[1]) cur.location = parts.slice(1).join(", ");
        continue;
      }
      cur.bullets.push(t);
    }
  }

  // Orphaned date blocks (sidebar ordering): attach to an education
  // entry missing dates — runs AFTER all section loops so only truly
  // unconsumed date blocks are candidates.
  for (const b of blocks) {
    const t = b.text.trim();
    if (DATE_ONLY.test(t) && !consumedBlocks.has(b.order)) {
      const target = candidate.education.find((e: any) => !e.startYear && !e.endYear);
      if (target) {
        const d = parseDateRange(t);
        target.startYear = d.start || "";
        target.endYear = d.end || "";
        if (target.confidence === "HIGH") target.confidence = "MEDIUM";
      }
    }
  }

  // ===== PROJECTS =====
  for (const seg of segments.filter(s => s.section === "PROJECTS")) {
    let cur: any = null;
    for (const b of seg.blocks.slice(1)) {
      const t = b.text.trim();
      if (b.type === "section_header" || b.type === "title") {
        if (detectedNameNorm && t.toLowerCase() === detectedNameNorm) { cur = null; continue; }
        // "AI Real Estate Voice Agent -  Llama 3 + Qdrant + Deepgram GitHub ↗"
        // → name + inline tech stack; strip GitHub link decorations.
        const clean = t.replace(/\s*GitHub\s*↗?\s*/gi, "").trim();
        const dash = clean.split(/\s+[-–—]\s+/);
        cur = { name: dash[0], role: "", description: "", technologies: dash.length > 1 ? dash.slice(1).join(" - ") : "", confidence: "HIGH", source: { text: t, page: b.page } };
        candidate.projects.push(cur);
        continue;
      }
      if (!cur) continue;
      if (!cur.role && /academic|personal|capstone|project|research|internship/i.test(t) && t.length < 80) {
        cur.role = t; // "Academic AI Project" etc.
        continue;
      }
      cur.description = cur.description ? `${cur.description} ${t}` : t;
    }
  }

  // ===== SKILLS =====
  // Handles both "Label: a, b, c" per-line AND merged blocks like
  // "AI / GenAI: LLMs · RAG … Deepgram STT/TTS Product & BA: Roadmapping …
  // Technical: SQL …" — a label is text between the last ·•| separator
  // (or block start) and a colon, restricted to short alpha labels.
  const skillBucket = (label: string, items: string[]) => {
    if (!items.length) return;
    const l = label.toLowerCase();
    if (/program/.test(l)) candidate.skills.programming!.push(...items);
    else if (/cloud|devops|tool|platform|framework/.test(l)) candidate.skills.tools!.push(...items);
    else if (/language/.test(l)) candidate.skills.languages!.push(...items);
    else if (/soft|interpersonal/.test(l)) candidate.skills.soft!.push(...items);
    else if (/software/.test(l)) candidate.skills.software!.push(...items);
    else if (/product|business|\bba\b|domain|area|interest/.test(l)) candidate.skills.domain!.push(...items);
    else candidate.skills.technical!.push(...items);
  };

  for (const seg of segments.filter(s => s.section === "SKILLS")) {
    let pendingLabel = "";
    for (const b of seg.blocks.slice(1)) { // skip the SKILLS heading
      const t = b.text.trim();
      if (!t) continue;

      // Locate label boundaries: colon preceded by a short alpha label
      // anchored at a ·•| separator or block start. Labels allow spaced
      // "/" ("AI / GenAI") but not intra-word slashes ("STT/TTS") — on
      // failure drop leading words until a valid label suffix remains,
      // so "Deepgram STT/TTS Product & BA:" yields label "Product & BA"
      // and keeps "Deepgram STT/TTS" in the previous group's items.
      const STRICT_LABEL = /^[A-Za-z][A-Za-z &+]*(?:\s+\/\s+[A-Za-z &+]+)*$/;
      const bounds: Array<{ label: string; start: number; itemsStart: number }> = [];
      const colonRe = /[:：]/g;
      let cm: RegExpExecArray | null;
      while ((cm = colonRe.exec(t))) {
        const before = t.slice(0, cm.index);
        const sepIdx = Math.max(before.lastIndexOf("·"), before.lastIndexOf("•"), before.lastIndexOf("|"), before.lastIndexOf("\n"));
        let cand = before.slice(sepIdx + 1).trim();
        while (cand && !(cand.length <= 40 && STRICT_LABEL.test(cand))) {
          cand = cand.split(/\s+/).slice(1).join(" ");
        }
        if (cand && cand.length <= 40) {
          bounds.push({ label: cand, start: before.lastIndexOf(cand), itemsStart: cm.index + 1 });
        }
      }

      if (bounds.length) {
        bounds.forEach((bd, i) => {
          const itemsText = t.slice(bd.itemsStart, bounds[i + 1]?.start ?? t.length);
          const sep = /[·•]/.test(itemsText) ? /[·•]/ : /[,;]/;
          const items = itemsText.split(sep).map(s => s.trim()).filter(s => s.length > 0 && s.length < 60 && !s.endsWith(":"));
          skillBucket(bd.label, items);
          pendingLabel = items.length ? "" : bd.label.toLowerCase();
        });
      } else {
        // Bare label line ("Cloud / DevOps:") — values on next block
        if (/^[A-Za-z][A-Za-z /&+]{1,40}:$/.test(t)) {
          pendingLabel = t.slice(0, -1).toLowerCase();
          continue;
        }
        const items = t.split(/[·•,;]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 60 && !s.endsWith(":"));
        skillBucket(pendingLabel, items);
        pendingLabel = "";
      }
    }
  }

  // ===== CERTIFICATIONS =====
  for (const seg of segments.filter(s => s.section === "CERTIFICATIONS")) {
    for (const b of seg.blocks.slice(1)) {
      for (const c of b.text.split(/[;•]/)) {
        const v = c.trim().replace(/\.$/, "");
        if (v.length > 3 && v.length < 160) candidate.certifications.push(v);
      }
    }
  }

  // ===== ACHIEVEMENTS (leadership/workshops/etc.) =====
  for (const seg of segments.filter(s => s.section === "ACHIEVEMENTS")) {
    for (const b of seg.blocks.slice(1)) {
      const v = b.text.trim().replace(/\.$/, "");
      if (v.length > 3 && v.length < 300) candidate.achievements.push(v);
    }
  }

  // ===== LANGUAGES =====
  for (const seg of segments.filter(s => s.section === "LANGUAGES")) {
    for (const b of seg.blocks.slice(1)) {
      for (const l of b.text.split(/\||;/)) {
        const v = l.trim();
        if (v.length > 1 && v.length < 120) candidate.skills.languages!.push(v);
      }
    }
  }

  // ===== SANITY + DEDUPE =====
  const clean = sanitizeCandidate(candidate);

  // ===== MAP → ParsedCV (existing contract) =====
  const engine = "cv-docling";
  const mapped: ParsedCV = {
    personalData: {
      firstName: clean.personalData?.firstName || "",
      lastName: clean.personalData?.lastName || "",
      email: clean.personalData?.email || "",
      phone: clean.personalData?.phone || "",
      currentCity: clean.personalData?.currentCity || "",
      currentCountry: clean.personalData?.currentCountry || "",
      nationality: clean.personalData?.nationality || "",
      linkedin: clean.personalData?.linkedin,
      github: clean.personalData?.github,
    },
    education: clean.education.map((e: any): ParsedEducation => ({
      id: cvId(engine),
      institution: e.institution || "",
      degree: e.degree || "",
      specialization: e.fieldOfStudy || "",
      startYear: (e.startYear || "").replace(/\D/g, "").slice(0, 4),
      endYear: /present|current|ongoing/i.test(e.endYear || "") ? "" : (e.endYear || "").replace(/\D/g, "").slice(0, 4),
      cgpa: e.gpa || "",
      cgpaScale: e.maxGpa || "",
      ...(e.confidence ? { confidence: e.confidence, source: e.source } : {}),
    } as ParsedEducation)),
    experience: clean.experience.map((e: any): ParsedExperience => ({
      id: cvId(engine),
      type: /research/i.test(e.sectionHeading || "") ? "Research"
        : /intern/i.test(e.role || "") ? "Internship"
        : "Full-time Job",
      organization: e.organization || "",
      role: e.role || "",
      location: e.location || "",
      startDate: e.startDate || "",
      endDate: /present|current|ongoing/i.test(e.endDate || "") ? "" : (e.endDate || ""),
      currentlyWorking: /present|current|ongoing/i.test(e.endDate || ""),
      responsibilities: (e.bullets || []).join("\n"),
      ...(e.confidence ? { confidence: e.confidence, source: e.source } : {}),
    } as ParsedExperience)),
    projects: clean.projects.map((p: any): ParsedProject => ({
      id: cvId(engine),
      name: p.name || "",
      type: "Academic",
      description: p.description || "",
      technologies: p.technologies || "",
      role: p.role || "",
      ...(p.confidence ? { confidence: p.confidence, source: p.source } : {}),
    } as ParsedProject)),
    skills: {
      technical: clean.skills.technical || [],
      programming: clean.skills.programming || [],
      tools: clean.skills.tools || [],
      software: clean.skills.software || [],
      domain: clean.skills.domain || [],
      soft: clean.skills.soft || [],
    },
    certifications: clean.certifications || [],
    achievements: clean.achievements || [],
    rawTextLength: blocks.reduce((n, b) => n + b.text.length, 0),
    parseWarnings: clean.warnings || [],
    // Parser provenance — engine, version, source hash, timing
    parserMeta: {
      engine: "docling",
      doclingVersion: doc.doclingVersion || "unknown",
      sourceHash: doc.sourceHash || "",
      ocrUsed: !!doc.ocrUsed,
      durationMs: doc.durationMs,
      parsedAt: new Date().toISOString(),
    },
  } as ParsedCV;

  if ((clean.skills.languages || []).length > 0) {
    // Surface languages as soft-skill evidence until canonical schema gains a slot
    mapped.parseWarnings.push(`Languages detected: ${clean.skills.languages!.join("; ")}`);
  }

  return mapped;
}
