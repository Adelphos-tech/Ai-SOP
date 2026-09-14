import { promises as fs } from "fs";
import path from "path";
import { VerifiedApplicationBrief } from "./types";
import { generateCacheKey } from "./freshness";

const DB_DIR = path.join(process.cwd(), "logs", "requirements");

async function ensureDir(): Promise<void> {
  await fs.mkdir(DB_DIR, { recursive: true });
}

/**
 * Save a verified application brief to the file-based database.
 */
export async function saveBrief(brief: VerifiedApplicationBrief): Promise<void> {
  await ensureDir();
  const filePath = path.join(DB_DIR, `${brief.cacheKey}.json`);
  await fs.writeFile(filePath, JSON.stringify(brief, null, 2), "utf-8");
}

/**
 * Load a cached brief by cache key.
 */
export async function loadBrief(cacheKey: string): Promise<VerifiedApplicationBrief | null> {
  try {
    const filePath = path.join(DB_DIR, `${cacheKey}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as VerifiedApplicationBrief;
  } catch {
    return null;
  }
}

/**
 * Load a cached brief by application identity.
 */
export async function loadBriefByIdentity(identity: {
  country: string;
  university: string;
  program: string;
  degreeLevel: string;
  intake: string;
  intakeYear: string;
}): Promise<VerifiedApplicationBrief | null> {
  const key = generateCacheKey(identity);
  return loadBrief(key);
}

/**
 * List all cached brief keys.
 */
export async function listBriefs(): Promise<string[]> {
  try {
    const files = await fs.readdir(DB_DIR);
    return files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
  } catch {
    return [];
  }
}

/**
 * Delete a cached brief.
 */
export async function deleteBrief(cacheKey: string): Promise<void> {
  try {
    const filePath = path.join(DB_DIR, `${cacheKey}.json`);
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}
