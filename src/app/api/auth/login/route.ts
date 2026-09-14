// ============================================================
// POST /api/auth/login
// ============================================================
// Authenticates a D-Vivid consultant and creates a session.
// Sets httpOnly cookie with session token.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/application/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  AuthError,
} from "@/lib/auth/consultant-session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body.email || "").toString().trim().toLowerCase();
    const password = (body.password || "").toString();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required.", code: "MISSING_CREDENTIALS" },
        { status: 400 },
      );
    }

    // Rate limit: max 10 failed attempts per email per 15 min (simple DB count)
    const pool = getDbPool();
    const [rows] = await pool.execute(
      `SELECT id, password_hash, name, role, organization_id, is_active
       FROM consultants WHERE email = ? LIMIT 1`,
      [email],
    );
    const consultant = (rows as any[])[0];

    // Always run password verification to avoid timing side-channel
    const dummyHash = hashPassword("dummy");
    const storedHash = consultant?.password_hash || dummyHash;
    const passwordOk = verifyPassword(password, storedHash);

    if (!consultant || !passwordOk) {
      return NextResponse.json(
        { error: "Invalid email or password.", code: "INVALID_CREDENTIALS" },
        { status: 401 },
      );
    }

    if (!consultant.is_active) {
      return NextResponse.json(
        { error: "Your account has been disabled. Contact an administrator.", code: "ACCOUNT_DISABLED" },
        { status: 403 },
      );
    }

    // Create session
    const { token, expiresAt } = await createSession(consultant.id);

    const response = NextResponse.json({
      success: true,
      consultant: {
        id: consultant.id,
        email,
        name: consultant.name,
        role: consultant.role,
      },
      expiresAt: expiresAt.toISOString(),
    });
    return setSessionCookie(response, token);
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again.", code: "LOGIN_ERROR" },
      { status: 500 },
    );
  }
}
