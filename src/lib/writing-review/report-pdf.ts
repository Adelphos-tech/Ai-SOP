// ============================================================
// AI Detection Report PDF — server-side pdf-lib generator.
// Header/branding, score table, honest disclaimer, and the full
// checked-version text with soft-red sentence highlights.
// Pure helpers (sanitize/wrap/span-mapping) are exported for tests.
// ============================================================

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import { join } from "path";
import { aggregateFindings, detectorVerdict } from "./report";
import type { DetectorScore, FlaggedPassage } from "./types";
import { listDetectorDescriptors } from "./detectors";

const PAGE_W = 612, PAGE_H = 792, MARGIN = 50;
const BODY_SIZE = 11, BODY_LEAD = 15;
const META_SIZE = 9.5, META_LEAD = 13;
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.44, 0.48);
const ACCENT = rgb(0.13, 0.35, 0.66);
const FLAG_BG = rgb(0.996, 0.91, 0.91); // soft red — matches UI bg-red-50
const WARN_BG = rgb(1, 0.96, 0.85);
const WARN_INK = rgb(0.55, 0.3, 0.02);
const RULE = rgb(0.85, 0.86, 0.89);

const VERDICT_LABEL: Record<string, string> = {
  AI: "AI-written", MIXED: "Mixed", HUMAN: "Human-like",
};
const MEANING_LABEL: Record<string, string> = {
  AI_PROBABILITY_PERCENT: "AI probability",
  RAW_MODEL_SIGNAL_PERCENT: "model signal (not a probability)",
  CLASSIFICATION_ONLY: "classification",
};

// ---------- pure helpers ----------

/** Map every non-WinAnsi character to a single ASCII-safe replacement
 *  — length is preserved 1:1 so flagged span offsets stay exact.
 *  Smart punctuation gets a meaningful substitute; everything else
 *  becomes a space (zero-width) or "?" (symbolic). */
export function sanitizeForWinAnsi(text: string): string {
  const map: Record<string, string> = {
    "\u2192": ">", "\u2190": "<", "\u2194": "-", "\u2212": "-", "\u2013": "-", "\u2014": "-",
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u2018": "'", "\u2019": "'", "\u201A": "'",
    "\u2026": ".", "\u2022": "-", "\u00B7": "-", "\u00D7": "x", "\u00F7": "/", "\u00B1": "+",
    "\u00AB": '"', "\u00BB": '"', "\u00A9": "c", "\u00AE": "R", "\u2122": "T", "\u00B0": "o",
    "\u00A0": " ", "\u2000": " ", "\u2001": " ", "\u2002": " ", "\u2003": " ", "\u2004": " ",
    "\u2005": " ", "\u2006": " ", "\u2007": " ", "\u2008": " ", "\u2009": " ", "\u200A": " ",
    "\u200B": " ", "\u200C": " ", "\u200D": " ", "\u00AD": " ", "\uFEFF": " ",
  };
  let out = "";
  // Iterate code UNITS, not code points — a lone surrogate must map to
  // its own "?" so an emoji can't collapse two units into one char and
  // shift every span after it.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (map[ch] !== undefined) { out += map[ch]; continue; }
    const cp = ch.charCodeAt(0);
    if (cp < 0x20 && ch !== "\n" && ch !== "\t") { out += " "; continue; }
    if (cp === 0x81 || cp === 0x8d || cp === 0x8f || cp === 0x90 || cp === 0x9d) { out += " "; continue; }
    if (cp > 0xff) { out += /^\s$/.test(ch) ? " " : "?"; continue; }
    out += ch;
  }
  return out;
}

export interface WrappedLine {
  /** Text exactly as drawn on the line (no trailing space). */
  text: string;
  /** Offsets into the wrapped paragraph — first/last char of the
   *  line's content, so flagged spans intersect precisely. */
  start: number;
  end: number;
}

/** Word-wrap one paragraph while tracking character offsets. A word
 *  longer than maxWidth is broken mid-word (char-level fallback) so
 *  nothing can overflow the page margin. */
export function wrapWithOffsets(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const wordRe = /\S+/g;
  let m: RegExpExecArray | null;
  let curText = "", curStart = -1, curEnd = -1;
  const flush = () => {
    if (curStart >= 0) lines.push({ text: curText, start: curStart, end: curEnd });
    curText = ""; curStart = -1; curEnd = -1;
  };
  while ((m = wordRe.exec(text))) {
    const word = m[0], ws = m.index, we = ws + word.length;
    const cand = curStart >= 0 ? `${curText} ${word}` : word;
    if (measure(cand) <= maxWidth) {
      if (curStart < 0) curStart = ws;
      curText = cand; curEnd = we;
      continue;
    }
    flush();
    // word itself may be longer than the line — break it character-wise
    let seg = "", segStart = ws;
    for (let i = 0; i < word.length; i++) {
      if (measure(seg + word[i]) > maxWidth && seg) {
        lines.push({ text: seg, start: segStart, end: ws + i });
        seg = ""; segStart = ws + i;
      }
      seg += word[i];
    }
    if (seg) { curText = seg; curStart = segStart; curEnd = we; }
  }
  flush();
  return lines;
}

