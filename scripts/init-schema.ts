/**
 * @file init-schema.ts
 * @description Initialize the sop_ai_app database schema
 */

import mysql from "mysql2/promise";
import { SCHEMA_SQL } from "../src/lib/application/schema";

async function main() {
  console.log("Initializing sop_ai_app schema...");

  const config = {
    host: process.env.SOP_DB_HOST || "127.0.0.1",
    port: parseInt(process.env.SOP_DB_PORT || "3306", 10),
    user: process.env.SOP_DB_USER || "root",
    password: process.env.SOP_DB_PASSWORD || "",
    database: process.env.SOP_DB_NAME || "sop_ai_app",
  };

  const conn = await mysql.createConnection(config);

  // Execute each CREATE TABLE statement separately
  const tableRegex = /CREATE TABLE IF NOT EXISTS \w+[\s\S]*?\) ENGINE[^;]+;/g;
  const matches = SCHEMA_SQL.match(tableRegex) || [];

  for (const stmt of matches) {
    const tableName = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
    try {
      await conn.execute(stmt);
      console.log(`  ✓ Table ${tableName} ready`);
    } catch (err: any) {
      console.error(`  ✗ Error creating ${tableName}: ${err?.message}`);
      throw err;
    }
  }

  console.log("\nSchema initialization complete.");

  // Verify tables
  const [tables] = await conn.execute("SHOW TABLES");
  const tableNames = (tables as any[]).map(t => Object.values(t)[0]);
  console.log(`Tables in sop_ai_app: ${tableNames.join(", ")}`);

  await conn.end();
}

main().catch(err => {
  console.error("Schema init failed:", err);
  process.exit(1);
});
