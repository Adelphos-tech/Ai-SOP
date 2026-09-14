/**
 * @file html-generator.ts
 * @description
 * Generate safe, escaped HTML for application documents.
 */

import { RenderProfile } from "./render-profile";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function profileToCss(profile: RenderProfile): string {
  const size = profile.pageSize === "LETTER" ? "Letter" : "A4";
  return `
    @page {
      size: ${size};
      margin-top: ${profile.margins.topIn}in;
      margin-right: ${profile.margins.rightIn}in;
      margin-bottom: ${profile.margins.bottomIn}in;
      margin-left: ${profile.margins.leftIn}in;
    }
    body {
      font-family: ${profile.fontFamily};
      font-size: ${profile.fontSizePt}pt;
      line-height: ${profile.lineSpacing};
      margin: 0;
      padding: 0;
    }
    .document-title {
      font-size: ${profile.headingStyle.fontSizePt}pt;
      font-weight: ${profile.headingStyle.fontWeight};
      margin-top: 0;
      margin-bottom: ${profile.headingStyle.spacingAfterPt}pt;
    }
    .component-label {
      font-size: ${profile.headingStyle.fontSizePt}pt;
      font-weight: ${profile.headingStyle.fontWeight};
      margin-top: ${profile.headingStyle.spacingBeforePt}pt;
      margin-bottom: ${profile.headingStyle.spacingAfterPt}pt;
    }
    p {
      margin: 0 0 ${profile.paragraphSpacingPt}pt 0;
      text-align: left;
      orphans: 3;
      widows: 3;
    }
  `;
}

export function generateComponentHtml(
  componentLabel: string,
  text: string,
  profile: RenderProfile
): string {
  const css = profileToCss(profile);
  const paragraphs = text.split("\n\n").filter(p => p.trim().length > 0);
  const body = paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join("\n");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${css}</style></head>
<body>
${body}
</body>
</html>`;
}

export function generateCombinedHtml(
  documentTitle: string,
  components: Array<{ componentId: string; label: string; text: string }>,
  profile: RenderProfile
): string {
  const css = profileToCss(profile);
  const sections = components.map(c => {
    const paragraphs = c.text.split("\n\n").filter(p => p.trim().length > 0);
    const body = paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join("\n");
    return `
<div class="component-section" style="break-before: ${c.componentId === components[0].componentId ? "auto" : "page"}">
  ${body}
</div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${css}</style></head>
<body>
${sections}
</body>
</html>`;
}
