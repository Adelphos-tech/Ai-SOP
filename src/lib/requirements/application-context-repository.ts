// ============================================================
// VERIFIED APPLICATION CONTEXT REPOSITORY (Phase SOP-AI-26)
// ============================================================
// File-based persistence for VerifiedApplicationContext.
//
// Storage location: logs/application-contexts/<applicationId>.json
//
// This is the simplest suitable existing persistence mechanism.
// The existing requirements-db.ts uses the same pattern for briefs.
// A future database integration can replace this interface
// without changing the API surface.
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import {
  VerifiedApplicationContext,
  LoadContextResult,
} from "./application-context";
import { isFresh } from "./freshness";

const CONTEXT_DIR = path.join(process.cwd(), "logs", "application-contexts");

async function ensureDir(): Promise<void> {
  await fs.mkdir(CONTEXT_DIR, { recursive: true });
}

/**
 * Save a verified application context to the file-based store.
 */
export async function saveVerifiedApplicationContext(
  ctx: VerifiedApplicationContext,
): Promise<void> {
  await ensureDir();
  const filePath = path.join(CONTEXT_DIR, `${ctx.applicationId}.json`);
  await fs.writeFile(filePath, JSON.stringify(ctx, null, 2), "utf-8");
}

/**
 * Load a verified application context by application ID.
 * Returns { found: false } if not found or expired.
 */
export async function loadVerifiedApplicationContext(
  applicationId: string,
): Promise<LoadContextResult> {
  try {
    const filePath = path.join(CONTEXT_DIR, `${applicationId}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    const ctx = JSON.parse(content) as VerifiedApplicationContext;

    // Check freshness using the brief's createdAt
    if (ctx.expiresAt) {
      const expiry = new Date(ctx.expiresAt).getTime();
      if (Date.now() > expiry) {
        return { found: false, context: null, reason: "CONTEXT_EXPIRED" };
      }
    }

    return { found: true, context: ctx, reason: null };
  } catch {
    return { found: false, context: null, reason: "CONTEXT_NOT_FOUND" };
  }
}

/**
 * Load a verified application context by application identity.
 */
export async function loadVerifiedApplicationContextByIdentity(identity: {
  country: string;
  university: string;
  program: string;
  degreeLevel: string;
  intake: string;
  intakeYear: string;
}): Promise<LoadContextResult> {
  const { generateApplicationId } = await import("./application-context");
  const applicationId = generateApplicationId(identity);
  return loadVerifiedApplicationContext(applicationId);
}

/**
 * Invalidate/delete a verified application context.
 */
export async function invalidateVerifiedApplicationContext(
  applicationId: string,
): Promise<void> {
  try {
    const filePath = path.join(CONTEXT_DIR, `${applicationId}.json`);
    await fs.unlink(filePath);
  } catch {
    // ignore if not found
  }
}

/**
 * List all stored application context IDs.
 */
export async function listApplicationContexts(): Promise<string[]> {
  try {
    const files = await fs.readdir(CONTEXT_DIR);
    return files
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(".json", ""));
  } catch {
    return [];
  }
}
