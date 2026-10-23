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
import { createCVParseFailure } from "./cv-parser";
import { sanitizeCandidate } from "./cv-sanity";

/** Bump on any mapper logic change — invalidates cached dedup metas. */
export const CV_MAPPER_VERSION = "17";

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
// Role evidence for merged experience blocks — whole words only, so
// "International" / "Leadership" never count as "intern" / "lead".
const ROLE_WORDS = /\b(?:intern(?:ship)?|engineer|developer|programmer|analyst|manager|consultant|assistant|associate|lead|director|designer|architect|researcher|officer|specialist|coordinator|scientist|trainee|founder|co-founder|executive|teacher|tutor|supervisor|administrator|freelancer|freelance)s?\b/i;
// Responsibility bullets open with an action verb — never a job title.
const ACTION_VERB_START = /^(?:built|developed|created|designed|implemented|led|worked|contributed|managed|owned|wrote|maintained|organi[sz]ed|delivered|launched|improved|reduced|increased|analy[sz]ed|conducted|collaborated|handled|supported|assisted|helped|tested|trained|optimi[sz]ed|profiled|shipped|automated|migrated|deployed|coordinated|mentored|researched|used|utili[sz]ed|performed|explored|achieved|served|applied|presented|earned|forecast|indexed|gained)\b/i;
const isRoleTitle = (s: string) =>
  !!s && s.split(/\s+/).length <= 8 && ROLE_WORDS.test(s) && !ACTION_VERB_START.test(s);

