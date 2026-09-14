/**
 * @file renderer.ts
 * @description
 * Deterministic headless-Chromium renderer for application documents.
 * Produces PDFs and validates physical page counts.
 */

import { RenderProfile, DVIVID_STANDARD_APPLICATION_V1 } from "./render-profile";
import { generateComponentHtml, generateCombinedHtml } from "./html-generator";

export interface RenderResult {
  pdfBuffer: Buffer;
  pageCount: number;
  pageSizeName: string;
  widthPt: number;
  heightPt: number;
}

export interface RenderedComponent {
  componentId: string;
  label: string;
  text?: string;
  html?: string;
  pdfBuffer?: Buffer;
  pageCount?: number;
}

export interface RenderedDocument {
  documentTitle: string;
  components: Array<{ componentId: string; label: string; text: string }>;
  combinedHtml: string;
  combinedPdfBuffer?: Buffer;
  combinedPageCount?: number;
}

let puppeteerMod: any = null;
let pdfLibMod: any = null;

async function getPuppeteer(): Promise<any> {
  if (!puppeteerMod) {
    puppeteerMod = await import("puppeteer");
  }
  return puppeteerMod;
}

async function getPdfLib(): Promise<any> {
  if (!pdfLibMod) {
    pdfLibMod = await import("pdf-lib");
  }
  return pdfLibMod;
}

async function renderHtmlToPdf(html: string, profile: RenderProfile): Promise<RenderResult> {
  const puppeteer = await getPuppeteer();
  const { PDFDocument } = await getPdfLib();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfUint8 = await page.pdf({
      format: profile.pageSize === "LETTER" ? "Letter" : "A4",
      printBackground: false,
    });

    const pdfBuffer = Buffer.from(pdfUint8);
    const doc = await PDFDocument.load(pdfUint8);
    const pages = doc.getPages();

    return {
      pdfBuffer,
      pageCount: pages.length,
      pageSizeName: profile.pageSize,
      widthPt: pages[0]?.getWidth() || 0,
      heightPt: pages[0]?.getHeight() || 0,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Render a single response component.
 */
export async function renderResponseComponent(
  componentId: string,
  label: string,
  text: string,
  profile: RenderProfile = DVIVID_STANDARD_APPLICATION_V1
): Promise<RenderedComponent> {
  const html = generateComponentHtml(label, text, profile);
  const result = await renderHtmlToPdf(html, profile);

  return {
    componentId,
    label,
    html,
    pdfBuffer: result.pdfBuffer,
    pageCount: result.pageCount,
  };
}

/**
 * Render the complete application document with all components.
 */
export async function renderApplicationDocument(
  documentTitle: string,
  components: Array<{ componentId: string; label: string; text: string }>,
  profile: RenderProfile = DVIVID_STANDARD_APPLICATION_V1
): Promise<RenderedDocument> {
  const combinedHtml = generateCombinedHtml(documentTitle, components, profile);
  const result = await renderHtmlToPdf(combinedHtml, profile);

  return {
    documentTitle,
    components: components.map(c => ({ ...c })),
    combinedHtml,
    combinedPdfBuffer: result.pdfBuffer,
    combinedPageCount: result.pageCount,
  };
}
