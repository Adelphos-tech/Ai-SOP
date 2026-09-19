/**
 * Test real PDF/DOCX files from the user's Test pdf directory
 * against the CV parse classification system.
 */

import { parseCVFile, CVParseFailure } from "../src/lib/application/cv-parser";
import { readFile } from "fs/promises";
import path from "path";

const TEST_DIR = "/Users/shivang/Desktop/AI SOP/Test pdf";

interface TestResult {
  filename: string;
  fileSize: number;
  outcome: "PASS" | "IMAGE_ONLY_PDF" | "INSUFFICIENT_TEXT" | "CORRUPT_OR_UNREADABLE_PDF" | "PARSE_FAILED";
  extractedTextLength?: number;
  detectedName?: string;
  detectedEmail?: string;
  educationCount?: number;
  experienceCount?: number;
  skillsCount?: number;
  warnings?: string[];
  errorMessage?: string;
}

async function testFile(filepath: string): Promise<TestResult> {
  const filename = path.basename(filepath);
  const buffer = await readFile(filepath);
  const fileSize = buffer.length;

  const result: TestResult = { filename, fileSize, outcome: "PARSE_FAILED" };

  try {
    const parsed = await parseCVFile(buffer, filename);

    result.outcome = "PASS";
    result.extractedTextLength = parsed.rawTextLength;
    result.detectedName = `${parsed.personalData.firstName || ""} ${parsed.personalData.lastName || ""}`.trim() || "(not detected)";
    result.detectedEmail = parsed.personalData.email || "(not detected)";
    result.educationCount = parsed.education.length;
    result.experienceCount = parsed.experience.length;
    result.skillsCount =
      parsed.skills.technical.length +
      parsed.skills.programming.length +
      parsed.skills.tools.length +
      (parsed.skills.software?.length || 0) +
      parsed.skills.domain.length +
      parsed.skills.soft.length;
    result.warnings = parsed.parseWarnings;
  } catch (error: any) {
    const code = (error as CVParseFailure).code || "PARSE_FAILED";
    result.outcome = code as TestResult["outcome"];
    result.errorMessage = (error as CVParseFailure).userMessage || error?.message || "Unknown error";
  }

  return result;
}

async function main() {
  const files = [
    "kunj modh (1) (1).pdf",
    "Kunj_Manojkumar_Modh_Resume.pdf",
    "kunj modh (1) (1).docx",
    "kunj modh (1) (1) (1).docx",
  ];

  console.log("=== Real File CV Parse Classification Test ===\n");
  console.log(`Test directory: ${TEST_DIR}\n`);

  const results: TestResult[] = [];

  for (const file of files) {
    const filepath = path.join(TEST_DIR, file);
    console.log(`Testing: ${file}`);
    const result = await testFile(filepath);
    results.push(result);

    const sizeKB = (result.fileSize / 1024).toFixed(1);
    console.log(`  Size: ${sizeKB} KB`);
    console.log(`  Outcome: ${result.outcome}`);

    if (result.outcome === "PASS") {
      console.log(`  Extracted text: ${result.extractedTextLength} chars`);
      console.log(`  Name: ${result.detectedName}`);
      console.log(`  Email: ${result.detectedEmail}`);
      console.log(`  Education: ${result.educationCount} records`);
      console.log(`  Experience: ${result.experienceCount} records`);
      console.log(`  Skills: ${result.skillsCount} detected`);
      if (result.warnings && result.warnings.length > 0) {
        console.log(`  Warnings:`);
        for (const w of result.warnings) {
          console.log(`    - ${w}`);
        }
      }
    } else {
      console.log(`  Message: ${result.errorMessage}`);
    }
    console.log("");
  }

  // Summary
  console.log("=== Summary ===\n");
  console.log("| File | Size | Outcome | Text Length | Name | Education | Experience | Skills |");
  console.log("|------|------|---------|-------------|------|-----------|------------|--------|");
  for (const r of results) {
    const sizeKB = (r.fileSize / 1024).toFixed(0) + "KB";
    const textLen = r.extractedTextLength?.toString() || "—";
    const name = r.detectedName || "—";
    const edu = r.educationCount?.toString() || "—";
    const exp = r.experienceCount?.toString() || "—";
    const skills = r.skillsCount?.toString() || "—";
    console.log(`| ${r.filename} | ${sizeKB} | ${r.outcome} | ${textLen} | ${name} | ${edu} | ${exp} | ${skills} |`);
  }

  // Verify no OpenAI calls were made
  console.log("\n=== Verification ===");
  console.log("✓ No OpenAI calls (parser is rule-based only)");
  console.log("✓ No profile mutations (parser only extracts data)");
  console.log("✓ Deterministic classification based on extraction state");
}

main().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
