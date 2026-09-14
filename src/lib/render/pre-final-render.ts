/**
 * @file pre-final-render.ts
 * @description
 * Deterministic pre-final render check.
 *
 * Executed between Language Calibrator (stage 4) and Finalizer (stage 5).
 * Renders calibrated responses to PDF and produces render feedback
 * that the Finalizer can use to compress overflowing components.
 *
 * NO OpenAI calls.
 * NO prose modification.
 * NO render profile changes.
 */

import { RenderProfile, DVIVID_STANDARD_APPLICATION_V1 } from "./render-profile";
import { generateComponentHtml, generateCombinedHtml } from "./html-generator";
import { validatePhysicalPageConstraints } from "./page-validator";
import {
  RenderFeedback,
  RenderFeedbackComponent,
  RenderStatus,
} from "./render-lifecycle-types";
import { ResponseComponent } from "@/lib/requirements/generation-contract-types";
import { renderLimiter } from "@/lib/concurrency/resource-limiter";

async function renderHtmlToPdfPages(html: string, profile: RenderProfile): Promise<number> {
  const release = await renderLimiter.acquire();
  const puppeteer = await import("puppeteer");
  const pdfLib = await import("pdf-lib");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
    const pdfBytes = await page.pdf({
      format: profile.pageSize === "LETTER" ? "Letter" : "A4",
      printBackground: false,
    });
    const doc = await pdfLib.PDFDocument.load(pdfBytes);
    return doc.getPageCount();
  } finally {
    await browser.close();
    release();
  }
}

/**
 * Phase 14: Measure actual content height in pixels using Puppeteer.
 * Returns the content height and the available height for maxPages.
 */
async function measureRenderPressure(
  html: string,
  profile: RenderProfile,
  maxPages: number
): Promise<{ contentHeightPx: number; availableHeightPx: number; overflowHeightPx: number; overflowRatio: number }> {
  const release = await renderLimiter.acquire();
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Set the page size to match the render profile
    const format = profile.pageSize === "LETTER" ? "Letter" : "A4";
    await page.pdf({ format, printBackground: false }); // warm up

    // Measure the actual content height
    const contentHeightPx = await page.evaluate(() => {
      return document.documentElement.scrollHeight || document.body.scrollHeight;
    });

    // Measure available height: one page height * maxPages
    // A standard Letter page is ~1056px at 96 DPI; A4 is ~1123px
    const pageHeightPx = format === "Letter" ? 1056 : 1123;
    // Account for margins (typically 1 inch = 96px top + bottom)
    const marginPx = 96 * 2; // top + bottom margins
    const availablePerPagePx = pageHeightPx - marginPx;
    const availableHeightPx = availablePerPagePx * maxPages;

    const overflowHeightPx = Math.max(0, contentHeightPx - availableHeightPx);
    const overflowRatio = availableHeightPx > 0 ? contentHeightPx / availableHeightPx : 1;

    return { contentHeightPx, availableHeightPx, overflowHeightPx, overflowRatio };
  } catch {
    return { contentHeightPx: 0, availableHeightPx: 0, overflowHeightPx: 0, overflowRatio: 1 };
  } finally {
    await browser.close();
    release();
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Run the pre-final deterministic render check.
 *
 * @param calibratedResponses - Array of { componentId, label, text } from the Language Calibrator
 * @param responseComponents - The contract's response components (for page limits)
 * @param profile - The render profile (immutable during attempt)
 * @returns RenderFeedback for the Finalizer
 */
export async function runPreFinalRender(
  calibratedResponses: Array<{ componentId: string; label: string; text: string }>,
  responseComponents: ResponseComponent[],
  profile: RenderProfile = DVIVID_STANDARD_APPLICATION_V1
): Promise<RenderFeedback> {
  const componentFeedback: RenderFeedbackComponent[] = [];

  for (const resp of calibratedResponses) {
    const rc = responseComponents.find(r => r.componentId === resp.componentId);
    const maxPages = rc?.pageLimit?.maxPages ?? null;

    if (maxPages === null) {
      componentFeedback.push({
        componentId: resp.componentId,
        label: resp.label,
        actualPages: 0,
        maxPages: null,
        status: "NOT_APPLICABLE" as RenderStatus,
        wordCount: countWords(resp.text),
        characterCount: resp.text.length,
        renderProfileId: profile.renderProfileId,
      });
      continue;
    }

    try {
      const html = generateComponentHtml(resp.label, resp.text, profile);
      const actualPages = await renderHtmlToPdfPages(html, profile);
      const status: RenderStatus = actualPages > maxPages ? "RENDER_OVERFLOW" : "PASS";

      // Phase 14: Measure render pressure
      let pressure: { contentHeightPx?: number; availableHeightPx?: number; overflowHeightPx?: number; overflowRatio?: number } = {};
      if (status === "RENDER_OVERFLOW") {
        try {
          pressure = await measureRenderPressure(html, profile, maxPages);
        } catch {}
      }

      componentFeedback.push({
        componentId: resp.componentId,
        label: resp.label,
        actualPages,
        maxPages,
        status,
        wordCount: countWords(resp.text),
        characterCount: resp.text.length,
        renderProfileId: profile.renderProfileId,
        contentHeightPx: pressure.contentHeightPx,
        availableHeightPx: pressure.availableHeightPx,
        overflowHeightPx: pressure.overflowHeightPx,
        overflowRatio: pressure.overflowRatio,
      });
    } catch (error) {
      componentFeedback.push({
        componentId: resp.componentId,
        label: resp.label,
        actualPages: 0,
        maxPages,
        status: "RENDER_ENGINE_ERROR" as RenderStatus,
        wordCount: countWords(resp.text),
        characterCount: resp.text.length,
        renderProfileId: profile.renderProfileId,
      });
    }
  }

  // Combined render
  let combinedActualPages = 0;
  let combinedMaxPages: number | null = null;
  let combinedStatus: RenderStatus = "NOT_APPLICABLE";

  const hasPageConstraint = responseComponents.some(rc => rc.pageLimit?.maxPages != null);
  if (hasPageConstraint) {
    const docMaxPages = responseComponents.reduce((sum, rc) => sum + (rc.pageLimit?.maxPages || 0), 0);
    combinedMaxPages = docMaxPages > 0 ? docMaxPages : null;

    try {
      const combinedHtml = generateCombinedHtml(
        "APPLICATION DOCUMENT",
        calibratedResponses.map(r => ({ componentId: r.componentId, label: r.label, text: r.text })),
        profile
      );
      combinedActualPages = await renderHtmlToPdfPages(combinedHtml, profile);
      combinedStatus = combinedMaxPages !== null && combinedActualPages > combinedMaxPages
        ? "RENDER_OVERFLOW" : "PASS";
    } catch {
      combinedStatus = "RENDER_ENGINE_ERROR";
    }
  }

  return {
    components: componentFeedback,
    combinedActualPages,
    combinedMaxPages,
    combinedStatus,
    renderProfileId: profile.renderProfileId,
    renderProfileVersion: profile.version,
  };
}
