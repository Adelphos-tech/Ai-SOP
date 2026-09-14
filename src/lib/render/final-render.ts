/**
 * @file final-render.ts
 * @description
 * Deterministic final render check.
 *
 * Executed after Final Fact Reviewer (stage 6).
 * Renders the final finalized responses to PDF and produces
 * the final render status for submission readiness.
 *
 * NO OpenAI calls.
 * NO prose modification.
 * NO render profile changes.
 * Uses the SAME profile as the pre-final render (immutable during attempt).
 */

import { RenderProfile, DVIVID_STANDARD_APPLICATION_V1 } from "./render-profile";
import { generateComponentHtml, generateCombinedHtml } from "./html-generator";
import {
  RenderFeedback,
  RenderFeedbackComponent,
  RenderStatus,
  RenderLifecycleResult,
  RenderLifecycleComponent,
  RenderDeltaAnalytics,
} from "./render-lifecycle-types";
import { ResponseComponent } from "@/lib/requirements/generation-contract-types";

async function renderHtmlToPdfPages(html: string, profile: RenderProfile): Promise<number> {
  const puppeteer = await import("puppeteer");
  const pdfLib = await import("pdf-lib");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdfBytes = await page.pdf({
      format: profile.pageSize === "LETTER" ? "Letter" : "A4",
      printBackground: false,
    });
    const doc = await pdfLib.PDFDocument.load(pdfBytes);
    return doc.getPageCount();
  } finally {
    await browser.close();
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Run the final deterministic render check.
 *
 * @param finalResponses - Array of { componentId, label, text } from the Finalizer
 * @param responseComponents - The contract's response components (for page limits)
 * @param profile - The SAME render profile used for pre-final (immutable)
 * @param preFinalFeedback - The pre-final render feedback (for delta analytics)
 * @returns RenderFeedback + RenderLifecycleResult
 */
export async function runFinalRender(
  finalResponses: Array<{ componentId: string; label: string; text: string }>,
  responseComponents: ResponseComponent[],
  profile: RenderProfile = DVIVID_STANDARD_APPLICATION_V1,
  preFinalFeedback: RenderFeedback | null = null
): Promise<{ feedback: RenderFeedback; lifecycle: RenderLifecycleResult }> {
  const componentFeedback: RenderFeedbackComponent[] = [];

  for (const resp of finalResponses) {
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

      componentFeedback.push({
        componentId: resp.componentId,
        label: resp.label,
        actualPages,
        maxPages,
        status,
        wordCount: countWords(resp.text),
        characterCount: resp.text.length,
        renderProfileId: profile.renderProfileId,
      });
    } catch {
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
        finalResponses.map(r => ({ componentId: r.componentId, label: r.label, text: r.text })),
        profile
      );
      combinedActualPages = await renderHtmlToPdfPages(combinedHtml, profile);
      combinedStatus = combinedMaxPages !== null && combinedActualPages > combinedMaxPages
        ? "RENDER_OVERFLOW" : "PASS";
    } catch {
      combinedStatus = "RENDER_ENGINE_ERROR";
    }
  }

  const feedback: RenderFeedback = {
    components: componentFeedback,
    combinedActualPages,
    combinedMaxPages,
    combinedStatus,
    renderProfileId: profile.renderProfileId,
    renderProfileVersion: profile.version,
  };

  // Build lifecycle comparison and delta analytics
  const componentComparison: RenderLifecycleComponent[] = [];
  const deltaAnalytics: RenderDeltaAnalytics[] = [];
  let anyCompressionAttempted = false;

  for (const finalComp of componentFeedback) {
    const preComp = preFinalFeedback?.components.find(c => c.componentId === finalComp.componentId);

    const preFinalPages = preComp?.actualPages ?? 0;
    const preFinalWords = preComp?.wordCount ?? 0;
    const preFinalCharacters = preComp?.characterCount ?? 0;
    const preFinalStatus = preComp?.status ?? ("NOT_APPLICABLE" as RenderStatus);

    const pageReduction = preFinalPages - finalComp.actualPages;
    const wordReduction = preFinalWords > 0
      ? Math.round(((preFinalWords - finalComp.wordCount) / preFinalWords) * 10000) / 100
      : 0;
    const charReduction = preFinalCharacters > 0
      ? Math.round(((preFinalCharacters - finalComp.characterCount) / preFinalCharacters) * 10000) / 100
      : 0;

    if (wordReduction > 0 || charReduction > 0 || pageReduction > 0) {
      anyCompressionAttempted = true;
    }

    componentComparison.push({
      componentId: finalComp.componentId,
      label: finalComp.label,
      preFinalPages,
      finalPages: finalComp.actualPages,
      maxPages: finalComp.maxPages,
      preFinalStatus,
      finalStatus: finalComp.status,
      preFinalWords,
      finalWords: finalComp.wordCount,
      preFinalCharacters,
      finalCharacters: finalComp.characterCount,
    });

    deltaAnalytics.push({
      componentId: finalComp.componentId,
      wordReductionPercent: wordReduction,
      characterReductionPercent: charReduction,
      pageReduction,
    });
  }

  const hasOverflowPreFinal = preFinalFeedback
    ? preFinalFeedback.components.some(c => c.status === "RENDER_OVERFLOW") ||
      preFinalFeedback.combinedStatus === "RENDER_OVERFLOW"
    : false;
  const hasOverflowFinal = componentFeedback.some(c => c.status === "RENDER_OVERFLOW") ||
    combinedStatus === "RENDER_OVERFLOW";

  const lifecycle: RenderLifecycleResult = {
    profileId: profile.renderProfileId,
    profileVersion: profile.version,
    profileImmutable: true,
    preFinal: preFinalFeedback ? {
      components: preFinalFeedback.components,
      combinedActualPages: preFinalFeedback.combinedActualPages,
      combinedMaxPages: preFinalFeedback.combinedMaxPages,
      combinedStatus: preFinalFeedback.combinedStatus,
    } : { components: [], combinedActualPages: 0, combinedMaxPages: null, combinedStatus: "NOT_APPLICABLE" },
    final: {
      components: componentFeedback,
      combinedActualPages,
      combinedMaxPages,
      combinedStatus,
    },
    componentComparison,
    deltaAnalytics,
    hasOverflowPreFinal,
    hasOverflowFinal,
    anyCompressionAttempted,
  };

  return { feedback, lifecycle };
}
