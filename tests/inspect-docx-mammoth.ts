import { readFile } from "fs/promises";
import { validateDocx } from "../src/lib/application/docx-validator";
import mammoth from "mammoth";

async function main() {
  const buf = await readFile("/Users/shivang/Desktop/AI SOP/Test pdf/kunj modh (1) (1).docx");

  // Validate
  const result = validateDocx(buf);
  console.log("Valid DOCX:", result.valid);
  console.log("Error:", result.error || "none");
  if (result.entries) {
    console.log("\nZIP entries:");
    for (const e of result.entries) {
      console.log(`  ${e.name} — compressed: ${e.compressedSize}, uncompressed: ${e.uncompressedSize}`);
    }
  }

  // Extract with mammoth
  console.log("\n=== Mammoth extraction ===");
  const mammothResult = await mammoth.extractRawText({ buffer: buf });
  console.log("Extracted text length:", mammothResult.value.length);
  console.log("First 500 chars:", JSON.stringify(mammothResult.value.substring(0, 500)));
  console.log("Messages:", mammothResult.messages);

  // Also try extractHtml to see if there's more content
  console.log("\n=== Mammoth HTML extraction ===");
  const htmlResult = await mammoth.convertToHtml({ buffer: buf });
  console.log("HTML length:", htmlResult.value.length);
  console.log("First 500 chars of HTML:", JSON.stringify(htmlResult.value.substring(0, 500)));
}

main().catch(console.error);
