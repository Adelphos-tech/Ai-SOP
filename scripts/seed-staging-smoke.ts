/**
 * @file seed-staging-smoke.ts
 * @description Idempotent synthetic smoke-test data for the staging
 * environment. Creates ONE consultant (env-provided credentials),
 * student, application, SOP document + version with a synthetic
 * 40-word text, and applies the Ryne ledger migration tables.
 * Never prints credentials. Safe to re-run (upserts).
 */

import mysql from "mysql2/promise";
import { randomBytes, scryptSync, randomUUID } from "crypto";
import { SCHEMA_SQL } from "../src/lib/application/schema";
import { readFileSync } from "fs";

const KEYLEN = 32, SALTLEN = 16, N = 16384, R = 8, P = 1;
function hashPassword(pw: string): string {
  const salt = randomBytes(SALTLEN);
  const h = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString("hex")}:${h.toString("hex")}`;
}

const DOC_TEXT =
  "During my internship at a regional hospital, I built a small triage dashboard for the emergency intake team. " +
  "That project showed me how machine learning can support clinical decisions, and it is why I am applying to this program.";

// Fixed UUIDs — the API validates UUID format; deterministic so the
// hosted smoke check can address the document without a lookup.
const CONSULTANT_ID = "deadbeef-0000-4000-8000-000000000001";
const STUDENT_ID = "deadbeef-0000-4000-8000-000000000002";
const APP_ID = "deadbeef-0000-4000-8000-000000000003";
const DOC_ID = "deadbeef-0000-4000-8000-000000000004";
const VER_ID = "deadbeef-0000-4000-8000-000000000005";

async function main() {
  const email = process.env.STAGING_SMOKE_EMAIL;
  const password = process.env.STAGING_SMOKE_PASSWORD;
  if (!email || !password) throw new Error("STAGING_SMOKE_EMAIL/STAGING_SMOKE_PASSWORD required");

  const conn = await mysql.createConnection({
    host: process.env.SOP_DB_HOST || "127.0.0.1",
    port: parseInt(process.env.SOP_DB_PORT || "3306", 10),
    user: process.env.SOP_DB_USER || "root",
    password: process.env.SOP_DB_PASSWORD || "",
    database: process.env.SOP_DB_NAME || "sop_ai_staging",
    multipleStatements: false,
  });

  // App schema (idempotent) + Ryne ledger migration (idempotent).
  const stmts = SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS \w+[\s\S]*?\) ENGINE[^;]+;/g) || [];
  for (const s of stmts) await conn.execute(s);
  const mig = readFileSync(
    new URL("../migrations/2026-11-14-ryne-spend-ledger.sql", import.meta.url), "utf8");
  for (const s of mig.split(/;\s*\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("--"))) {
    await conn.execute(s.replace(/^--.*$/gm, "").trim());
  }

  await conn.execute(
    `INSERT INTO consultants (id,email,password_hash,name,role,is_active) VALUES (?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)`,
    [CONSULTANT_ID, email, hashPassword(password), "Staging Smoke", "ADMIN"]);

  await conn.execute(
    `INSERT INTO students (id,first_name,last_name,email) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE first_name=VALUES(first_name)`,
    [STUDENT_ID, "Smoke", "Staging", "smoke-student@staging.local"]);

  await conn.execute(
    `INSERT INTO applications (id,student_id,university_name,program_name,degree,country,intake,intake_year,status)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE university_name=VALUES(university_name)`,
    [APP_ID, STUDENT_ID, "STAGING UNIVERSITY", "MS Smoke", "Masters", "USA", "Fall", "2026", "IN_PROGRESS"]);

  await conn.execute(
    `INSERT INTO application_documents (id,application_id,document_type,document_title,prompt_text,prompt_source,generation_status,current_version_id)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE current_version_id=VALUES(current_version_id)`,
    [DOC_ID, APP_ID, "SOP", "Staging Smoke SOP", "Synthetic smoke doc", "MANUAL", "COMPLETED", VER_ID]);

  await conn.execute(
    `INSERT INTO document_versions (id,document_id,version_number,content,content_format,created_by_type)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE content=VALUES(content)`,
    [VER_ID, DOC_ID, 1, DOC_TEXT, "MARKDOWN", "SYSTEM"]);

  // Only non-secret output: the page path for the smoke test.
  console.log(`SEED_OK /students/${STUDENT_ID}/applications/${APP_ID}/documents/${DOC_ID}/writing-review`);
  await conn.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
