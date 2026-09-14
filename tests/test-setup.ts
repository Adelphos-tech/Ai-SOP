/**
 * @file tests/test-setup.ts
 * @description
 * Phase SOP-AI-34A: Test database isolation module.
 *
 * This module MUST be imported before any other application imports
 * in test files that touch the database. It sets environment variables
 * to point at the isolated test database (sop_ai_app_test) and provides
 * a hard safety guard that prevents tests from ever connecting to the
 * production database (sop_ai_app).
 *
 * HARD SAFETY GUARD:
 *   assertTestDatabase() checks the actual connected database name.
 *   If it is NOT sop_ai_app_test, the test aborts immediately.
 *
 * Test files should import from this module instead of directly
 * from src/lib/application/db.
 */

// ============================================================
// Set test database environment variables BEFORE any other
// module can create a database connection pool.
// ============================================================
process.env.SOP_DB_HOST = process.env.SOP_TEST_DB_HOST || "127.0.0.1";
process.env.SOP_DB_PORT = process.env.SOP_TEST_DB_PORT || "3306";
process.env.SOP_DB_USER = process.env.SOP_TEST_DB_USER || "sop_test";
process.env.SOP_DB_PASSWORD = process.env.SOP_TEST_DB_PASSWORD || "";
process.env.SOP_DB_NAME = process.env.SOP_TEST_DB_NAME || "sop_ai_app_test";

// ============================================================
// Re-export DB pool functions for convenience.
// The pool will use the test env vars set above.
// ============================================================
export { getDbPool, closeDbPool, testDbConnection } from "../src/lib/application/db";

// ============================================================
// HARD SAFETY GUARD
// ============================================================

/**
 * Assert that the currently connected database is sop_ai_app_test.
 * If not, throw immediately and abort the test.
 * This prevents any test from accidentally mutating production data.
 */
export async function assertTestDatabase(): Promise<void> {
  const { getDbPool } = await import("../src/lib/application/db");
  const pool = getDbPool();
  const [rows] = await pool.execute("SELECT DATABASE() AS db");
  const dbName = (rows as any[])[0]?.db;
  if (dbName !== "sop_ai_app_test") {
    throw new Error(
      `HARD SAFETY GUARD FAILED: Expected test database "sop_ai_app_test" but connected to "${dbName}". ` +
      `Tests must NEVER run against the production database. Aborting immediately.`
    );
  }
}

/**
 * Clean up all test data from the test database.
 * Only callable when connected to sop_ai_app_test.
 * Uses TRUNCATE for fast, clean reset.
 */
export async function cleanupTestDb(): Promise<void> {
  await assertTestDatabase();
  const { getDbPool } = await import("../src/lib/application/db");
  const pool = getDbPool();
  await pool.execute("SET FOREIGN_KEY_CHECKS = 0");
  await pool.execute("DELETE FROM requirement_sources");
  await pool.execute("DELETE FROM writing_requirements");
  await pool.execute("DELETE FROM application_requirement_sets");
  await pool.execute("DELETE FROM programs");
  await pool.execute("DELETE FROM institutions");
  await pool.execute("DELETE FROM document_versions");
  await pool.execute("DELETE FROM application_documents");
  await pool.execute("DELETE FROM applications");
  await pool.execute("DELETE FROM students");
  await pool.execute("SET FOREIGN_KEY_CHECKS = 1");
}

/**
 * Get production row counts for verification.
 * This connects to the PRODUCTION database read-only to
 * record counts before/after test runs.
 */
export async function getProductionCounts(): Promise<Record<string, number>> {
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: process.env.SOP_PROD_DB_USER || "sop_app",
    password: process.env.SOP_PROD_DB_PASSWORD || "",
    database: "sop_ai_app",
  });
  const tables = [
    "students",
    "applications",
    "application_documents",
    "document_versions",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM ${table}`);
    counts[table] = (rows as any[])[0].cnt;
  }
  await conn.end();
  return counts;
}
