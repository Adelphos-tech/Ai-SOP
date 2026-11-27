// ============================================================
// Minimal plain-text PDF export for the standalone module —
// title + wrapped body text, WinAnsi-sanitized, no document row
// or version data required.
// ============================================================

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sanitizeForWinAnsi, wrapWithOffsets } from "./report-pdf";

const PAGE_W = 612, PAGE_H = 792, MARGIN = 56;
const BODY_SIZE = 10.5, LINE_H = 14.5;

export async function generateTextPdf(title: string, content: string): Promise<{ buffer: Buffer; pageCount: number }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.15, 0.23);
  const maxW = PAGE_W - 2 * MARGIN;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const wrap = (s: string, size: number, f = font) => wrapWithOffsets(s, maxW, t => f.widthOfTextAtSize(t, size));

  page.drawText(sanitizeForWinAnsi(title || "Document"), { x: MARGIN, y, size: 15, font: bold, color: ink });
  y -= 26;
  page.drawRectangle({ x: MARGIN, y, width: maxW, height: 0.8, color: rgb(0.85, 0.88, 0.93) });
  y -= 20;

  for (const para of content.split(/\n{2,}/)) {
    const lines = wrap(para.replace(/\n/g, " "), BODY_SIZE);
    for (const l of lines) {
      if (y < MARGIN + LINE_H) newPage();
      page.drawText(sanitizeForWinAnsi(l.text), { x: MARGIN, y, size: BODY_SIZE, font, color: ink });
      y -= LINE_H;
    }
    y -= 8;
  }

  const buffer = Buffer.from(await pdf.save());
  return { buffer, pageCount: pdf.getPageCount() };
}
