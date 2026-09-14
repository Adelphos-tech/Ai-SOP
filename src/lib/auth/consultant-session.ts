// ============================================================
// CONSULTANT AUTHENTICATION
// ============================================================
// Session-based authentication for D-Vivid consultants.
// - Passwords hashed with scrypt (Node built-in, no extra deps)
// - Session tokens are 32-byte random values, stored hashed in DB
// - Token delivered via httpOnly, Secure, SameSite=Lax cookie
// - Sessions expire and are cleaned up
//
// Helpers:
//   requireConsultantSession(request)  → Consultant (throws AuthError)
//   getConsultantSession(request)     → { consultant, sessionId } | null
//   authorizeStudentAccess(session, studentId) → void (throws AuthError)
//
// Organization/branch ownership can be added later in
// authorizeStudentAccess without changing every API route.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";
import { getDbPool } from "@/lib/application/db";

// ============================================================
// TYPES
// ============================================================

export interface Consultant {
  id: string;
  email: string;
  name: string;
  role: string; // CONSULTANT | ADMIN
  organizationId: string | null;
  isActive: boolean;
}

export interface ConsultantSession {
  consultant: Consultant;
  sessionId: string;
  expiresAt: Date;
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ============================================================
// CONFIG
// ============================================================

const SESSION_COOKIE = "dvivid_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALTLEN = 16;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// ============================================================
// PASSWORD HASHING (scrypt)
// ============================================================

/**
 * Hash a password using scrypt. Returns "scrypt:N:r:p:saltHex:hashHex".
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALTLEN);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Verify a password against a stored scrypt hash.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], "hex");
  const expectedHash = Buffer.from(parts[5], "hex");
  try {
    const hash = scryptSync(password, salt, expectedHash.length, { N, r, p });
    return hash.length === expectedHash.length && timingSafeEqual(hash, expectedHash);
  } catch {
    return false;
  }
}

// ============================================================
// SESSION TOKEN
// ============================================================

/**
 * Generate a random 32-byte session token (hex encoded, 64 chars).
 */
function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a session token with SHA-256 for DB storage.
 * (Don't store the raw token — if DB leaks, tokens are useless.)
 */
function hashToken(token: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ============================================================
// COOKIE HELPERS
// ============================================================

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function getTokenFromRequest(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length !== 64) return null;
  return token;
}

// ============================================================
// DB ROW → CONSULTANT
// ============================================================

function rowToConsultant(row: any): Consultant {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: row.organization_id || null,
    isActive: !!row.is_active,
  };
}

// ============================================================
// SESSION CREATION / VERIFICATION
// ============================================================

/**
 * Create a new session for a consultant.
 * Stores the hashed token in the DB and returns the raw token (for cookie).
 */
export async function createSession(consultantId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const pool = getDbPool();
  await pool.execute(
    `INSERT INTO consultant_sessions (id, consultant_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, consultantId, tokenHash, expiresAt],
  );

  return { token, expiresAt };
}

/**
 * Verify a session token from a request cookie.
 * Returns the consultant + session info, or null if invalid/expired.
 */
export async function getConsultantSession(request: NextRequest): Promise<ConsultantSession | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const pool = getDbPool();

  const [rows] = await pool.execute(
    `SELECT s.id AS session_id, s.expires_at, s.consultant_id,
            c.email, c.name, c.role, c.organization_id, c.is_active
     FROM consultant_sessions s
     JOIN consultants c ON c.id = s.consultant_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash],
  );

  const row = (rows as any[])[0];
  if (!row) return null;

  // Check expiry
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() < Date.now()) {
    // Clean up expired session
    await pool.execute("DELETE FROM consultant_sessions WHERE id = ?", [row.session_id]);
    return null;
  }

  // Check consultant is still active
  if (!row.is_active) return null;

  const consultant: Consultant = {
    id: row.consultant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: row.organization_id || null,
    isActive: !!row.is_active,
  };

  return { consultant, sessionId: row.session_id, expiresAt };
}

/**
 * Require a valid consultant session. Throws AuthError(401) if not authenticated.
 * Use in API routes:
 *   const consultant = await requireConsultantSession(request);
 *
 * NOTE: Login is NOT required for now. This function returns a dummy consultant
 * so all endpoints work without authentication. To enable login enforcement,
 * remove the bypass block below and uncomment the real session check.
 */
export async function requireConsultantSession(request: NextRequest): Promise<Consultant> {
  // ===== LOGIN NOT REQUIRED — temporary bypass =====
  // To enable auth: delete this block and uncomment the code below.
  return {
    id: "system",
    email: "system@dvivid.local",
    name: "System",
    role: "ADMIN",
    organizationId: null,
    isActive: true,
  };
  // ===== END bypass =====

  // const session = await getConsultantSession(request);
  // if (!session) {
  //   throw new AuthError(401, "UNAUTHENTICATED", "Authentication required. Please log in.");
  // }
  // return session.consultant;
}

/**
 * Destroy a session (logout). Removes from DB.
 */
export async function destroySession(request: NextRequest): Promise<void> {
  const token = getTokenFromRequest(request);
  if (!token) return;
  const tokenHash = hashToken(token);
  const pool = getDbPool();
  await pool.execute("DELETE FROM consultant_sessions WHERE token_hash = ?", [tokenHash]);
}

/**
 * Clean up expired sessions (call periodically).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const pool = getDbPool();
  const [result] = await pool.execute(
    "DELETE FROM consultant_sessions WHERE expires_at < NOW()",
  );
  return (result as any).affectedRows || 0;
}

// ============================================================
// AUTHORIZATION
// ============================================================

/**
 * Authorize a consultant's access to a specific student.
 *
 * Current policy (single-organization portal):
 *   Any authenticated D-Vivid consultant may access any D-Vivid student.
 *
 * Future (multi-org/branch):
 *   Check that student.organization_id === consultant.organization_id
 *   or that the consultant has a branch assignment covering the student.
 *   This is the ONLY place that needs to change.
 *
 * Throws AuthError(403) if not authorized.
 */
export async function authorizeStudentAccess(
  consultant: Consultant,
  studentId: string,
): Promise<void> {
  // Validate studentId format (UUID) to prevent injection
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(studentId)) {
    throw new AuthError(400, "INVALID_STUDENT_ID", "Invalid student ID format.");
  }

  // Single-org: any active consultant can access any student.
  // When org/branch ownership is added, query the student's org here
  // and compare to consultant.organizationId.
  if (!consultant.isActive) {
    throw new AuthError(403, "ACCOUNT_DISABLED", "Your account has been disabled.");
  }
}

/**
 * Convenience: require session + authorize student access in one call.
 * Returns the consultant.
 *
 *   const consultant = await requireConsultantForStudent(request, studentId);
 */
export async function requireConsultantForStudent(
  request: NextRequest,
  studentId: string,
): Promise<Consultant> {
  const consultant = await requireConsultantSession(request);
  await authorizeStudentAccess(consultant, studentId);
  return consultant;
}

// ============================================================
// ERROR → RESPONSE HELPER
// ============================================================

/**
 * Convert an AuthError to a NextResponse. For use in API routes:
 *
 *   try {
 *     const consultant = await requireConsultantSession(request);
 *   } catch (e) {
 *     if (e instanceof AuthError) return authErrorResponse(e);
 *     throw e;
 *   }
 */
export function authErrorResponse(error: AuthError): NextResponse {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}
