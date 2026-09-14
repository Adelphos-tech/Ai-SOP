/**
 * @file seed-consultant.ts
 * @description Create or update the initial D-Vivid consultant account.
 *
 * Usage:
 *   npx tsx scripts/seed-consultant.ts --email admin@dvivid.com --name "Admin" --password "secret"
 *
 * Or via env vars:
 *   CONSULTANT_EMAIL=admin@dvivid.com CONSULTANT_NAME=Admin CONSULTANT_PASSWORD=secret npx tsx scripts/seed-consultant.ts
 */

import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { hashPassword } from "../src/lib/auth/consultant-session";

async function main() {
  const email = (process.argv.includes("--email")
    ? process.argv[process.argv.indexOf("--email") + 1]
    : process.env.CONSULTANT_EMAIL || "").trim().toLowerCase();
  const name = process.argv.includes("--name")
    ? process.argv[process.argv.indexOf("--name") + 1]
    : process.env.CONSULTANT_NAME || "";
  const password = process.argv.includes("--password")
    ? process.argv[process.argv.indexOf("--password") + 1]
    : process.env.CONSULTANT_PASSWORD || "";
  const role = process.argv.includes("--role")
    ? process.argv[process.argv.indexOf("--role") + 1]
    : "ADMIN";

  if (!email || !name || !password) {
    console.error("Usage: npx tsx scripts/seed-consultant.ts --email <email> --name <name> --password <password> [--role ADMIN|CONSULTANT]");
    console.error("   or: CONSULTANT_EMAIL=... CONSULTANT_NAME=... CONSULTANT_PASSWORD=... npx tsx scripts/seed-consultant.ts");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const config = {
    host: process.env.SOP_DB_HOST || "127.0.0.1",
    port: parseInt(process.env.SOP_DB_PORT || "3306", 10),
    user: process.env.SOP_DB_USER || "root",
    password: process.env.SOP_DB_PASSWORD || "",
    database: process.env.SOP_DB_NAME || "sop_ai_app",
  };

  const conn = await mysql.createConnection(config);

  try {
    // Check if consultant already exists
    const [existing] = await conn.execute(
      "SELECT id FROM consultants WHERE email = ?",
      [email],
    );
    const existingRow = (existing as any[])[0];

    const passwordHash = hashPassword(password);

    if (existingRow) {
      // Update password
      await conn.execute(
        "UPDATE consultants SET password_hash = ?, name = ?, role = ?, is_active = TRUE WHERE id = ?",
        [passwordHash, name, role, existingRow.id],
      );
      console.log(`Updated consultant: ${email} (${name}) — role: ${role}`);
    } else {
      const id = randomUUID();
      await conn.execute(
        `INSERT INTO consultants (id, email, password_hash, name, role, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [id, email, passwordHash, name, role],
      );
      console.log(`Created consultant: ${email} (${name}) — role: ${role}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
