// ============================================================
// DATABASE CONNECTION POOL
// Phase SOP-AI-29
// ============================================================
// Isolated MySQL database: sop_ai_app
// Separate from existing D-Vivid production tables.
// ============================================================

import mysql from "mysql2/promise";

let _pool: mysql.Pool | null = null;

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function getDbConfig(): DbConfig {
  return {
    host: process.env.SOP_DB_HOST || "127.0.0.1",
    port: parseInt(process.env.SOP_DB_PORT || "3306", 10),
    user: process.env.SOP_DB_USER || "root",
    password: process.env.SOP_DB_PASSWORD || "",
    database: process.env.SOP_DB_NAME || "sop_ai_app",
  };
}

export function getDbPool(): mysql.Pool {
  if (!_pool) {
    const config = getDbConfig();
    _pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4",
    });
  }
  return _pool;
}

export async function testDbConnection(): Promise<boolean> {
  try {
    const pool = getDbPool();
    const [rows] = await pool.execute("SELECT 1 AS test");
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function closeDbPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
