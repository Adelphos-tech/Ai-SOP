/**
 * @file docx-image-inspect.ts
 * Cheap structural inspection of DOCX embedded media — used ONLY to
 * decide whether the OCR fallback should run for mixed documents
 * (small live XML text + resume content carried in large images).
 *
 * Signals are deterministic: media entry list, byte sizes, and image
 * dimensions read from format headers (no decode, no OCR, no model).
 *
 * "Content image" = large enough to plausibly be a rendered page or a
 * major resume section — calibrated on real corpus page scans
 * (~1.1k–1.2k px wide, ~2 MP). Logos, icons, signatures and passport
 * photos are far below these bounds.
 */
import JSZip from "jszip";

/** Minimum pixels on the SHORT side for an image to count as page content. */
export const DOCX_CONTENT_IMAGE_MIN_SIDE = 500;
/** Minimum total pixel area — ~half a page at 150 DPI. */
export const DOCX_CONTENT_IMAGE_MIN_PIXELS = 400_000;
/** Above this much live XML text the document is not image-dominant. */
export const IMAGE_DOMINANT_TEXT_MAX = 800;

export interface DocxImageInspection {
  imageCount: number;
  /** Images large enough to plausibly carry document/page content. */
  contentImageCount: number;
  contentImagePixels: number;
}

const IMAGE_RE = /^word\/media\/[^/]+\.(png|jpe?g|gif|bmp|webp)$/i;

function pngSize(b: Buffer): [number, number] | null {
  // signature(8) + length(4) + "IHDR"(4) then width,height BE
  if (b.length < 24 || b.readUInt32BE(12) !== 0x49484452) return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function gifSize(b: Buffer): [number, number] | null {
  if (b.length < 10) return null;
  return [b.readUInt16LE(6), b.readUInt16LE(8)];
}

function bmpSize(b: Buffer): [number, number] | null {
  if (b.length < 26) return null;
  return [b.readUInt32LE(18), Math.abs(b.readInt32LE(22))];
}

function jpegSize(b: Buffer): [number, number] | null {
  // Scan for a Start-Of-Frame marker; dims live right after it.
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0–SOF15 except DHT(0xC4), JPG(0xC8), DAC(0xCC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; // [w, h]
    }
    const segLen = b.readUInt16BE(i + 2);
    if (segLen < 2) return null;
    i += 2 + segLen;
  }
  return null;
}

function imageSize(name: string, b: Buffer): [number, number] | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "png") return pngSize(b);
  if (ext === "jpg" || ext === "jpeg") return jpegSize(b);
  if (ext === "gif") return gifSize(b);
  if (ext === "bmp") return bmpSize(b);
  return null; // webp/emf/wmf — dims unknown, not counted as content
}

/**
 * Inspect a DOCX buffer's embedded media. Returns counts of total and
 * "content-sized" images. Never throws on unparseable entries — a bad
 * image is simply not counted.
 */
export async function inspectDocxImages(buffer: Buffer): Promise<DocxImageInspection> {
  const zip = await JSZip.loadAsync(buffer);
  const out: DocxImageInspection = { imageCount: 0, contentImageCount: 0, contentImagePixels: 0 };
  const entries = zip.file(IMAGE_RE);
  for (const entry of entries) {
    out.imageCount++;
    try {
      const data = await entry.async("nodebuffer");
      const size = imageSize(entry.name, data);
      if (!size) continue;
      const [w, h] = size;
      if (Math.min(w, h) >= DOCX_CONTENT_IMAGE_MIN_SIDE && w * h >= DOCX_CONTENT_IMAGE_MIN_PIXELS) {
        out.contentImageCount++;
        out.contentImagePixels += w * h;
      }
    } catch { /* corrupt entry — ignore */ }
  }
  return out;
}