/** Map flagged {start,end} spans to per-line highlight segments.
 *  A span crossing line breaks yields one segment per covered line;
 *  spans that only touch whitespace between lines highlight nothing. */
export function highlightSegments(
  lines: WrappedLine[],
  spans: { start: number; end: number }[],
): Map<number, { start: number; end: number }[]> {
  const out = new Map<number, { start: number; end: number }[]>();
  lines.forEach((ln, i) => {
    for (const s of spans) {
      const a = Math.max(s.start, ln.start), b = Math.min(s.end, ln.end);
      if (a < b) (out.get(i) ?? out.set(i, []).get(i)!).push({ start: a, end: b });
    }
  });
  return out;
}

// ---------- input ----------

export interface DetectionReportPdfInput {
  studentName: string;
  programLine: string;    // e.g. "MS Mechanical Engineering — Stanford University"
  documentTitle: string;
  checkedVersionNumber: number;
  currentVersionNumber: number;
  checkedAt: string;      // ISO timestamp of the run
  wordCount: number;
  outdated: boolean;
  scores: DetectorScore[];
  /** Authoritative checked-version text (server-fetched). */
  content: string;
  /** Flagged passages from the run — re-derived server-side. */
  passages: FlaggedPassage[];
}

export interface ReportPdfOutput { buffer: Buffer; pageCount: number }

// ---------- generator ----------

