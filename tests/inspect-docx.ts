import { readFile } from "fs/promises";
import { createInflateRaw } from "zlib";

async function unzipEntry(buf: Buffer, entryName: string): Promise<string | null> {
  // Simple ZIP parser — find local file header for entryName
  let offset = 0;
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // Local file header signature

    const compMethod = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString("utf-8", offset + 30, offset + 30 + nameLen);

    const dataOffset = offset + 30 + nameLen + extraLen;

    if (name === entryName) {
      if (compMethod === 0) {
        return buf.toString("utf-8", dataOffset, dataOffset + uncompSize);
      } else if (compMethod === 8) {
        const { inflateRawSync } = require("zlib");
        return inflateRawSync(buf.subarray(dataOffset, dataOffset + compSize)).toString("utf-8");
      }
    }

    offset = dataOffset + compSize;
  }
  return null;
}

async function main() {
  const buf = await readFile("/Users/shivang/Desktop/AI SOP/Test pdf/kunj modh (1) (1).docx");

  // List entries
  let offset = 0;
  const entries: string[] = [];
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString("utf-8", offset + 30, offset + 30 + nameLen);
    entries.push(name);
    offset = offset + 30 + nameLen + extraLen + compSize;
  }
  console.log("ZIP entries:", entries);

  // Read document.xml
  const docXml = await unzipEntry(buf, "word/document.xml");
  if (docXml) {
    console.log("\ndocument.xml length:", docXml.length);

    // Count text nodes
    const textMatches = docXml.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
    console.log("Text nodes (<w:t>):", textMatches ? textMatches.length : 0);
    if (textMatches) {
      console.log("First 10 text nodes:");
      textMatches.slice(0, 10).forEach((t, i) => console.log(`  [${i}] ${t}`));
    }

    // Check for drawings/images
    const drawings = docXml.match(/<w:drawing/g);
    console.log("\nDrawings:", drawings ? drawings.length : 0);

    // Check for text boxes
    const txbx = docXml.match(/<w:txbxContent/g);
    console.log("Text boxes:", txbx ? txbx.length : 0);

    // Check for mc:AlternateContent (often used for text boxes)
    const altContent = docXml.match(/<mc:AlternateContent/g);
    console.log("AlternateContent blocks:", altContent ? altContent.length : 0);

    // Show first 2000 chars
    console.log("\nFirst 2000 chars of document.xml:");
    console.log(docXml.substring(0, 2000));
  }
}

main().catch(console.error);
