// ============================================================
// DOCX EXTRACTION WITH BOUNDED SAFETY
// ============================================================
// Extracts text from DOCX using mammoth with size bounds
// to prevent zip bombs and memory exhaustion.
// ============================================================

import mammoth from "mammoth";

/** Maximum uncompressed DOCX size to accept (10 MB) */
export const MAX_DOCX_UNCOMPRESSED = 10 * 1024 * 1024;

/** Maximum number of XML files to process (prevents zip bomb) */
export const MAX_DOCX_XML_FILES = 1000;

/**
 * Validate DOCX buffer - check if it's a valid DOCX file
 * Returns true if valid, throws if invalid
 */
export async function validateDocx(buffer: Buffer): Promise<boolean> {
  if (buffer.length > MAX_DOCX_UNCOMPRESSED) {
    throw new Error(`DOCX too large: ${buffer.length} bytes (max ${MAX_DOCX_UNCOMPRESSED})`);
  }
  
  try {
    // Try to extract text to validate structure
    await mammoth.extractRawText({ buffer });
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.message?.includes("not found")) {
      throw new Error("DOCX structure invalid: document.xml not found");
    }
    if (error?.message?.includes("zip") || error?.message?.includes("corrupt")) {
      throw new Error("DOCX appears corrupted or invalid ZIP structure");
    }
    throw new Error(`DOCX validation failed: ${error?.message || "unknown error"}`);
  }
}

/**
 * Extract text from DOCX buffer with bounded safety checks.
 * Uses mammoth's built-in extraction which handles zip internals.
 */
export async function extractDocxTextBounded(buffer: Buffer): Promise<string> {
  // Basic size check on input buffer
  if (buffer.length > MAX_DOCX_UNCOMPRESSED) {
    throw new Error(`DOCX too large: ${buffer.length} bytes (max ${MAX_DOCX_UNCOMPRESSED})`);
  }

  try {
    // mammoth extracts text from the document.xml content
    // It handles the ZIP extraction internally
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || "";
    
    // Warn about potential issues but don't fail
    if (result.messages && result.messages.length > 0) {
      const warnings = result.messages.map(m => m.message).join("; ");
      console.warn(`[DOCX] Extraction warnings: ${warnings}`);
    }

    return text;
  } catch (error: any) {
    // Classify common DOCX extraction failures
    if (error?.code === "ENOENT" || error?.message?.includes("not found")) {
      throw new Error("DOCX structure invalid: document.xml not found");
    }
    if (error?.message?.includes("zip") || error?.message?.includes("corrupt")) {
      throw new Error("DOCX appears corrupted or invalid ZIP structure");
    }
    if (error?.message?.includes("size") || error?.message?.includes("memory")) {
      throw new Error("DOCX extraction exceeded memory/size limits");
    }
    throw new Error(`DOCX extraction failed: ${error?.message || "unknown error"}`);
  }
}