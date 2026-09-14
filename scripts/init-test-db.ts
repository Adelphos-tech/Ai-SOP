import mysql from "mysql2/promise";
import { SCHEMA_SQL } from "../src/lib/application/schema";
import { REQUIREMENTS_SCHEMA_SQL } from "../src/lib/application/requirements-schema";

async function main() {
  const conn = await mysql.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: "sop_test",
    password: process.env.SOP_TEST_DB_PASSWORD || "",
    database: "sop_ai_app_test",
  });

  const tableRegex = /CREATE TABLE IF NOT EXISTS \w+[\s\S]*?\) ENGINE[^;]+;/g;
  const allSql = `${SCHEMA_SQL}\n${REQUIREMENTS_SCHEMA_SQL}`;
  const matches = allSql.match(tableRegex) || [];

  for (const stmt of matches) {
    const tableName = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
    try {
      await conn.execute(stmt);
      console.log(`  ✓ Table ${tableName} ready`);
    } catch (err: any) {
      console.error(`  ✗ Error creating ${tableName}: ${err?.message}`);
    }
  }

  const [tables] = await conn.execute("SHOW TABLES");
  const tableNames = (tables as any[]).map(t => Object.values(t)[0]);
  console.log(`\nTables in sop_ai_app_test: ${tableNames.join(", ")}`);
  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
