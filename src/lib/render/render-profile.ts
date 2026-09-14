/**
 * @file render-profile.ts
 * @description
 * D-Vivid Standard Application Render Profile V1.
 *
 * This is a SYSTEM RENDER DEFAULT — it is NOT a university requirement.
 * It is used only when the university specifies page count but does NOT
 * specify physical typography/layout.
 *
 * If an official requirement specifies page size, font, margins, or spacing,
 * those override this profile. Precedence:
 *   Official formatting requirement > explicit student/consultant choice > this profile
 */

export type PageSizeName = "LETTER" | "A4";

export interface Margins {
  topIn: number;
  rightIn: number;
  bottomIn: number;
  leftIn: number;
}

export interface HeadingStyle {
  fontSizePt: number;
  fontWeight: "bold" | "normal";
  spacingBeforePt: number;
  spacingAfterPt: number;
}

export interface RenderProfile {
  renderProfileId: string;
  version: string;
  source: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT" | "USER_CHOICE";
  pageSize: PageSizeName;
  pageSizeSource: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT";
  margins: Margins;
  marginsSource: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT";
  fontFamily: string;
  fontFamilySource: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT";
  fontSizePt: number;
  fontSizeSource: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT";
  lineSpacing: number;
  lineSpacingSource: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT";
  paragraphSpacingPt: number;
  paragraphSpacingSource: "SYSTEM_RENDER_DEFAULT" | "OFFICIAL_REQUIREMENT";
  headingStyle: HeadingStyle;
}

/**
 * D-Vivid Standard Application V1 — the default render profile.
 *
 * Chosen values (all SYSTEM_RENDER_DEFAULT):
 *   pageSize: A4
 *   margins: 1 inch all sides
 *   fontFamily: Times New Roman (with metric-compatible Linux fallbacks: Nimbus Roman No9 L, Liberation Serif)
 *   fontSize: 12 pt
 *   lineSpacing: 1.6
 *   paragraphSpacing: 12 pt
 *   headings: 14 pt bold
 */
export const DVIVID_STANDARD_APPLICATION_V1: RenderProfile = {
  renderProfileId: "DVIVID_STANDARD_APPLICATION_V1",
  version: "1.0.0",
  source: "SYSTEM_RENDER_DEFAULT",
  pageSize: "A4",
  pageSizeSource: "SYSTEM_RENDER_DEFAULT",
  margins: { topIn: 1, rightIn: 1, bottomIn: 1, leftIn: 1 },
  marginsSource: "SYSTEM_RENDER_DEFAULT",
  fontFamily: "'Times New Roman', 'Nimbus Roman No9 L', 'Liberation Serif', serif",
  fontFamilySource: "SYSTEM_RENDER_DEFAULT",
  fontSizePt: 12,
  fontSizeSource: "SYSTEM_RENDER_DEFAULT",
  lineSpacing: 1.6,
  lineSpacingSource: "SYSTEM_RENDER_DEFAULT",
  paragraphSpacingPt: 12,
  paragraphSpacingSource: "SYSTEM_RENDER_DEFAULT",
  headingStyle: {
    fontSizePt: 14,
    fontWeight: "bold",
    spacingBeforePt: 12,
    spacingAfterPt: 6,
  },
};

/**
 * Merge official formatting requirements over the base profile.
 */
export function applyOfficialOverrides(
  base: RenderProfile,
  official: Partial<Pick<RenderProfile, "pageSize" | "margins" | "fontFamily" | "fontSizePt" | "lineSpacing" | "paragraphSpacingPt">>
): RenderProfile {
  const merged = { ...base };

  if (official.pageSize) {
    merged.pageSize = official.pageSize;
    merged.pageSizeSource = "OFFICIAL_REQUIREMENT";
    merged.source = "OFFICIAL_REQUIREMENT";
  }
  if (official.margins) {
    merged.margins = official.margins;
    merged.marginsSource = "OFFICIAL_REQUIREMENT";
    merged.source = "OFFICIAL_REQUIREMENT";
  }
  if (official.fontFamily) {
    merged.fontFamily = official.fontFamily;
    merged.fontFamilySource = "OFFICIAL_REQUIREMENT";
    merged.source = "OFFICIAL_REQUIREMENT";
  }
  if (official.fontSizePt) {
    merged.fontSizePt = official.fontSizePt;
    merged.fontSizeSource = "OFFICIAL_REQUIREMENT";
    merged.source = "OFFICIAL_REQUIREMENT";
  }
  if (official.lineSpacing) {
    merged.lineSpacing = official.lineSpacing;
    merged.lineSpacingSource = "OFFICIAL_REQUIREMENT";
    merged.source = "OFFICIAL_REQUIREMENT";
  }
  if (official.paragraphSpacingPt) {
    merged.paragraphSpacingPt = official.paragraphSpacingPt;
    merged.paragraphSpacingSource = "OFFICIAL_REQUIREMENT";
    merged.source = "OFFICIAL_REQUIREMENT";
  }

  return merged;
}
