// ============================================================
// BENCHMARK CORPUS MANIFEST
// ============================================================
// Real applicant CVs live outside the repo (Desktop / Test pdf).
// Synthetic + failure fixtures are generated into
// test-output/affinda/fixtures/ by generate-fixtures.ts.
// ============================================================

export interface CorpusEntry {
  /** absolute path or path under test-output/affinda/fixtures */
  file: string;
  label: string;
  format: string;
  /** notes on expected structure for structural evaluation */
  expect?: string;
  kind: "real" | "synthetic" | "failure";
}

const DESKTOP = "/Users/shivang/Desktop";
const TESTPDF = `${DESKTOP}/AI SOP/Test pdf`;
const FIXT = `${process.cwd()}/test-output/affinda/fixtures`;

export const REAL_CVS: CorpusEntry[] = [
  {
    file: `${DESKTOP}/KHUSHI .CV.docx`,
    label: "KHUSHI",
    format: "table-based DOCX",
    kind: "real",
    expect:
      "5 experience/internship/clerkship groups; Pharm D degree; 12th/10th preserved; JULY/2022 dates; research/publications; English/Gujarati/Hindi; achievements not merged",
  },
  {
    file: `${DESKTOP}/cv/Shivang_Singh_Gangwar_Resume.docx`,
    label: "SHIVANG-DOCX",
    format: "normal DOCX",
    kind: "real",
    expect: "edu 2 (MBA IT, BCA); exp 2 (Ciright, Ambimat); projects 2; cert 1; ~20 skills",
  },
  {
    file: `${DESKTOP}/cv/Shivang_Singh_Gangwar_Resume.pdf`,
    label: "SHIVANG-PDF",
    format: "single-column PDF",
    kind: "real",
    expect: "same content as SHIVANG-DOCX",
  },
  {
    file: `${DESKTOP}/shivang-singh.pdf`,
    label: "TESTCAND-PDF",
    format: "PDF (letter-spaced headings)",
    kind: "synthetic",
    expect: "prior test fixture — 'Test Candidate' resume",
  },
  {
    file: `${TESTPDF}/kunj modh (1) (1).docx`,
    label: "KUNJ-DOCX-IMG",
    format: "image-only DOCX (OCR test)",
    kind: "real",
    expect: "no text layer — docling/legacy fail; tests Affinda OCR path",
  },
  {
    file: `${TESTPDF}/kunj modh (1) (1).pdf`,
    label: "KUNJ-PDF",
    format: "PDF",
    kind: "real",
    expect: "same content as KUNJ-DOCX",
  },
  {
    file: `${TESTPDF}/Kunj_Manojkumar_Modh_Resume.pdf`,
    label: "KUNJ-PDF-ALT",
    format: "PDF",
    kind: "real",
    expect: "Kunj Manojkumar Modh",
  },
];

export const SYNTHETIC_CVS: CorpusEntry[] = [
  { file: `${FIXT}/synth-table.docx`, label: "SYNTH-TABLE", format: "table-based DOCX", kind: "synthetic", expect: "2 exp, 2 edu, publications" },
  { file: `${FIXT}/synth-twocol.pdf`, label: "SYNTH-2COL", format: "two-column PDF", kind: "synthetic", expect: "sidebar skills + main exp/edu" },
  { file: `${FIXT}/synth-singlecol.pdf`, label: "SYNTH-SINGLECOL", format: "single-column PDF", kind: "synthetic", expect: "experienced professional" },
  { file: `${FIXT}/synth-healthcare.pdf`, label: "SYNTH-HEALTH", format: "healthcare PDF", kind: "synthetic", expect: "clerkships + license" },
  { file: `${FIXT}/synth-academic.docx`, label: "SYNTH-ACADEMIC", format: "academic DOCX", kind: "synthetic", expect: "publications, research, teaching" },
  { file: `${FIXT}/synth-fresher.docx`, label: "SYNTH-FRESHER", format: "fresher DOCX", kind: "synthetic", expect: "edu + projects, no work exp" },
];

export const FAILURE_FIXTURES: CorpusEntry[] = [
  { file: `${FIXT}/corrupt.docx`, label: "CORRUPT-DOCX", format: "corrupt DOCX", kind: "failure", expect: "PARSER_REJECTED / EMPTY_STRUCTURED_RESULT" },
  { file: `${FIXT}/blank.docx`, label: "BLANK-DOCX", format: "blank DOCX", kind: "failure", expect: "EMPTY_STRUCTURED_RESULT" },
  { file: `${FIXT}/blank.pdf`, label: "BLANK-PDF", format: "blank PDF", kind: "failure", expect: "EMPTY_STRUCTURED_RESULT / PARSER_REJECTED" },
  { file: `${FIXT}/sparse.docx`, label: "SPARSE", format: "sparse resume DOCX", kind: "failure", expect: "partial fields, low quality" },
  {
    file: "/Users/shivang/Desktop/AI SOP/drive-download-20260907T155410Z-1-001/Bachelor_s SOP/Sample 1.pdf",
    label: "NONRESUME-SOP",
    format: "non-resume PDF (SOP essay)",
    kind: "failure",
    expect: "NOT_A_RESUME or EMPTY_STRUCTURED_RESULT",
  },
  {
    file: `${DESKTOP}/cv/Shivang Singh Gangwar.pdf`,
    label: "NONRESUME-CERT",
    format: "non-resume PDF (certificate)",
    kind: "failure",
    expect: "NOT_A_RESUME or EMPTY_STRUCTURED_RESULT — it is a certificate, not a CV",
  },
];

export const ALL_ENTRIES: CorpusEntry[] = [...REAL_CVS, ...SYNTHETIC_CVS, ...FAILURE_FIXTURES];
