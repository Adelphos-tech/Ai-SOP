// ============================================================
// GET /api/application/universities
// ============================================================
// Canonical university list for the searchable selector.
// "General" is always first (canonical representation), followed by
// every university already known to the application — from existing
// applications and the requirements institutions knowledge base.
// No hardcoded list; deduplicated case-insensitively.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/application/db";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

const GENERAL_UNIVERSITY = "General";

export async function GET(req: NextRequest) {
  try {
    try {
      await requireConsultantSession(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e);
      throw e;
    }

    const pool = getDbPool();
    const seen = new Set<string>();
    const universities: string[] = [GENERAL_UNIVERSITY];
    seen.add("general");

    // Universities already used by applications (canonical store).
    const [appRows] = await pool.execute(
      `SELECT DISTINCT TRIM(university_name) AS name
         FROM applications
        WHERE university_name IS NOT NULL AND TRIM(university_name) != ''
        ORDER BY name`,
    );
    for (const row of appRows as any[]) {
      const name = String(row.name).trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        universities.push(name);
      }
    }

    // Institutions knowledge base (requirements/discovery source).
    try {
      const [instRows] = await pool.execute(
        `SELECT canonical_name FROM institutions WHERE status = 'ACTIVE' ORDER BY canonical_name`,
      );
      for (const row of instRows as any[]) {
        const name = String(row.canonical_name).trim();
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          universities.push(name);
        }
      }
    } catch {
      // institutions table may not exist in every environment — skip.
    }

    return NextResponse.json({ universities });
  } catch (error: any) {
    console.error("universities list error:", error);
    return NextResponse.json({ error: "Failed to load universities" }, { status: 500 });
  }
}