export async function generateDetectionReportPdf(
  input: DetectionReportPdfInput,
): Promise<ReportPdfOutput> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // D-Vivid logo — graceful text fallback if the asset is missing.
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  try { logo = await pdf.embedPng(await readFile(join(process.cwd(), "public", "dvivid_logo.png"))); }
  catch { logo = null; }

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const measure = (s: string, f = font, sz = BODY_SIZE) => f.widthOfTextAtSize(s, sz);
  const maxW = PAGE_W - 2 * MARGIN;

  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const need = (h: number) => { if (y - h < MARGIN + 18) newPage(); };
  const text = (s: string, opts: { f?: any; size?: number; x?: number; color?: any; lead?: number } = {}) => {
    page.drawText(sanitizeForWinAnsi(s), {
      x: opts.x ?? MARGIN, y, size: opts.size ?? META_SIZE,
      font: opts.f ?? font, color: opts.color ?? INK,
    });
    y -= opts.lead ?? META_LEAD;
  };

  // ---- header ----
  const headerH = 26;
  if (logo) {
    const sc = headerH / logo.height;
    page.drawImage(logo, { x: MARGIN, y: y - 4, width: logo.width * sc, height: headerH });
  } else {
    text("D-VIVID CONSULTANT", { f: bold, size: 11, color: ACCENT, lead: 16 });
  }
  page.drawText("AI Detection Report", { x: MARGIN + (logo ? 110 : 0), y: y - (logo ? 4 : 0), size: 15, font: bold, color: INK });
  y -= headerH + 12;
  page.drawRectangle({ x: MARGIN, y, width: maxW, height: 0.8, color: RULE });
  y -= 10;

  // ---- metadata ----
  const meta: [string, string][] = [
    ["Student", input.studentName],
    ["Program", input.programLine],
    ["Document", input.documentTitle],
    ["Checked version", `v${input.checkedVersionNumber} · ${input.wordCount.toLocaleString()} words`],
    ["Checked at", new Date(input.checkedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })],
  ];
  for (const [k, v] of meta) {
    need(META_LEAD);
    page.drawText(`${k}:`, { x: MARGIN, y, size: META_SIZE, font: bold, color: MUTED });
    text(v, { x: MARGIN + 95 });
  }
  y -= 6;

  // ---- outdated banner ----
  if (input.outdated) {
    need(34);
    page.drawRectangle({ x: MARGIN, y: y - 22, width: maxW, height: 28, color: WARN_BG });
    page.drawText(
      `OUTDATED REPORT — checked saved version v${input.checkedVersionNumber}; current document is v${input.currentVersionNumber}.`,
      { x: MARGIN + 8, y: y - 12, size: META_SIZE, font: bold, color: WARN_INK });
    y -= 38;
  }

  // ---- summary ----
  const agg = aggregateFindings(input.content, input.passages, input.scores);
  const verdicts = input.scores.map(detectorVerdict).filter(Boolean);
  need(META_LEAD * 2);
  text(
    `${verdicts.filter(v => v === "AI").length} of ${verdicts.length} detector${verdicts.length === 1 ? "" : "s"} classify it as AI-written  ·  ${agg.flaggedSentences} of ${agg.totalSentences} unique sentences flagged`,
    { f: bold, size: 10.5, lead: 18 });

  // ---- detector table ----
  const names = new Map(listDetectorDescriptors().map(d => [d.detector, d.name]));
  need(META_LEAD);
  text("Detectors", { f: bold, size: 10, lead: 12 });
  for (const s of input.scores) {
    need(META_LEAD + 2);
    const v = detectorVerdict(s);
    const scoreTxt = s.status === "SCORED" && typeof s.scorePercent === "number"
      ? `${Math.round(s.scorePercent)}%`
      : s.status === "ERROR" ? "Error" : s.status;
    const label = s.status === "SCORED" ? (v ? VERDICT_LABEL[v] : s.classification || "Scored")
      : s.status === "ERROR" ? "Provider not responding" : "Unavailable";
    const note = [
      s.scoreMeaning ? MEANING_LABEL[s.scoreMeaning] ?? s.scoreMeaning : "",
      s.granularity === "DOCUMENT" ? "document-level score only" : "",
      s.fallback ? `produced by ${s.fallback.to}` : "",
    ].filter(Boolean).join(" · ");
    page.drawText(sanitizeForWinAnsi(names.get(s.detector) ?? s.detector), { x: MARGIN, y, size: META_SIZE, font });
    page.drawText(scoreTxt, { x: MARGIN + 130, y, size: META_SIZE, font: bold });
    page.drawText(sanitizeForWinAnsi(label), { x: MARGIN + 165, y, size: META_SIZE, font, color: v === "AI" ? rgb(0.7, 0.15, 0.15) : INK });
    if (note) page.drawText(sanitizeForWinAnsi(note), { x: MARGIN + 260, y, size: 8.5, font: ital, color: MUTED });
    y -= META_LEAD;
    page.drawRectangle({ x: MARGIN, y: y + 4, width: maxW, height: 0.4, color: RULE });
  }
  y -= 8;

  // ---- disclaimer ----
  const disclaimer =
    "AI detectors are probabilistic signals, not proof. They regularly disagree with each other " +
    "and can flag genuine human writing or miss paraphrased AI text. Use this report as a review aid — " +
    "a human should verify flagged sentences before any decision is made.";
  const dLines = wrapWithOffsets(sanitizeForWinAnsi(disclaimer), maxW - 16, s => ital.widthOfTextAtSize(s, 8.5));
  need(dLines.length * 11 + 20);
  const boxTop = y, boxH = dLines.length * 11 + 16;
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH + 8, width: maxW, height: boxH, color: rgb(0.97, 0.97, 0.98) });
  y -= 10;
  for (const ln of dLines) { page.drawText(ln.text, { x: MARGIN + 8, y, size: 8.5, font: ital, color: MUTED }); y -= 11; }
  y -= 10;

  // ---- legend ----
  need(META_LEAD + 4);
  page.drawRectangle({ x: MARGIN, y: y - 1, width: 12, height: 9, color: FLAG_BG, borderColor: rgb(0.9, 0.6, 0.6), borderWidth: 0.5 });
  text(" Highlighted text = flagged by a sentence-level detector", { x: MARGIN + 18, size: 8.5, color: MUTED });
  y -= 8;

  // ---- document body with highlights ----
  const spans = agg.findings.map(f => ({ start: f.start, end: f.end }));
  const paragraphs = input.content.split(/\n/);
  for (const para of paragraphs) {
    if (!para.trim()) { y -= BODY_LEAD / 2; continue; }
    const clean = sanitizeForWinAnsi(para);
    const lines = wrapWithOffsets(clean, maxW, s => measure(s));
    const segs = highlightSegments(lines, spans);
    lines.forEach((ln, i) => {
      need(BODY_LEAD + 2);
      for (const seg of segs.get(i) ?? []) {
        const x0 = MARGIN + measure(ln.text.slice(0, seg.start - ln.start));
        const w = measure(ln.text.slice(seg.start - ln.start, seg.end - ln.start));
        page.drawRectangle({ x: x0, y: y - 3, width: Math.max(w, 4), height: BODY_SIZE + 4, color: FLAG_BG });
      }
      page.drawText(ln.text, { x: MARGIN, y, size: BODY_SIZE, font, color: INK });
      y -= BODY_LEAD;
    });
    y -= BODY_LEAD / 3;
  }

  // ---- footers on every page ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawRectangle({ x: MARGIN, y: MARGIN - 14, width: maxW, height: 0.6, color: RULE });
    p.drawText("D-Vivid Consultant · AI Detection Report", { x: MARGIN, y: MARGIN - 26, size: 8, font, color: MUTED });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(pg, 8), y: MARGIN - 26, size: 8, font, color: MUTED });
  });

  return { buffer: Buffer.from(await pdf.save()), pageCount: pages.length };
}
