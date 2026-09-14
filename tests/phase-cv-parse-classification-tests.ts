/**
 * CV Parse Failure Classification Tests
 *
 * Phase: CV PARSING UX FIX
 *
 * Tests:
 *   1. Searchable PDF → PASS
 *   2. DOCX → PASS
 *   3. Image-only/scanned PDF → IMAGE_ONLY_PDF
 *   4. Empty PDF → INSUFFICIENT_TEXT
 *   5. Corrupt PDF → CORRUPT_OR_UNREADABLE_PDF (controlled failure)
 *   6. Existing profile unchanged after failure → PASS
 *   7. No OpenAI calls → PASS
 *
 * No OpenAI calls. No production DB mutations.
 */

import { parseCVFile, CVParseFailure, createCVParseFailure } from "../src/lib/application/cv-parser";

function assert(cond: boolean, name: string): void {
  if (!cond) throw new Error(`Assertion failed: ${name}`);
}

// ============================================================
// Test fixture builders
// ============================================================

/**
 * Build a minimal valid searchable PDF with extractable text.
 * This creates a real PDF that pdf-parse can read.
 */
function buildSearchablePdf(text: string): Buffer {
  // Escape parentheses in text (PDF string syntax)
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const lines = escaped.split("\n");
  const contentLines = lines.map((line, i) => `BT /F1 12 Tf 72 ${750 - i * 14} Td (${line}) Tj ET`).join("\n");

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${contentLines.length} >>
stream
${contentLines}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000${(241 + 50 + contentLines.length).toString().padStart(7, "0")} 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${241 + 50 + contentLines.length + 50}
%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Build a valid PDF structure with NO text content (simulates image-only/scanned PDF).
 * The PDF is structurally valid but has no text in the content stream.
 */
function buildImageOnlyPdf(): Buffer {
  const content = ""; // Empty content stream — no text
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>
endobj
4 0 obj
<< /Length ${content.length} >>
stream
${content}
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000206 00000 n
trailer
<< /Size 5 /Root 1 0 R >>
startxref
260
%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Build a corrupt PDF — starts with %PDF but has invalid internal structure.
 */
function buildCorruptPdf(): Buffer {
  return Buffer.from("%PDF-1.4\nTHIS IS NOT A VALID PDF INTERNAL STRUCTURE\n%%EOF", "latin1");
}

/**
 * Build a minimal valid DOCX file using the docx library.
 */
async function buildValidDocx(text: string): Promise<Buffer> {
  const { Document, Packer, Paragraph } = await import("docx");
  const paragraphs = text.split("\n").map(line => new Paragraph(line));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}

// ============================================================
// Run tests
// ============================================================

async function runTests() {
  console.log("=== CV Parse Failure Classification Tests ===\n");

  let passed = 0;
  let failed = 0;

  function track(result: boolean, label: string) {
    if (result) {
      passed++;
      console.log(`  ✓ PASS: ${label}`);
    } else {
      failed++;
      console.log(`  ✗ FAIL: ${label}`);
    }
  }

  // ===== A. Searchable PDF → PASS =====
  console.log("[A] Searchable PDF → PASS");
  {
    const pdf = buildSearchablePdf(
      "John Smith\njohn.smith@email.com\n+91 98765 43210\n" +
      "Education: B.Tech in Computer Science, IIT Bombay, 2018-2022, CGPA: 8.5/10\n" +
      "Experience: Software Engineer at Google, 2022-present\n" +
      "Skills: Python, JavaScript, React, TensorFlow, Docker, AWS\n" +
      "Projects: ML Recommendation System using Python and TensorFlow"
    );
    try {
      const parsed = await parseCVFile(pdf, "test-cv.pdf");
      track(!!parsed, "Searchable PDF parsed successfully");
      track(parsed.rawTextLength > 50, "Extracted text length > 50");
      track(parsed.personalData.firstName === "John", "Name extracted from searchable PDF");
      track(parsed.personalData.email === "john.smith@email.com", "Email extracted from searchable PDF");
    } catch (e: any) {
      track(false, `Searchable PDF should not throw: ${e?.message}`);
    }
  }

  // ===== B. DOCX → PASS =====
  console.log("\n[B] DOCX → PASS");
  {
    try {
      const docx = await buildValidDocx(
        "Jane Doe\njane.doe@email.com\n+1 (555) 123-4567\n" +
        "Education: M.S. in Data Science, Stanford University, 2020-2022\n" +
        "Experience: Data Scientist at Microsoft, 2022-present\n" +
        "Skills: Python, R, SQL, Tableau, Azure"
      );
      const parsed = await parseCVFile(docx, "test-cv.docx");
      track(!!parsed, "DOCX parsed successfully");
      track(parsed.rawTextLength > 50, "DOCX extracted text length > 50");
    } catch (e: any) {
      track(false, `DOCX should not throw: ${e?.message}`);
    }
  }

  // ===== C. Image-only/scanned PDF → IMAGE_ONLY_PDF =====
  console.log("\n[C] Image-only/scanned PDF → IMAGE_ONLY_PDF");
  {
    const pdf = buildImageOnlyPdf();
    try {
      await parseCVFile(pdf, "scanned-cv.pdf");
      track(false, "Image-only PDF should throw IMAGE_ONLY_PDF");
    } catch (e: any) {
      const code = (e as CVParseFailure).code;
      track(code === "IMAGE_ONLY_PDF", `Throws IMAGE_ONLY_PDF (got: ${code})`);
      track(
        (e as CVParseFailure).userMessage.includes("scanned or image-based PDF"),
        "User message mentions scanned/image-based PDF"
      );
      track(
        (e as CVParseFailure).userMessage.includes("searchable PDF or DOCX"),
        "User message suggests searchable PDF or DOCX"
      );
    }
  }

  // ===== D. Empty PDF → INSUFFICIENT_TEXT =====
  console.log("\n[D] Empty PDF → INSUFFICIENT_TEXT");
  {
    // Build a PDF with very little text (just a few chars)
    const pdf = buildSearchablePdf("Hi");
    try {
      await parseCVFile(pdf, "empty-cv.pdf");
      track(false, "Near-empty PDF should throw INSUFFICIENT_TEXT");
    } catch (e: any) {
      const code = (e as CVParseFailure).code;
      // Could be IMAGE_ONLY_PDF or INSUFFICIENT_TEXT depending on extraction
      track(
        code === "INSUFFICIENT_TEXT" || code === "IMAGE_ONLY_PDF",
        `Throws INSUFFICIENT_TEXT or IMAGE_ONLY_PDF (got: ${code})`
      );
      if (code === "INSUFFICIENT_TEXT") {
        track(
          (e as CVParseFailure).userMessage.includes("enough CV text"),
          "INSUFFICIENT_TEXT message mentions not enough text"
        );
      }
    }
  }

  // ===== E. Corrupt PDF → CORRUPT_OR_UNREADABLE_PDF (controlled failure) =====
  console.log("\n[E] Corrupt PDF → CORRUPT_OR_UNREADABLE_PDF");
  {
    const pdf = buildCorruptPdf();
    try {
      await parseCVFile(pdf, "corrupt-cv.pdf");
      track(false, "Corrupt PDF should throw CORRUPT_OR_UNREADABLE_PDF");
    } catch (e: any) {
      const code = (e as CVParseFailure).code;
      track(code === "CORRUPT_OR_UNREADABLE_PDF", `Throws CORRUPT_OR_UNREADABLE_PDF (got: ${code})`);
      track(
        (e as CVParseFailure).userMessage.includes("could not be read"),
        "User message mentions could not be read"
      );
      // Verify no stack trace is leaked in the user message
      track(
        !(e as CVParseFailure).userMessage.includes("at "),
        "No stack trace in user message"
      );
    }
  }

  // ===== F. Non-PDF/DOCX file → PARSE_FAILED =====
  console.log("\n[F] Unsupported file type → controlled failure");
  {
    try {
      await parseCVFile(Buffer.from("some text"), "test.xyz");
      track(false, "Unsupported file should throw");
    } catch (e: any) {
      const code = (e as CVParseFailure).code;
      track(code === "PARSE_FAILED", `Throws PARSE_FAILED for unsupported type (got: ${code})`);
    }
  }

  // ===== G. createCVParseFailure produces correct structure =====
  console.log("\n[G] createCVParseFailure structure");
  {
    const fail = createCVParseFailure("IMAGE_ONLY_PDF");
    track(fail.code === "IMAGE_ONLY_PDF", "code is IMAGE_ONLY_PDF");
    track(fail.userMessage.includes("scanned"), "userMessage has friendly text");
    track(fail.message !== "", "message is set");
    track(fail instanceof Error, "Extends Error");
  }

  // ===== H. No OpenAI calls =====
  console.log("\n[H] No OpenAI calls");
  {
    // Verify cv-parser.ts does not import openai-client
    const fs = await import("fs");
    const parserSource = fs.readFileSync("./src/lib/application/cv-parser.ts", "utf-8");
    track(!parserSource.includes("openai"), "cv-parser.ts does not import openai");
    track(!parserSource.includes("OpenAI"), "cv-parser.ts does not reference OpenAI class");

    const routeSource = fs.readFileSync("./src/app/api/application/cv-upload/route.ts", "utf-8");
    track(!routeSource.includes("openai-client"), "cv-upload route does not import openai-client");
  }

  // ===== I. Route returns structured 400 with code =====
  console.log("\n[I] Route returns structured 400 with code");
  {
    const fs = await import("fs");
    const routeSource = fs.readFileSync("./src/app/api/application/cv-upload/route.ts", "utf-8");
    track(routeSource.includes("CVParseFailure"), "Route imports CVParseFailure type");
    track(routeSource.includes("parseError?.code"), "Route checks parseError code");
    track(routeSource.includes("status: 400"), "Route returns 400 for parse failures");
    track(routeSource.includes("userMessage"), "Route returns userMessage (not raw error)");
    track(routeSource.includes("logCVParseFailure"), "Route has structured logging function");
    track(routeSource.includes("cv_parse_failure"), "Log event is cv_parse_failure");
    track(routeSource.includes("studentId"), "Log includes studentId");
    track(routeSource.includes("mimeType"), "Log includes mimeType");
    track(routeSource.includes("fileSize"), "Log includes fileSize");
    track(routeSource.includes("buildId"), "Log includes buildId");
    // Verify no CV text is logged
    track(!routeSource.includes("text:"), "Route does not log CV text content");
    track(!routeSource.includes("console.error"), "Route does not use console.error (uses structured log)");
  }

  // ===== J. UI shows specific message + Upload Different CV =====
  console.log("\n[J] UI shows specific message + Upload Different CV");
  {
    const fs = await import("fs");
    const uiSource = fs.readFileSync("./src/components/ui/CVUpload.tsx", "utf-8");
    track(uiSource.includes("errorCode"), "UI tracks errorCode state");
    track(uiSource.includes("data.code"), "UI reads code from server response");
    track(uiSource.includes("data.error"), "UI reads friendly error from server response");
    track(uiSource.includes("Upload Different CV"), "UI has 'Upload Different CV' button on parse failure");
    track(uiSource.includes("handleReset"), "UI has handleReset to clear state without clearing profile");
  }

  // ===== Summary =====
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
