/**
 * @file page-validator.ts
 * @description
 * Physical page constraint validation.
 * Validates rendered PDF page counts against official page limits.
 *
 * NEVER converts page limits to word limits.
 */

import { RenderProfile } from "./render-profile";

export type PageValidationStatus =
  | "PASS"
  | "RENDER_OVERFLOW"
  | "RENDER_ENGINE_ERROR"
  | "RENDER_PROFILE_INCOMPLETE"
  | "NOT_APPLICABLE";

export interface ComponentPageValidation {
  componentId: string;
  label: string;
  pageCount: number;
  maxPages: number | null;
  status: PageValidationStatus;
  wordCountForAnalytics: number;
  characterCountForAnalytics: number;
}

export interface DocumentPageValidation {
  documentId: string;
  components: ComponentPageValidation[];
  combinedPageCount: number;
  combinedMaxPages: number | null;
  status: PageValidationStatus;
  renderProfile: {
    id: string;
    version: string;
    source: string;
  };
}

export interface PageConstraintComponent {
  componentId: string;
  label: string;
  text: string;
  maxPages: number | null;
}

export function validatePhysicalPageConstraints(
  components: Array<
    PageConstraintComponent & { renderedPageCount?: number }
  >,
  combinedPageCount: number,
  combinedMaxPages: number | null,
  profile: RenderProfile
): DocumentPageValidation {
  const profileIncomplete =
    !profile.pageSize || !profile.fontFamily || profile.fontSizePt <= 0;

  const componentResults: ComponentPageValidation[] = components.map(c => {
    if (c.maxPages === null) {
      return {
        componentId: c.componentId,
        label: c.label,
        pageCount: c.renderedPageCount || 0,
        maxPages: null,
        status: "NOT_APPLICABLE" as PageValidationStatus,
        wordCountForAnalytics: countWords(c.text),
        characterCountForAnalytics: c.text.length,
      };
    }

    if (profileIncomplete) {
      return {
        componentId: c.componentId,
        label: c.label,
        pageCount: c.renderedPageCount || 0,
        maxPages: c.maxPages,
        status: "RENDER_PROFILE_INCOMPLETE" as PageValidationStatus,
        wordCountForAnalytics: countWords(c.text),
        characterCountForAnalytics: c.text.length,
      };
    }

    const rendered = c.renderedPageCount || 0;
    const over = rendered > c.maxPages;

    return {
      componentId: c.componentId,
      label: c.label,
      pageCount: rendered,
      maxPages: c.maxPages,
      status: over ? "RENDER_OVERFLOW" as PageValidationStatus : "PASS" as PageValidationStatus,
      wordCountForAnalytics: countWords(c.text),
      characterCountForAnalytics: c.text.length,
    };
  });

  // Overall document status
  let overallStatus: PageValidationStatus = "PASS";

  if (profileIncomplete) overallStatus = "RENDER_PROFILE_INCOMPLETE";
  else if (componentResults.some(c => c.status === "RENDER_OVERFLOW")) overallStatus = "RENDER_OVERFLOW";
  else if (componentResults.every(c => c.status === "NOT_APPLICABLE")) overallStatus = "NOT_APPLICABLE";
  else overallStatus = "PASS";

  // Check combined limit
  if (combinedMaxPages !== null && combinedPageCount > combinedMaxPages) {
    overallStatus = "RENDER_OVERFLOW";
  }

  return {
    documentId: "",
    components: componentResults,
    combinedPageCount,
    combinedMaxPages,
    status: overallStatus,
    renderProfile: {
      id: profile.renderProfileId,
      version: profile.version,
      source: profile.source,
    },
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
