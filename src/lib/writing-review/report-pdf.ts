// ============================================================
// AI Detection Report PDF — server-side pdf-lib generator.
// Student-facing percentage report: D-Vivid header, metadata card,
// per-detector score cards with original brand logos, and the full
// clean document text. No caution box, no sentence findings, no
// highlights — detectors are honest signals for the student to see.
// ============================================================

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import { join } from "path";
import { detectorVerdict } from "./report";
import type { DetectorScore } from "./types";

const PAGE_W = 612, PAGE_H = 792, MARGIN = 50;
const NAVY = rgb(0.09, 0.15, 0.27);
const SLATE = rgb(0.4, 0.45, 0.55);
const BORDER = rgb(0.886, 0.91, 0.941);   // #E2E8F0
const CARD_BG = rgb(0.973, 0.98, 0.988);  // #F8FAFC
const TRACK = rgb(0.898, 0.906, 0.922);   // #E5E7EB
const GREEN = rgb(0.086, 0.639, 0.29);    // #16A34A
const AMBER = rgb(0.851, 0.467, 0.024);   // #D97706
const RED = rgb(0.863, 0.149, 0.149);     // #DC2626

/** Friendly public-facing detector names — never raw ids. */
const DISPLAY_NAMES: Record<string, string> = {
  gptzero: "GPTZero", zerogpt: "ZeroGPT", reilaa: "Ryne AI",
  surfer: "Surfer", quillbot: "QuillBot", originality: "Originality.ai",
};
export function detectorDisplayName(id: string): string {
  return DISPLAY_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

const SMALL_WORDS = new Set(["of", "the", "and", "for", "in", "on", "at", "to", "a", "an"]);
export function titleCase(s: string): string {
  return s.trim().split(/\s+/).map((w, i) =>
    i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
}

// ---------- pure helpers ----------

/** Map every non-WinAnsi character to a single ASCII-safe replacement
 *  — output length equals input length so wrapped offsets stay exact.
 *  Smart punctuation gets a meaningful substitute; everything else
 *  becomes a space or "?". */
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
  // Iterate code UNITS, not code points — a lone surrogate maps to its
  // own "?" so an emoji can't collapse two units into one character.
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
  /** Offsets into the wrapped paragraph. */
  start: number;
  end: number;
}

/** Word-wrap one paragraph while tracking character offsets. A word
 *  longer than maxWidth is broken mid-word so nothing overflows. */
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

// ---------- input ----------

export interface DetectionReportPdfInput {
  studentName: string;
  programLine: string;    // e.g. "MS Computer Science — Stanford University"
  documentTitle: string;  // rendered Title-Cased in the card, uppercase in the body
  checkedVersionNumber: number;
  currentVersionNumber: number;
  checkedAt: string;      // ISO timestamp of the run
  wordCount: number;
  /** checkedVersionId !== currentVersionId → subtle "Checked vN" note. */
  outdated: boolean;
  scores: DetectorScore[];
  /** Authoritative checked-version text (server-fetched), clean. */
  content: string;
  /** Validated IANA zone for the header date; defaults to Asia/Kolkata. */
  timeZone?: string;
}

export interface ReportPdfOutput { buffer: Buffer; pageCount: number }

// ---------- generator ----------

export async function generateDetectionReportPdf(
  input: DetectionReportPdfInput,
): Promise<ReportPdfOutput> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // D-Vivid + detector brand logos — graceful text fallback when a
  // PNG is missing (e.g. stripped test environments).
  const pub = (...p: string[]) => join(process.cwd(), "public", ...p);
  const embed = async (p: string) => { try { return await pdf.embedPng(await readFile(p)); } catch { return null; } };
  const dvLogo = await embed(pub("dvivid_logo.png"));
  const logos = new Map<string, NonNullable<Awaited<ReturnType<typeof embed>>>>();
  for (const s of input.scores) {
    if (!logos.has(s.detector)) logos.set(s.detector, await embed(pub("detector-logos", `${s.detector}.png`)) as any);
  }

  const tz = input.timeZone ?? "Asia/Kolkata";
  let dateStr = "";
  try {
    dateStr = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz })
      .format(new Date(input.checkedAt));
  } catch { dateStr = new Date(input.checkedAt).toISOString().slice(0, 10); }

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxW = PAGE_W - 2 * MARGIN;
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const need = (h: number) => { if (y - h < MARGIN + 20) newPage(); };
  const right = (s: string, x: number, yy: number, f = font, size = 9.5, color = SLATE) =>
    page.drawText(sanitizeForWinAnsi(s), { x: x - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });
  const hrule = (yy: number, w = 0.8, color = BORDER) =>
    page.drawRectangle({ x: MARGIN, y: yy, width: maxW, height: w, color });
  // Rounded rect from rects + corner circles (pdf-lib drawSvgPath does
  // not support arc commands — this is the reliable primitive path).
  const roundedFill = (x: number, yy: number, w: number, h: number, r: number, color: any) => {
    page.drawRectangle({ x: x + r, y: yy, width: w - 2 * r, height: h, color });
    page.drawRectangle({ x, y: yy + r, width: w, height: h - 2 * r, color });
    for (const [cx, cy] of [[x + r, yy + r], [x + w - r, yy + r], [x + r, yy + h - r], [x + w - r, yy + h - r]])
      page.drawCircle({ x: cx, y: cy, size: r, color });
  };
  const roundedBox = (x: number, yy: number, w: number, h: number, r: number, fill: any, border: any, bw: number) => {
    roundedFill(x, yy, w, h, r, border);
    roundedFill(x + bw, yy + bw, w - 2 * bw, h - 2 * bw, Math.max(0.5, r - bw), fill);
  };

  // ---- header: logo + title left, date/words right ----
  const logoH = 22;
  if (dvLogo) {
    const sc = logoH / dvLogo.height;
    page.drawImage(dvLogo, { x: MARGIN, y: y - 18, width: dvLogo.width * sc, height: logoH });
  } else {
    page.drawText("D-VIVID", { x: MARGIN, y: y - 8, size: 13, font: bold, color: NAVY });
  }
  const titleX = MARGIN + (dvLogo ? (dvLogo.width * (logoH / dvLogo.height)) + 12 : 58);
  page.drawText("AI Detection Report", { x: titleX, y: y - 8, size: 15, font: bold, color: NAVY });
  right(dateStr, PAGE_W - MARGIN, y);
  const meta2 = `${input.wordCount.toLocaleString()} words \u00B7 v${input.checkedVersionNumber}`;
  right(meta2, PAGE_W - MARGIN, y - 14);
  if (input.outdated) {
    const pill = `Checked v${input.checkedVersionNumber} \u00B7 current v${input.currentVersionNumber}`;
    const pw = font.widthOfTextAtSize(pill, 8) + 12;
    roundedBox(PAGE_W - MARGIN - pw, y - 32, pw, 14, 7, CARD_BG, BORDER, 0.6);
    page.drawText(pill, { x: PAGE_W - MARGIN - pw + 6, y: y - 28, size: 8, font, color: SLATE });
  }
  y -= 34;
  hrule(y); y -= 14;

  // ---- metadata card ----
  const label = (s: string, x: number, yy: number) =>
    page.drawText(s.toUpperCase(), { x, y: yy, size: 7.5, font, color: SLATE });
  const value = (s: string, x: number, yy: number) =>
    page.drawText(sanitizeForWinAnsi(s), { x, y: yy, size: 10.5, font: bold, color: NAVY });
  const progLines = wrapWithOffsets(sanitizeForWinAnsi(input.programLine), maxW - 32, s => bold.widthOfTextAtSize(s, 10.5));
  const cardH = 46 + (progLines.length - 1) * 12 + (progLines.length ? 26 : 0);
  need(cardH + 8);
  roundedBox(MARGIN, y - cardH, maxW, cardH, 6, CARD_BG, BORDER, 0.75);
  const colR = MARGIN + maxW / 2 + 8;
  label("Student", MARGIN + 14, y - 18);
  label("Document", colR, y - 18);
  value(input.studentName, MARGIN + 14, y - 33);
  value(titleCase(input.documentTitle), colR, y - 33);
  label("Program", MARGIN + 14, y - 52);
  progLines.forEach((ln, i) => value(ln.text, MARGIN + 14, y - 67 - i * 12));
  y -= cardH + 16;

  // ---- score cards row(s) ----
  const GUTTER = 12, CARD_H = 88;
  const perRow = Math.min(3, Math.max(1, input.scores.length));
  const cardW = (maxW - GUTTER * (perRow - 1)) / perRow;
  for (let row = 0; row * perRow < input.scores.length; row++) {
    need(CARD_H + 10);
    input.scores.slice(row * perRow, row * perRow + perRow).forEach((s, i) => {
      const x = MARGIN + i * (cardW + GUTTER), top = y;
      roundedBox(x, top - CARD_H, cardW, CARD_H, 6, rgb(1, 1, 1), BORDER, 0.75);
      const logo = logos.get(s.detector);
      const name = detectorDisplayName(s.detector);
      let nameX = x + 10;
      if (logo) {
        const lh = 15, lsc = lh / logo.height;
        page.drawImage(logo, { x: x + 10, y: top - 22, width: logo.width * lsc, height: lh });
        nameX += logo.width * lsc + 6;
      }
      page.drawText(name, { x: nameX, y: top - 18, size: 10, font: bold, color: NAVY });
      const verdict = detectorVerdict(s);
      const vColor = verdict === "AI" ? RED : verdict === "MIXED" ? AMBER : GREEN;
      const vLabel = s.status !== "SCORED" ? "Unavailable"
        : verdict === "AI" ? "AI-written" : verdict === "MIXED" ? "Mixed" : verdict === "HUMAN" ? "Human-like" : "Scored";
      if (s.status === "SCORED" && typeof s.scorePercent === "number") {
        page.drawText(`${Math.round(s.scorePercent)}%`, { x: x + 10, y: top - 52, size: 24, font: bold, color: NAVY });
      } else {
        page.drawText("Unavailable", { x: x + 10, y: top - 48, size: 15, font: bold, color: SLATE });
      }
      const barY = top - 64, barW = cardW - 20;
      roundedFill(x + 10, barY, barW, 5, 2.5, TRACK);
      if (s.status === "SCORED" && typeof s.scorePercent === "number" && s.scorePercent > 0) {
        const fw = Math.max(5, (Math.min(100, s.scorePercent) / 100) * barW);
        roundedFill(x + 10, barY, fw, 5, 2.5, vColor);
      }
      page.drawText(vLabel, { x: x + 10, y: top - 79, size: 9, font: bold, color: s.status === "SCORED" ? vColor : SLATE });
      right("AI score", x + cardW - 10, top - 79, font, 8, SLATE);
    });
    y -= CARD_H + 14;
  }

  // ---- document body (clean, unhighlighted) ----
  hrule(y); y -= 16;
  need(30);
  page.drawText(sanitizeForWinAnsi(input.documentTitle.toUpperCase()), { x: MARGIN, y, size: 12, font: bold, color: NAVY });
  y -= 20;
  const measure = (s: string) => font.widthOfTextAtSize(s, 10.5);
  for (const para of input.content.split(/\n/)) {
    if (!para.trim()) { y -= 8; continue; }
    const lines = wrapWithOffsets(sanitizeForWinAnsi(para), maxW, measure);
    for (const ln of lines) {
      need(16);
      page.drawText(ln.text, { x: MARGIN, y, size: 10.5, font, color: NAVY });
      y -= 15;
    }
    y -= 6;
  }

  // ---- footers on every page ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawRectangle({ x: MARGIN, y: MARGIN - 14, width: maxW, height: 0.6, color: BORDER });
    p.drawText("D-Vivid Consultant \u00B7 AI Detection Report", { x: MARGIN, y: MARGIN - 26, size: 8, font, color: SLATE });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(pg, 8), y: MARGIN - 26, size: 8, font, color: SLATE });
  });

  return { buffer: Buffer.from(await pdf.save()), pageCount: pages.length };
}
