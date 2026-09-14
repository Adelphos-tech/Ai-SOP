// ============================================================
// DOCX VALIDATION + ZIP BOMB PROTECTION
// ============================================================
// Validates that a buffer is a genuine DOCX (not just any ZIP)
// and enforces bounded extraction to prevent zip bombs.
//
// A DOCX is an OOXML ZIP archive containing at minimum:
//   [Content_Types].xml
//   word/document.xml
//
// We inspect the ZIP central directory WITHOUT fully extracting,
// enforcing:
//   - max entry count
//   - max per-entry uncompressed size
//   - max total uncompressed size
//   - max compression ratio
// ============================================================

import { createUnzip } from "zlib";

export interface DocxValidationResult {
  valid: boolean;
  error?: string;
  entries?: ZipEntryInfo[];
}

interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

// ============================================================
// BOUNDS
// ============================================================

const MAX_ENTRIES = 200;
const MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024; // 50 MB
const MAX_PER_ENTRY_UNCOMPRESSED = 25 * 1024 * 1024; // 25 MB
const MAX_COMPRESSION_RATIO = 100; // compressed must be > 1% of uncompressed

// ============================================================
// REQUIRED DOCX ENTRIES
// ============================================================

const REQUIRED_ENTRIES = ["[Content_Types].xml", "word/document.xml"];

// ============================================================
// ZIP PARSER (central directory only — no full extraction)
// ============================================================

/**
 * Parse the ZIP central directory to list entries without extracting.
 * This reads metadata only, so zip bombs can't cause memory exhaustion
 * during the listing phase.
 *
 * ZIP format: End of Central Directory record is near the end of the file.
 * It contains the offset to the start of the central directory.
 */
function parseZipEntries(buffer: Buffer): ZipEntryInfo[] {
  // Find End of Central Directory (EOCD) signature: 0x06054b50
  const EOCD_SIG = 0x06054b50;
  const MIN_EOCD_SIZE = 22;
  const MAX_COMMENT = 0xffff;

  if (buffer.length < MIN_EOCD_SIZE) {
    throw new Error("File too small to be a valid ZIP.");
  }

  // Search backwards for EOCD signature
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - MIN_EOCD_SIZE - MAX_COMMENT);
  for (let i = buffer.length - MIN_EOCD_SIZE; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Not a valid ZIP archive (no end-of-central-directory record).");
  }

  // Parse EOCD
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > MAX_ENTRIES) {
    throw new Error(`ZIP archive has too many entries (${totalEntries}). Maximum: ${MAX_ENTRIES}.`);
  }

  // Parse central directory entries
  const entries: ZipEntryInfo[] = [];
  let offset = cdOffset;
  const CD_ENTRY_SIG = 0x02014b50;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length) {
      throw new Error("Corrupt ZIP: central directory entry out of bounds.");
    }
    if (buffer.readUInt32LE(offset) !== CD_ENTRY_SIG) {
      throw new Error("Corrupt ZIP: invalid central directory entry signature.");
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    const nameStart = offset + 46;
    if (nameStart + nameLength > buffer.length) {
      throw new Error("Corrupt ZIP: entry name out of bounds.");
    }
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf-8");

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      isDirectory: name.endsWith("/"),
    });

    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

// ============================================================
// DOCX VALIDATION
// ============================================================

/**
 * Validate that a buffer is a genuine DOCX file.
 * Checks ZIP structure and required OOXML entries.
 * Enforces zip bomb protection bounds.
 */
export function validateDocx(buffer: Buffer): DocxValidationResult {
  // Magic bytes: PK (ZIP)
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
    return { valid: false, error: "File does not have ZIP magic bytes (PK). Not a valid DOCX." };
  }

  let entries: ZipEntryInfo[];
  try {
    entries = parseZipEntries(buffer);
  } catch (e: any) {
    return { valid: false, error: e.message || "Invalid ZIP structure." };
  }

  // Check required entries
  const entryNames = new Set(entries.map(e => e.name));
  for (const required of REQUIRED_ENTRIES) {
    if (!entryNames.has(required)) {
      return {
        valid: false,
        error: `Not a valid DOCX: missing required entry "${required}". This may be a renamed ZIP archive.`,
      };
    }
  }

  // Zip bomb protection: check per-entry uncompressed sizes
  let totalUncompressed = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;

    if (entry.uncompressedSize > MAX_PER_ENTRY_UNCOMPRESSED) {
      return {
        valid: false,
        error: `ZIP entry "${entry.name}" is too large when uncompressed (${(entry.uncompressedSize / 1024 / 1024).toFixed(1)} MB). Maximum per-entry: ${MAX_PER_ENTRY_UNCOMPRESSED / 1024 / 1024} MB.`,
      };
    }

    // Compression ratio check (only for compressed entries)
    if (entry.compressedSize > 0 && entry.uncompressedSize > 0) {
      const ratio = entry.uncompressedSize / entry.compressedSize;
      if (ratio > MAX_COMPRESSION_RATIO) {
        return {
          valid: false,
          error: `ZIP entry "${entry.name}" has suspicious compression ratio (${ratio.toFixed(0)}x). Possible zip bomb.`,
        };
      }
    }

    totalUncompressed += entry.uncompressedSize;
  }

  if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
    return {
      valid: false,
      error: `Total uncompressed size too large (${(totalUncompressed / 1024 / 1024).toFixed(1)} MB). Maximum: ${MAX_TOTAL_UNCOMPRESSED / 1024 / 1024} MB.`,
    };
  }

  return { valid: true, entries };
}

// ============================================================
// BOUNDED TEXT EXTRACTION (for mammoth)
// ============================================================

/**
 * Extract text from DOCX with bounded decompression.
 * Uses mammoth but with a size guard on the extracted text.
 */
export async function extractDocxTextBounded(buffer: Buffer): Promise<string> {
  // First validate
  const validation = validateDocx(buffer);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid DOCX file.");
  }

  // Now extract with mammoth (validation already bounded the risk)
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });

  // Final guard: extracted text shouldn't be absurdly large
  const MAX_TEXT = 5 * 1024 * 1024; // 5 MB of text is more than enough
  if (result.value && result.value.length > MAX_TEXT) {
    return result.value.substring(0, MAX_TEXT);
  }

  return result.value || "";
}
