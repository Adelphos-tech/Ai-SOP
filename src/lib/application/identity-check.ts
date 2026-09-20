// ============================================================
// CV ↔ STUDENT IDENTITY CHECK
// ============================================================
// Prevents a CV belonging to a different person from silently
// becoming the selected student's canonical profile.
//
// Identity anchor = the students ROW (first_name/last_name/email),
// never profile_data.personalData — which may itself have been
// corrupted by a previous wrong-person CV apply.
//
// Only explicit evidence is compared: name + email.
// Phone, address, nationality, university, employer are NEVER used
// for ownership decisions.
// ============================================================

export type IdentityMatchStatus =
  | "MATCH"
  | "PARTIAL_MATCH"
  | "INSUFFICIENT_IDENTITY"
  | "CONFLICT";

export interface IdentityRef {
  name: string;
  email: string;
}

export interface IdentityCheckResult {
  status: IdentityMatchStatus;
  studentIdentity: IdentityRef;
  cvIdentity: IdentityRef;
  /** Human-readable reason, safe to show in consultant UI */
  reason: string;
}

function norm(s: unknown): string {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normName(s: unknown): string {
  return norm(s);
}

function normEmail(s: unknown): string {
  return norm(s);
}

/**
 * Compare a student record's identity against parsed-CV personalData.
 *
 *   stuEmail && cvEmail equal              → MATCH
 *   stuEmail && cvEmail differ             → CONFLICT (email is strong evidence)
 *   emails not both present:
 *     both names present & equal          → MATCH (email absent) / PARTIAL_MATCH
 *     both names present & differ         → CONFLICT
 *     name missing on either side         → INSUFFICIENT_IDENTITY
 */
export function classifyIdentityMatch(
  student: { firstName?: string; lastName?: string; email?: string },
  cvPersonalData: { firstName?: string; lastName?: string; fullName?: string; email?: string } | undefined,
): IdentityCheckResult {
  const stuName = normName(`${student.firstName ?? ""} ${student.lastName ?? ""}`);
  const stuEmail = normEmail(student.email);

  const cv = cvPersonalData || {};
  const cvName = normName(
    cv.fullName || `${cv.firstName ?? ""} ${cv.lastName ?? ""}`,
  );
  const cvEmail = normEmail(cv.email);

  const studentIdentity: IdentityRef = { name: stuName, email: stuEmail };
  const cvIdentity: IdentityRef = { name: cvName, email: cvEmail };

  // Email: the strongest ownership signal
  if (stuEmail && cvEmail) {
    if (stuEmail === cvEmail) {
      return { status: "MATCH", studentIdentity, cvIdentity, reason: "Email matches." };
    }
    return {
      status: "CONFLICT",
      studentIdentity,
      cvIdentity,
      reason: "The CV's email address belongs to a different person.",
    };
  }

  // No decisive email — fall back to name comparison.
  // Token-containment handles middle names / initials:
  //   "kunj modh" ⊆ "kunj manojkumar modh"   → same person
  //   "shivang patel" vs "shivang singh"     → different surname → CONFLICT
  if (cvName && stuName) {
    const stuTokens = new Set(stuName.split(" ").filter(Boolean));
    const cvTokens = new Set(cvName.split(" ").filter(Boolean));
    const contained =
      cvName === stuName ||
      (cvTokens.size > 0 && Array.from(cvTokens).every(t => stuTokens.has(t))) ||
      (stuTokens.size > 0 && Array.from(stuTokens).every(t => cvTokens.has(t)));
    if (contained) {
      return {
        status: cvEmail || stuEmail ? "PARTIAL_MATCH" : "MATCH",
        studentIdentity,
        cvIdentity,
        reason: "Name matches; email not available on both sides.",
      };
    }
    return {
      status: "CONFLICT",
      studentIdentity,
      cvIdentity,
      reason: "The CV's name does not match the selected student.",
    };
  }

  // Not enough identity evidence to call it a different person
  return {
    status: "INSUFFICIENT_IDENTITY",
    studentIdentity,
    cvIdentity,
    reason: "The CV does not contain enough identity information to verify ownership.",
  };
}
