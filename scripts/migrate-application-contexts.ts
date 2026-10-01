/**
 * migrate-application-contexts.ts — operator-run LEGACY seeding
 *
 * Copies the CURRENT shared students.profile_data application-scope
 * values into applications.context_data for every LEGACY application
 * (application_context_version=1), marks each field LEGACY_SHARED, and
 * advances the application to version 2.
 *
 * DETERMINISM / HONESTY: profile_data only ever stored the LATEST
 * shared value. Historical per-application differences are
 * unrecoverable — this script does NOT fabricate them. Seeding freezes
 * the single observable value each application reads today, marked
 * LEGACY_SHARED, and stops all future cross-application contamination.
 *
 * Runtime intake saves auto-migrate applications individually, so this
 * script is optional. Run only when you want every application scoped
 * up-front:
 *   npx tsx scripts/migrate-application-contexts.ts [--dry-run]
 *
 * OpenAI calls: 0.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { getDbPool, closeDbPool } = await import("../src/lib/application/db");
  const { extractApplicationScopeFields } = await import("../src/lib/application/application-context");
  const pool = getDbPool();

  const [apps] = await pool.execute(
    `SELECT a.id, a.student_id FROM applications a
      WHERE COALESCE(a.application_context_version, 1) < 2`,
  );

  let migrated = 0;
  let skipped = 0;
  for (const app of apps as any[]) {
    const [rows] = await pool.execute(
      "SELECT profile_data FROM students WHERE id = ?",
      [app.student_id],
    );
    const raw = (rows as any[])[0]?.profile_data;
    const profile = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const seed = extractApplicationScopeFields(profile);
    if (Object.keys(seed).length === 0) {
      skipped++;
      continue; // nothing shared to preserve — leave LEGACY until intake save
    }
    const provenance: Record<string, string> = {};
    for (const k of Object.keys(seed)) provenance[k] = "LEGACY_SHARED";
    const now = new Date().toISOString();
    const contextData = { fields: seed, provenance, seededAt: now, updatedAt: now };
    if (!DRY_RUN) {
      await pool.execute(
        `UPDATE applications
           SET context_data = ?, application_context_version = 2
         WHERE id = ?`,
        [JSON.stringify(contextData), app.id],
      );
    }
    migrated++;
    console.log(`  ${DRY_RUN ? "[dry] " : ""}application ${app.id}: seeded ${Object.keys(seed).length} fields (LEGACY_SHARED)`);
  }

  console.log(`\n${migrated} applications seeded → APP_SCOPED, ${skipped} skipped (no shared app values)${DRY_RUN ? " [DRY RUN]" : ""}`);
  console.log("OPENAI CALLS: 0");
  await closeDbPool();
}

main().catch(e => { console.error(e); process.exit(1); });