function cvId(engine: string): string {
  return `${engine}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/** Known resume-section heading? → section; otherwise null (entry title).
 *  `strict` (title-type blocks): every word must be section vocabulary or a
 *  generic qualifier — "Student Management Project" mentions "project" but
 *  is an entry title, while "Work Experience" / "Technical Skills" still
 *  classify. section_header blocks keep the looser substring rule. */
const SECTION_QUALIFIER = /^(?:my|our|the|a|an|of|and|&|\+|for|in|on|at|selected|key|relevant|notable|major|main|top|other|additional|academic|professional|technical|personal|career|work|employment|history|background|details?|information|info|profile|summary|list)$/i;
function sectionOf(text: string, strict = false): Section | null {
  const t = text.trim().replace(/[:\-–—|]+$/, "").trim();
  if (t.length > 60) return null;
  for (const [re, sec] of SECTION_KEYWORDS) {
    if (!re.test(t)) continue;
    if (!strict) return sec;
    const covered = t.split(/\s+/).filter(Boolean).every(w =>
      SECTION_KEYWORDS.some(([re2]) => re2.test(w)) || SECTION_QUALIFIER.test(w));
    if (covered) return sec;
  }
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

// Lowercase name particles in multiword surnames ("da Vinci", "van der Berg").
const NAME_PARTICLE = /^(?:van|von|de|der|den|da|di|del|della|du|la|le|el|al|bin|ibn|af|av|dos|das|ten|ter|zu|san|st\.?)$/i;
// Organization vocabulary — "Acme Corporation" / "…Institute of
// Technology" headers are orgs, never applicants.
const ORG_WORDS = /\b(?:universit(?:y|ies)|college|institut(?:e|ions?|ional)?|school|academ(?:y|ia|ics?)|polytechnic|corp(?:oration|orate)?|inc|llc|ltd|compan(?:y|ies)|technolog(?:y|ies)|labs?|laborator(?:y|ies)|group|solutions?|industr(?:y|ies|ial)|foundations?|associat(?:ions?|es?)|systems?|enterpris(?:es?)?|consult(?:ing|ancy|ants?)?|services?|hospitals?|banks?|agenc(?:y|ies)|departments?|ministr(?:y|ies)|studios?|partners?)\b/i;

function looksLikeName(text: string, allowDigits = false): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 60 || /@|http/i.test(t)) return false;
  if (/\d/.test(t) && !allowDigits) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w, i) =>
    /^\p{Lu}[\p{L}\p{M}.'-]*$/u.test(w) ||          // Title-word, any script
    /^\p{Lu}[\p{Lu}\p{M}.'-]*$/u.test(w) ||        // ALL-CAPS word / initial
    (i > 0 && NAME_PARTICLE.test(w)) ||            // van, de, di…
    (allowDigits && /^\p{Lu}[\p{Lu}\p{N}.'-]*$/u.test(w))); // tag like "E2E"
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
      const sec = sectionOf(b.text, b.type === "title");
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
    // Page gate: PDF blocks carry page numbers (page 1 = name header).
    // DOCX blocks have page=null — there is no pagination, so allow
    // early-document blocks (reading-order proxy for "page 1").
    const nameLike = (b: (typeof blocks)[number], allowDigits = false) =>
      (b.type === "section_header" || b.type === "title") &&
      (b.page === 1 || (b.page == null && b.order < 15)) &&
      !sectionOf(b.text) &&
      !ROLE_WORDS.test(b.text) && !ORG_WORDS.test(b.text) &&
      looksLikeName(b.text, allowDigits);
    const personalBlocks = segments
      .filter(s => s.section === "PERSONAL" || s.section === "SUMMARY")
      .flatMap(s => s.blocks);
    // A contact-bearing block near a candidate is corroborating evidence —
    // only within the pre-section header region (a "phone" can be a year
    // range inside a body block).
    const contactNearby = (b: (typeof blocks)[number]) => personalBlocks.some(nb =>
      nb.order > b.order &&
      (EMAIL_RE.test(nb.text) || PHONE_RE.test(nb.text) || LINKEDIN_RE.test(nb.text)));
    const allCaps = blocks.find(b => nameLike(b) && b.text.trim() === b.text.trim().toUpperCase() && /\p{Lu}/u.test(b.text));
    const personalPick = personalBlocks.find(b => nameLike(b));
    // Digit-tagged names ("QA E2E Applicant") need stronger context:
    // document-leading position AND nearby contact info — a bare
    // digit-string deeper in the file is a tag, not a person.
    const digitPick = personalBlocks.find(b => nameLike(b, true) && b.order <= 2 && contactNearby(b));
    const pick = allCaps || personalPick || digitPick;
    if (pick) {
      detectedName = pick.text.trim();
      // Title-case ALL-CAPS name headers for display — Unicode-aware
      // word starts (\b\w is ASCII-only and mangles "ÉLODIE" → "éLodie").
      if (detectedName === detectedName.toUpperCase()) {
        detectedName = detectedName.toLowerCase()
          .replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());
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
  // "(expected)"/"(ongoing)" parentheticals and metadata labels — status
  // evidence, never degree/institution text.
  const EDU_STATUS_PAREN = /\(\s*(?:expected|anticipated|ongoing|pursuing|current|enrolled|continuing)\s*\)/gi;
  const EDU_META_LABEL = /^(?:relevant\s+)?(?:coursework|honou?rs?|dean'?s?\s+list|thesis|minor|achievements?|activities|awards?|scholarships?|rank|grades?|modules?|subjects?)\b/i;
  // Inline metadata boundary: a labelled marker with a colon ("Modules:",
  // "Thesis:") or a compound label ("Relevant coursework", "Dean's List",
  // "Minor in …") — cuts metadata out of field text even without a "|".
  const EDU_META_CUT = /(?:dean'?s?\s+list|minor\s+in|relevant\s+coursework)|(?:coursework|thesis|achievements?|activities|awards?|scholarships?|modules?|subjects?|honou?rs?|rank|grades?)\s*:/i;
  const cutEduMeta = (s: string): [string, string] => {
    const m = s.match(EDU_META_CUT);
    if (!m || !m.index) return [s, ""];
    return [s.slice(0, m.index).replace(/[,;\s]+$/g, "").trim(), s.slice(m.index).trim()];
  };
  // A tail starting with a status/GPA/coursework marker continues the
  // previous record — it is not a new education record.
  // Continuation markers tolerate leading formatting separators — a
  // "| GPA 3.7/4.0" tail is the same continuation as "| CGPA …" or
  // "(expected)"; the separator is presentation, not a new record.
  const EDU_CONTINUATION = /^\s*[(\[|·•;]*\s*(?:expected|anticipated|ongoing|pursuing|current|enrolled|cgpa|gpa|score|percentage|grade|relevant|coursework|honou?rs?|dean|thesis|minor|scholarship|rank)\b/i;
  // Parse one merged education record: pipes separate logical parts
  // ("Degree | Institution" / "… | CGPA …"); inside a part the degree side
  // is whichever dash-part carries degree vocabulary — works for both
  // "Degree - Institution" and "Institution - Degree" orders.
  const parseEducationRec = (rec: string, page: any) => {
    const e: any = { institution: "", degree: "", fieldOfStudy: "", gpa: "", maxGpa: "", startYear: "", endYear: "", confidence: "HIGH", sourceText: [rec], page, bullets: [] as string[] };
    const d = parseDateRange(rec);
    e.startYear = d.start || ""; e.endYear = d.end || "";
    for (const rawPart of rec.split("|")) {
      let part = rawPart.replace(DATE_RANGE_G, " ").replace(EDU_STATUS_PAREN, " ").replace(/\s{2,}/g, " ").trim();
      if (!part) continue;
      const g = part.match(GPA_RE);
      if (g) {
        if (!e.gpa) {
          e.gpa = g[2];
          if (g[3]) e.maxGpa = g[3];
          else if (/%/.test(part)) e.maxGpa = "100";
        }
        part = (part.slice(0, g.index) + " " + part.slice((g.index || 0) + g[0].length)).replace(/\s{2,}/g, " ").trim();
        if (!part) continue;
      }
      // Trailing bare score with no label ("… MIT 8.9/10") is a grade, not
      // institution text.
      part = part.replace(/\s+\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*$/, "").trim();
      if (!part) continue;
      if (EDU_META_LABEL.test(part)) { e.bullets.push(part); continue; }
      {
        const [field, meta] = cutEduMeta(part);
        if (meta) {
          e.bullets.push(meta);
          part = field;
          if (!part) continue;
        }
      }
      const dash = part.split(/\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
      const di = dash.findIndex(x => DEGREE_WORDS.test(x));
      if (dash.length >= 2 && di >= 0) {
        const dd = parseDegreeLine(dash[di]);
        if (!e.degree) { e.degree = dd.degree; e.fieldOfStudy = dd.fieldOfStudy; }
        else e.bullets.push(dash[di]);
        const rest = dash.filter((_, i) => i !== di).join(" - ");
        if (rest) {
          const { title } = splitEntry(rest);
          if (!e.institution) e.institution = title;
          else e.bullets.push(rest);
        }
      } else if (dash.length >= 2) {
        const { title } = splitEntry(part);
        if (!e.institution) e.institution = title;
        else e.bullets.push(part);
      } else if (DEGREE_WORDS.test(part)) {
        const dd = parseDegreeLine(part);
        if (!e.degree) { e.degree = dd.degree; e.fieldOfStudy = dd.fieldOfStudy; }
        else e.bullets.push(part);
      } else {
        const { title } = splitEntry(part);
        if (!e.institution) e.institution = title;
        else e.bullets.push(part);
      }
    }
    return e;
  };
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
      // Split on date-range boundaries; a tail beginning with a status
      // marker, GPA label or coursework label CONTINUES the previous record
      // ("(expected) | CGPA 8.9/10.0 Relevant coursework: …") — only a tail
      // with its own degree/cert evidence starts a new record.
      DATE_RANGE_G.lastIndex = 0;
      const dateMatches: RegExpExecArray[] = [];
      let dm: RegExpExecArray | null;
      while ((dm = DATE_RANGE_G.exec(t))) dateMatches.push(dm);
      if (dateMatches.length && DEGREE_WORDS.test(t)) {
        // Institution header open + single merged degree/date line →
        // complete the open record rather than duplicating it.
        if (dateMatches.length === 1 && cur && !cur.degree) {
          const d = parseDateRange(t);
          if (d.start) cur.startYear = cur.startYear || d.start;
          if (d.end) cur.endYear = cur.endYear || d.end;
          const g = t.match(GPA_RE);
          if (g) { cur.gpa = g[2]; if (g[3]) cur.maxGpa = g[3]; }
          const [degField] = cutEduMeta(t.replace(DATE_RANGE_G, " ").replace(GPA_RE, " ")
            .replace(EDU_STATUS_PAREN, " ").replace(/\s{2,}/g, " ").trim());
          // "Degree - Institution, City dates": an explicit institution in
          // the entry wins over the header guess — never attach the degree
          // to the wrong institution.
          const dash = degField.split(/\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
          const di = dash.findIndex(x => DEGREE_WORDS.test(x));
          if (di >= 0) {
            const dd = parseDegreeLine(dash[di]);
            cur.degree = dd.degree;
            cur.fieldOfStudy = dd.fieldOfStudy;
            const rest = dash.filter((_, i) => i !== di).join(" - ");
            if (rest) {
              const { title } = splitEntry(rest);
              // Explicit entry evidence wins over the header guess — but
              // only when it actually looks like an institution, so
              // "B.Tech - Honors Program" can't mislabel the record.
              if (/universit|college|institut|school|academ|polytechnic|vidyalaya|campus/i.test(title)) {
                cur.institution = title;
              } else {
                cur.bullets.push(rest);
              }
            }
          } else if (DEGREE_WORDS.test(degField)) {
            const dd = parseDegreeLine(degField);
            cur.degree = dd.degree;
            cur.fieldOfStudy = dd.fieldOfStudy;
          }
          cur.sourceText.push(t);
          consumedBlocks.add(b.order);
          continue;
        }
        const recs: string[] = [];
        let lastEnd = 0;
        for (let i = 0; i < dateMatches.length; i++) {
          const m = dateMatches[i];
          recs.push(t.slice(lastEnd, m.index! + m[0].length));
          lastEnd = m.index! + m[0].length;
          // A continuation marker directly after this date belongs to the
          // record just closed — "| GPA 3.7/4.0" after "…2021 - 2025" is
          // THAT record's grade, never the next record's head. Consume it
          // up to the next separator or degree-word boundary.
          const gapEnd = i + 1 < dateMatches.length ? dateMatches[i + 1].index! : t.length;
          const rest = t.slice(lastEnd, gapEnd);
          const cm = rest.match(EDU_CONTINUATION);
          if (cm) {
            const rem = rest.slice(cm[0].length);
            const stops = [/[|·•;\n]/, DEGREE_WORDS]
              .map(rx => rem.search(rx))
              .filter(x => x >= 0);
            const cEnd = cm[0].length + (stops.length ? Math.min(...stops) : rem.length);
            recs[recs.length - 1] += " " + rest.slice(0, cEnd).trim();
            lastEnd += cEnd;
          }
        }
        const tail = t.slice(lastEnd).trim();
        if (tail) {
          if (recs.length && EDU_CONTINUATION.test(tail)) {
            recs[recs.length - 1] += " " + tail;
          } else {
            recs.push(tail);
          }
        }
        for (const r of recs) {
          const rec = r.trim();
          if (!rec) continue;
          if (/certif|certified|certificate|course\b/i.test(rec) && !DEGREE_WORDS.test(rec)) {
            // "Product Management Certification - AltUni by Inside IIM"
            const parts = rec.split(/\s+[-–—]\s+/);
            candidate.certifications.push(parts.map(s => s.trim()).filter(Boolean).join(" - "));
            continue;
          }
          candidate.education.push(parseEducationRec(rec, b.page));
        }
        // The last pushed record is the live one — a following GPA or
        // continuation block attaches to it (merged layout leaves cur
        // null otherwise, dropping standalone grade lines).
        cur = candidate.education[candidate.education.length - 1] || cur;
        continue;
      }

      if (DATE_ONLY.test(t)) {
        const d = parseDateRange(t);
        // Fill-only: a bare date block completes an open record but never
        // overwrites dates that merged-line evidence already provided.
        if (cur) { cur.startYear = cur.startYear || d.start; cur.endYear = cur.endYear || d.end; consumedBlocks.add(b.order); }
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
  // Merged-block opener: "Role - Org, City Jun 2025 - Dec 2025 bullets…"
  // Docling emits whole entries as ONE text block — only open an entry on
  // real evidence: a date range AND a job-title head before it (a whole-word
  // role term, not a verb-led responsibility).
  const openMergedExperience = (t: string, segHeading: string, page: any) => {
    DATE_RANGE_G.lastIndex = 0;
    const m = DATE_RANGE_G.exec(t);
    if (!m) return null;
    const head = t.slice(0, m.index).trim();
    const tail = t.slice(m.index + m[0].length).trim();
    if (!head || head.length > 120) return null;
    const parts = head.split(/\s+[-–—|]\s+/).map(s => s.trim()).filter(Boolean);
    let role = "", organization = "", location = "";
    if (parts.length >= 2) {
      if (!isRoleTitle(parts[0])) return null;
      role = parts[0];
      const parsed = splitEntry(parts.slice(1).join(" - "));
      organization = parsed.title;
      location = parsed.location || "";
      if (!organization) return null;
    } else if (isRoleTitle(head)) {
      role = head;
    } else {
      return null;
    }
    const d = parseDateRange(m[0]);
    return {
      organization, role, location,
      startDate: d.start || "", endDate: d.end || "",
      bullets: tail ? [tail] : [],
      sectionHeading: segHeading, confidence: "MEDIUM",
      source: { text: t, page },
    };
  };

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
      if (!cur) {
        const opened = openMergedExperience(t, segHeading, b.page);
        if (opened) {
          cur = opened;
          consumedBlocks.add(b.order);
          candidate.experience.push(cur);
        }
        continue;
      }
      const next = openMergedExperience(t, segHeading, b.page);
      if (next) {
        consumedBlocks.add(b.order);
        if (!next.organization && cur.organization && !cur.role) {
          // "Acme Corporation" header + "Software Engineer Jan 2024 - Mar 2024":
          // the role/date line completes the header's entry — no orphan record.
          cur.role = next.role;
          if (!cur.startDate) { cur.startDate = next.startDate; cur.endDate = next.endDate; }
          cur.bullets.push(...next.bullets);
        } else {
          // A genuinely separate merged entry — open it rather than
          // swallowing the whole line into the previous record's bullets.
          cur = next;
          candidate.experience.push(cur);
        }
        continue;
      }
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
  // Merged-block opener: "Name - Tech1, Tech2 (Jan 2025 - Apr 2025) desc…"
  // Docling emits whole entries as ONE text block — open a project only on
  // structural evidence: a date range, a "Name | tech" separator, or a short
  // title-like name. Verb-led sentences never become project records.
  // A role-hint line is a pure category phrase ("Academic AI Project",
  // "Personal Project") — every word is a category word. "Personal
  // Knowledge Vault" is a real project name, not a role line.
  const PROJECT_ROLE_WORDS = /^(?:academic|personal|capstone|volunteer|freelance|research|internship|independent|group|team|hackathon|coursework|course|college|university|school|self|side|pet|final|year|major|minor|mini|open|source|ai|ml|project|work|assignment|portfolio|experiment|study|[-\s])+$/i;
  const isProjectRoleLine = (t: string) => t.length < 80 && PROJECT_ROLE_WORDS.test(t.trim());
  // Generic per-entry subheadings ("Key Contributions", "Technical
  // Implementation") — every word is a descriptor, never a project name.
  const SUBHEADING_WORDS = /^(?:key|main|core|major|minor|primary|technical|implementation|details?|overview|summary|description|highlights?|contributions?|responsibilit(?:y|ies)|features?|functionalit(?:y|ies)|outcomes?|results?|approach|architecture|design|tech(?:nologies)?|stack|tools?|duration|timeline|role|scope|impact|challenges?|learnings?|objectives?|methodolog(?:y|ies)|components?|modules?|phases?|status|links?|demo|github|url)$/i;
  const techItem = (s: string) => s.split(/\s+/).length <= 4 && s.length <= 40 && !/[.!?;:]$/.test(s);
  const looksLikeTechList = (s: string, allowSingle: boolean) => {
    const items = s.split(/\s*[,+]\s*/).map(x => x.trim()).filter(Boolean);
    if (!items.length || (!allowSingle && items.length < 2)) return false;
    return items.every(techItem);
  };
  const isProjectName = (s: string, corroborated: boolean) => {
    const words = s.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 8 || s.length > 80) return false;
    if (ACTION_VERB_START.test(s)) return false;
    if (/[.;:!?]$/.test(s) || /\s(?:of|for|from|to|in|on|at|with|by|and|or|the|a|an)$/i.test(s)) return false;
    if (/^(?:the|a|an|my|our|this|that|these|those|i|we|they|it|he|she|during|while|after|before|through|using|via|from|in|on|at|to|for|with|by|as|when|where|which)\b/i.test(s)) return false;
    if (detectedNameNorm && s.toLowerCase() === detectedNameNorm) return false;
    if (words.every(w => SUBHEADING_WORDS.test(w))) return false;
    // Uncorroborated names must be title-cased — lowercase prose can't pass.
    if (!corroborated) {
      return words.every(w => /^[A-Z0-9(]/.test(w) || /^(?:of|the|a|an|for|and|in|on|de|la|&|v\.?s\.?)$/i.test(w));
    }
    return true;
  };
  const openMergedProject = (t: string, page: any, allowBareName = true) => {
    const clean = t.replace(/\s*GitHub\s*↗?\s*/gi, "").trim();
    if (!clean) return null;
    let name = "", technologies = "", description = "";
    DATE_RANGE_G.lastIndex = 0;
    const m = DATE_RANGE_G.exec(clean);
    if (m) {
      const head = clean.slice(0, m.index).replace(/[([{\s]+$/, "").trim();
      const tail = clean.slice(m.index + m[0].length).replace(/^[)\]}]+\s*/, "").trim();
      if (!head || head.length > 120) return null;
      const parts = head.split(/\s+[-–—|]\s+/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const tech = parts.slice(1).join(" - ");
        if (!isProjectName(parts[0], true) || !looksLikeTechList(tech, true)) return null;
        name = parts[0];
        technologies = tech;
      } else {
        if (!isProjectName(head, true)) return null;
        name = head;
      }
      // No ParsedCV project-dates field — fold the raw range into the
      // description so the evidence stays visible without inventing schema.
      description = [`(${m[0].trim()})`, tail].filter(Boolean).join(" ");
    } else {
      const parts = clean.split(/\s+[-–—|]\s+/).map(s => s.trim()).filter(Boolean);
      const allowSingle = !/\s[-–—]\s/.test(clean); // "|" is explicit; "- Tech" alone needs a list
      if (parts.length >= 2 && looksLikeTechList(parts.slice(1).join(" - "), allowSingle)) {
        if (!isProjectName(parts[0], true)) return null;
        name = parts[0];
        technologies = parts.slice(1).join(" - ");
      } else if (allowBareName && isProjectName(clean, false)) {
        name = clean;
      } else {
        return null;
      }
    }
    return { name, role: "", description, technologies, confidence: "MEDIUM", source: { text: t, page } };
  };
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
      // A category line ("Academic AI Project") is recognized regardless of
      // whether the open record's role is already set — it fills the role
      // once, never opens a project, never lands in the description.
      const roleHint = isProjectRoleLine(t);
      const next = openMergedProject(t, b.page, !roleHint);
      if (next) {
        cur = next;
        candidate.projects.push(cur);
        continue;
      }
      if (!cur) continue;
      if (roleHint) {
        if (!cur.role) cur.role = t; // "Academic AI Project" etc.
        continue;
      }
      cur.description = cur.description ? `${cur.description} ${t}` : t;
    }
  }

  // Prose guards shared by the skills and credentials sections: a
  // subject/determiner-led phrase ("I enjoy…", "The team…") or a
  // sentence-case phrase carrying a finite verb is a sentence, not a
  // record. Title-Case multiword phrases ("Use Case Modeling") are noun
  // phrases — the ambiguous word is a noun there.
  const SENTENCE_START = /^(?:i|we|my|our|it|he|she|they|this|that|these|those|there|the|a|an|during|while|after|before|when|where|through|over|as|in|on|at|to|for|with|by|from)\s/i;
  const SENTENCE_VERB = /\b(?:am|is|are|was|were|be|been|being|have|has|had|do|does|did|can|could|will|would|shall|should|may|might|must|enjoy(?:s|ed|ing)?|like[ds]?|liking|love[ds]?|loving|prefer(?:s|red|ring)?|hate[ds]?|want(?:s|ed|ing)?|need(?:s|ed|ing)?|feel(?:s|ing)?|seem(?:s|ed|ing)?|become|became|grew|grow(?:s|ing)?|learn(?:s|ed|t|ing)?|help(?:s|ed|ing)?|work(?:s|ed|ing)?|build(?:s|ing)?|built|make|makes|made|making|use[ds]?|using|get|gets|got|getting|take|takes|took|taking|give|gives|gave|giving|try|tries|tried|trying|earn(?:s|ed|ing)?|receiv(?:e[ds]?|ing)|won|win(?:s|ning)?|met|meet(?:s|ing)?|attend(?:s|ed|ing)?|join(?:s|ed|ing)?|went|go(?:es|ing)?|spent|spend(?:s|ing)?)\b/i;
  const TITLE_CONNECTOR = /^(?:of|the|a|an|and|or|in|on|de|la|&|vs\.?)$/i;
  const isTitleCased = (s: string) => s.split(/\s+/).filter(Boolean).every(w =>
    /^[A-Z0-9(&/+-]/.test(w) || TITLE_CONNECTOR.test(w));

  // ===== SKILLS =====
  // Handles both "Label: a, b, c" per-line AND merged blocks like
  // "AI / GenAI: LLMs · RAG … Deepgram STT/TTS Product & BA: Roadmapping …
  // Technical: SQL …" — a label is text between the last ·•| separator
  // (or block start) and a colon, restricted to short alpha labels.
  // Programming-language vocabulary — positive evidence only. Under an
  // ambiguous "Languages:" label an item is a programming skill ONLY when
  // it matches here; spoken languages (listed or not) and unrecognized
  // items keep the (non-UI) languages bucket so evidence survives via the
  // warning mechanism rather than being mislabelled or discarded.
  const PROGRAMMING_LANG = /^(?:python|java|javascript|typescript|js|ts|c\+\+|cpp|c#|csharp|c|go|golang|rust|ruby|php|swift|kotlin|scala|matlab|perl|sql|pl\/sql|t-sql|dart|lua|haskell|ocaml|elixir|erlang|clojure|julia|fortran|cobol|pascal|ada|lisp|scheme|racket|prolog|bash|shell|powershell|assembly|objective-c|objc|vb|vba|vb\.net|visual basic|groovy|solidity|abap|sas|stata|apex|delphi|f#|elm|zig|nim|crystal|smalltalk|tcl|awk|verilog|vhdl|scratch|coffeescript|actionscript|hack|idl|gdscript|webassembly|wasm|r)$/i;
  const skillBucket = (label: string, items: string[]) => {
    if (!items.length) return;
    const l = label.toLowerCase();
    if (/program/.test(l)) candidate.skills.programming!.push(...items);
    else if (/cloud|devops|tool|platform|framework/.test(l)) candidate.skills.tools!.push(...items);
    else if (/language/.test(l)) {
      // An explicitly spoken-language category ("Spoken Languages:",
      // "Foreign Languages:") overrides per-item vocabulary — nothing in
      // it is a programming skill even when an item's name collides with
      // a programming language ("Go", "R").
      var explicitSpoken = /spoken|foreign/.test(l);
      for (const it of items) {
        const head = it.replace(/\s*[(（].*$/, "").replace(/\s*[-–—].*$/, "").trim();
        (!explicitSpoken && PROGRAMMING_LANG.test(head) ? candidate.skills.programming! : candidate.skills.languages!).push(it);
      }
    }
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
      // Also accept intra-word slashes ("Frameworks/Tools") — but an
      // all-caps slash compound is an acronym pair like "STT/TTS"/"CI/CD",
      // i.e. a value, never label material.
      const LOOSE_LABEL = /^[A-Za-z][A-Za-z &+]*(?:\s*\/\s*[A-Za-z &+]+)*$/;
      const hasAcronymSlash = (s: string) => s.split(/\s+/).some(w => w.includes("/") && w === w.toUpperCase());
      const isSkillLabel = (s: string) =>
        s.length <= 40 && (STRICT_LABEL.test(s) || (LOOSE_LABEL.test(s) && !hasAcronymSlash(s)));
      // A skill item is a short token/phrase, never a sentence fragment —
      // strip a terminal period ("Linux." → "Linux"), then require few
      // words and pass the shared prose guards above.
      const skillItem = (raw: string) => {
        const v = raw.trim().replace(/[.!?]+$/g, "").replace(/^[|·•,;\s]+|[|·•,;\s]+$/g, "").trim();
        if (!v || v.length >= 60 || v.endsWith(":")) return "";
        var words = v.split(/\s+/).length;
        if (words > 6 || SENTENCE_START.test(v)) return "";
        if (words >= 3 && !isTitleCased(v) && SENTENCE_VERB.test(v)) return "";
        return v;
      };
      const bounds: Array<{ label: string; start: number; itemsStart: number }> = [];
      const colonRe = /[:：]/g;
      let cm: RegExpExecArray | null;
      while ((cm = colonRe.exec(t))) {
        const before = t.slice(0, cm.index);
        const sepIdx = Math.max(before.lastIndexOf("·"), before.lastIndexOf("•"), before.lastIndexOf("|"), before.lastIndexOf("\n"));
        let cand = before.slice(sepIdx + 1).trim();
        while (cand && !isSkillLabel(cand)) {
          cand = cand.split(/\s+/).slice(1).join(" ");
        }
        if (cand) {
          bounds.push({ label: cand, start: before.lastIndexOf(cand), itemsStart: cm.index + 1 });
        }
      }

      if (bounds.length) {
        bounds.forEach((bd, i) => {
          const itemsText = t.slice(bd.itemsStart, bounds[i + 1]?.start ?? t.length);
          const sep = /[·•]/.test(itemsText) ? /[·•]/ : /[,;]/;
          const items = itemsText.split(sep).map(skillItem).filter(Boolean);
          skillBucket(bd.label, items);
          pendingLabel = items.length ? "" : bd.label.toLowerCase();
        });
      } else {
        // Bare label line ("Cloud / DevOps:") — values on next block
        if (/^[A-Za-z][A-Za-z /&+]{1,40}:$/.test(t)) {
          pendingLabel = t.slice(0, -1).toLowerCase();
          continue;
        }
        const items = t.split(/[·•,;]/).map(skillItem).filter(Boolean);
        skillBucket(pendingLabel, items);
        pendingLabel = "";
      }
    }
  }

  // ===== CERTIFICATIONS & ACHIEVEMENTS =====
  // Combined headings ("Certifications & Achievements") classify as one
  // section but hold both kinds — split merged blocks into entries, then
  // route each by item vocabulary: certification evidence →
  // certifications, achievement evidence → achievements, ambiguous → the
  // segment's own bucket (preserve evidence, never fabricate a class).
  const CERT_EVIDENCE = /\b(?:certif(?:ied|ication|icate|ications?|y)|credential(?:s|ed)?|licen[cs]e[ds]?|licensure|accredit(?:ed|ation|ations)?)\b/i;
  const ACH_EVIDENCE = /\b(?:award|scholarship|honou?r|prize|winner|finalist|medal|grant|fellowship|hackathon|competition|olympiad|contest|merit|dean'?s?\s+list|distinction|recognition|volunteer|workshop|leadership|publication|conference)\b/i;
  // Split one merged block into entries: explicit separators first
  // (| ; • · newlines), then year-anchored boundaries — an entry ends
  // right after " - YYYY"/" - Mon YYYY" when the following text opens a
  // new Title-Case entry rather than continuing lowercase.
  const CRED_YEAR_END = /\s[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\b/gi;
  const splitCredEntries = (t: string): string[] => {
    const out: string[] = [];
    for (const part of t.split(/[|·•;\n]/)) {
      const p = part.trim();
      if (!p) continue;
      let last = 0;
      CRED_YEAR_END.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CRED_YEAR_END.exec(p))) {
        const end = m.index + m[0].length;
        const rest = p.slice(end).trimStart();
        // "(" opens a parenthetical qualifier ("(Renewed)"), never a new
        // entry — it stays attached to the record it follows.
        if (rest && /^[A-Z0-9]/.test(rest)) {
          out.push(p.slice(last, end).trim());
          last = end;
        }
      }
      const tail = p.slice(last).trim();
      if (tail) out.push(tail);
    }
    return out;
  };
  // Entry guard: strip a terminal period, drop prose — the same subject /
  // finite-verb sentence guards the skills section uses.
  const credItem = (raw: string) => {
    const rawT = raw.trim();
    const endsSentence = /[.!?]$/.test(rawT);
    const v = rawT.replace(/[.!?]+$/g, "").trim();
    if (!v || v.length > 160) return "";
    // A credential is a noun-phrase title, never declarative prose.
    // A " - " trailer with ≥2 lowercase content words is a clause, not a
    // date/qualifier — rejects footer lines, punctuated or not.
    const lcContent = (s: string) => s.split(/\s+/).filter(w =>
      /^\p{Ll}/u.test(w) && !TITLE_CONNECTOR.test(w)).length;
    const dashParts = v.split(/\s[-–—]\s*/);
    if (dashParts.length > 1 && lcContent(dashParts[dashParts.length - 1]) >= 2) return "";
    // Credential evidence in title position — the first two words or an
    // overall Title-Case shape, with no finite verb in the head — marks
    // a noun-phrase title, not prose ("Certificate in machine learning."
    // is a credential; "Certificates are not listed." and "Document
    // generated for testing purposes." are sentences).
    const head = v.split(/\s+/).slice(0, 2).join(" ");
    const titledEvidence = !SENTENCE_VERB.test(head) &&
      ((isTitleCased(head) && (CERT_EVIDENCE.test(head) || ACH_EVIDENCE.test(head))) ||
        isTitleCased(v));
    // Terminal .!? with a comma or lowercase content marks a punctuated
    // sentence — but terminal punctuation alone proves nothing; titled
    // records ("Hackathon Finalist, CodeSprint - 2025.") are preserved.
    if (endsSentence && (/,/.test(v) || lcContent(v) >= 2) && !titledEvidence) return "";
    if (SENTENCE_START.test(v)) {
      // "The President's Award - 2023" is a titled credential, not prose —
      // a determiner-led phrase survives only with credential evidence
      // and no finite verb ("The award was given to…" stays rejected).
      const titled = (CERT_EVIDENCE.test(v) || ACH_EVIDENCE.test(v)) && !SENTENCE_VERB.test(v);
      if (!(titled && /^(?:the|a|an)\s/i.test(v))) return "";
    }
    const wc = v.split(/\s+/).length;
    if (wc >= 4 && !isTitleCased(v) && SENTENCE_VERB.test(v) && !titledEvidence) return "";
    return v;
  };
  for (const seg of segments.filter(s => s.section === "CERTIFICATIONS" || s.section === "ACHIEVEMENTS")) {
    const segIsCert = seg.section === "CERTIFICATIONS";
    for (const b of seg.blocks.slice(1)) {
      for (const item of splitCredEntries(b.text)) {
        const v = credItem(item);
        if (!v || v.length < 3) continue;
        const isCert = CERT_EVIDENCE.test(v);
        const isAch = !isCert && ACH_EVIDENCE.test(v);
        if (isCert) candidate.certifications.push(v);
        else if (isAch) candidate.achievements.push(v);
        else if (segIsCert) candidate.certifications.push(v);
        else candidate.achievements.push(v);
      }
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
      mapperVersion: CV_MAPPER_VERSION,
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

  // ===== EMPTY-STRUCTURE GATE =====
  // A substantial document that produced ZERO resume sections means the
  // semantic mapping failed (e.g. table-layout DOCX emitting no
  // section_header blocks). Returning success:true with empty arrays
  // silently destroys applicant data — this must be a typed failure.
  const EMPTY_STRUCTURE_MIN_RAW = 300;
  const skillsTotal = Object.values(mapped.skills || {}).reduce((n: number, b: any) => n + (b?.length || 0), 0);
  const sectionDataCount =
    (mapped.education?.length || 0) +
    (mapped.experience?.length || 0) +
    (mapped.projects?.length || 0) +
    skillsTotal +
    (mapped.certifications?.length || 0) +
    (mapped.achievements?.length || 0);
  if (mapped.rawTextLength >= EMPTY_STRUCTURE_MIN_RAW && sectionDataCount === 0) {
    throw createCVParseFailure("CV_PARSE_EMPTY_STRUCTURE", undefined, {
      rawTextLength: mapped.rawTextLength,
      blockCount: blocks.length,
      engine: "docling",
      mapperVersion: CV_MAPPER_VERSION,
      education: mapped.education?.length || 0,
      experience: mapped.experience?.length || 0,
      projects: mapped.projects?.length || 0,
      skills: skillsTotal,
      certifications: mapped.certifications?.length || 0,
      achievements: mapped.achievements?.length || 0,
    });
  }

  return mapped;
}
