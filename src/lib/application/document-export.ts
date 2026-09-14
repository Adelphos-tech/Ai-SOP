/**
 * @file document-export.ts
 * @description
 * Phase SOP-AI-34A: Server-side document export to PDF and DOCX.
 *
 * Exports ONLY the final document content (no internal AI metadata).
 * PDF uses pdf-lib with proper text wrapping and multi-page support.
 * DOCX uses the docx library with professional simple formatting.
 */

import { PDFDocument, StandardFonts, PDFFont, TextPosition } from "pdf-lib";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
} from "docx";

// ============================================================
// TYPES
// ============================================================

export type ExportFormat = "PDF" | "DOCX";
export type ExportMode = "PREVIEW" | "FINAL";

export interface ExportInput {
  content: string;
  format: ExportFormat;
  mode: ExportMode;
  studentName: string;
  universityName: string;
  documentType: string;
  versionNumber: number;
  isApproved: boolean;
}

export interface ExportResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  pageCount: number;
}

// ============================================================
// FILENAME SANITIZATION
// ============================================================

function sanitizeFilename(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function buildFilename(input: ExportInput): string {
  const name = sanitizeFilename(input.studentName);
  const univ = sanitizeFilename(input.universityName);
  const docType = sanitizeFilename(input.documentType);
  const ext = input.format.toLowerCase();

  if (input.mode === "FINAL") {
    return `${name}_${univ}_${docType}.${ext}`;
  }
  return `${name}_${univ}_${docType}_DRAFT_V${input.versionNumber}.${ext}`;
}

// ============================================================
// PDF GENERATION
// ============================================================

const PAGE_WIDTH = 612; // 8.5in * 72pt
const PAGE_HEIGHT = 792; // 11in * 72pt
const MARGIN = 72; // 1 inch
const FONT_SIZE = 12;
const LINE_HEIGHT = 18; // 1.5x font size
const MAX_CHARS_PER_LINE = 90; // approximate for 12pt Helvetica

/**
 * Generate a PDF from plain text content.
 * Handles multi-page wrapping with proper text flow.
 * Returns the PDF buffer and page count.
 */
async function generatePdf(content: string): Promise<{ buffer: Buffer; pageCount: number }> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  let pageCount = 1;

  // Split content into paragraphs
  const paragraphs = content.split(/\n/);

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      // Empty line = spacing
      y -= LINE_HEIGHT / 2;
      if (y < MARGIN) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        pageCount++;
      }
      continue;
    }

    // Word-wrap the paragraph
    const words = paragraph.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const textWidth = font.widthOfTextAtSize(testLine, FONT_SIZE);

      if (textWidth > PAGE_WIDTH - 2 * MARGIN) {
        // Draw current line
        if (currentLine) {
          page.drawText(currentLine, {
            x: MARGIN,
            y,
            size: FONT_SIZE,
            font,
          });
          y -= LINE_HEIGHT;
          if (y < MARGIN) {
            page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            y = PAGE_HEIGHT - MARGIN;
            pageCount++;
          }
        }
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    // Draw remaining line
    if (currentLine) {
      page.drawText(currentLine, {
        x: MARGIN,
        y,
        size: FONT_SIZE,
        font,
      });
      y -= LINE_HEIGHT;
      if (y < MARGIN) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        pageCount++;
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return { buffer: Buffer.from(pdfBytes), pageCount };
}

// ============================================================
// DOCX GENERATION
// ============================================================

/**
 * Generate a DOCX from plain text content.
 * Professional simple formatting: 12pt body, paragraph spacing.
 */
async function generateDocx(content: string): Promise<Buffer> {
  const paragraphs = content.split(/\n/);

  const docChildren: Paragraph[] = paragraphs.map(
    (text) =>
      new Paragraph({
        children: text.trim()
          ? [new TextRun({ text, size: 24, font: "Calibri" })]
          : [new TextRun({ text: "", size: 24 })],
        spacing: { after: 200, line: 360 }, // 1.5x line spacing, 10pt after
        alignment: AlignmentType.JUSTIFIED,
      }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch in twips
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

// ============================================================
// MAIN EXPORT FUNCTION
// ============================================================

/**
 * Export document content to PDF or DOCX.
 * Exports ONLY the document content — no AI metadata.
 */
export async function exportDocument(input: ExportInput): Promise<ExportResult> {
  const filename = buildFilename(input);

  if (input.format === "PDF") {
    const { buffer, pageCount } = await generatePdf(input.content);
    return {
      buffer,
      mimeType: "application/pdf",
      filename,
      pageCount,
    };
  }

  const buffer = await generateDocx(input.content);
  return {
    buffer,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename,
    pageCount: 0, // DOCX page count is determined by the viewer
  };
}

/**
 * Count PDF pages for a given content string.
 * Used for physical page limit validation.
 */
export async function countPdfPages(content: string): Promise<number> {
  const { pageCount } = await generatePdf(content);
  return pageCount;
}
