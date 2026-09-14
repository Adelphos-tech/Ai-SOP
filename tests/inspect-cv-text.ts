import { readFile } from "fs/promises";
import { extractTextFromDOCX, extractTextFromPDF } from "../src/lib/application/cv-parser";

async function main() {
  const base = "/Users/shivang/Desktop/AI SOP/Test pdf";

  // DOCX
  const docxBuf = await readFile(`${base}/kunj modh (1) (1).docx`);
  console.log("=== DOCX: kunj modh (1) (1).docx ===");
  console.log("File size:", docxBuf.length, "bytes");
  try {
    const text = await extractTextFromDOCX(docxBuf);
    console.log("Extracted text length:", text.trim().length, "chars");
    console.log("First 500 chars:", JSON.stringify(text.substring(0, 500)));
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  // PDF 1
  const pdfBuf = await readFile(`${base}/kunj modh (1) (1).pdf`);
  console.log("\n=== PDF: kunj modh (1) (1).pdf ===");
  console.log("File size:", pdfBuf.length, "bytes");
  try {
    const text = await extractTextFromPDF(pdfBuf);
    console.log("Extracted text length:", text.trim().length, "chars");
    console.log("First 500 chars:", JSON.stringify(text.substring(0, 500)));
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  // PDF 2
  const pdf2Buf = await readFile(`${base}/Kunj_Manojkumar_Modh_Resume.pdf`);
  console.log("\n=== PDF: Kunj_Manojkumar_Modh_Resume.pdf ===");
  console.log("File size:", pdf2Buf.length, "bytes");
  try {
    const text = await extractTextFromPDF(pdf2Buf);
    console.log("Extracted text length:", text.trim().length, "chars");
    console.log("First 500 chars:", JSON.stringify(text.substring(0, 500)));
    // Show first 10 lines for name detection debugging
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    console.log("\nFirst 10 non-empty lines:");
    lines.slice(0, 10).forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l)}`));
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  // PDF 1 — also show lines
  console.log("\n=== PDF 1 lines: kunj modh (1) (1).pdf ===");
  const text1 = await extractTextFromPDF(pdfBuf);
  const lines1 = text1.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  lines1.slice(0, 10).forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l)}`));
}

main().catch(console.error);
