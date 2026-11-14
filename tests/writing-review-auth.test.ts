/* Brick 4A contract tests — Writing Review route authentication and
 * the RYNE_PAID_CALLS_ENABLED kill switch.
 *
 * Run with the mysql2 mock preload (no database, no network):
 *   NODE_OPTIONS="--import ./tests/writing-review-auth-preload.mjs" \
 *     npx tsx tests/writing-review-auth.test.ts
 *
 * Rows are injected through globalThis.__MOCK_DB (see
 * tests/mocks/mysql2-promise.mjs). Provider transport is always a
 * local spy — no real Ryne request is ever made. */
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/application/writing-review/route";
import { runDetection } from "../src/lib/writing-review/detection";
import { runRewrite } from "../src/lib/writing-review/rewrite";

let pass = 0, fail = 0;
function ok(name: string) { pass++; console.log(`PASS  ${name}`); }
function bad(name: string, e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

// ---------- fixtures ----------

const STUDENT_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_STUDENT_ID = "99999999-8888-7777-6666-555555555555";
const APP_ID = "app-1";
const DOC_ID = "doc-1";
const DOC_TEXT = "SENSITIVE-DOCUMENT-TEXT that must never leak to anonymous callers.";

const BASE_URL = "http://localhost/api/application/writing-review";
const qs = `documentId=${DOC_ID}&applicationId=${APP_ID}&studentId=${STUDENT_ID}`;

const CONSULTANT = {
  consultant_id: "cons-1",
  email: "agent@dvivid.test",
  name: "Agent",
  role: "CONSULTANT",
  organization_id: null,
  is_active: 1,
};

const now = Date.now();

function seedDb() {
  globalThis.__MOCK_DB = {
    sessionRows: {},
    documents: {
      [DOC_ID]: {
        id: DOC_ID, application_id: APP_ID, document_type: "SOP",
        document_title: "SOP Draft", generation_status: "GENERATED",
        review_status: "DRAFT", current_version_id: "ver-1",
        created_at: new Date(now), updated_at: new Date(now),
      },
    },
    applications: {
      [APP_ID]: {
        id: APP_ID, student_id: STUDENT_ID, university_name: "MIT",
        program_name: "MS", degree: "MS", country: "USA", intake: "Fall",
        intake_year: 2027, status: "ACTIVE",
        created_at: new Date(now), updated_at: new Date(now),
      },
    },
    versions: {
      [DOC_ID]: [{
        id: "ver-1", document_id: DOC_ID, version_number: 1,
        content: DOC_TEXT, content_format: "markdown",
        created_by_type: "GENERATED", created_at: new Date(now),
      }],
    },
  };
}

// Real session plumbing: the route hashes the cookie token with
// sha256 and looks up consultant_sessions JOIN consultants.
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function addSession(token: string, over: any = {}) {
  const row = {
    session_id: `sess-${token.slice(0, 8)}`,
    expires_at: new Date(now + 3600_000),
    ...CONSULTANT,
    ...over,
  };
  globalThis.__MOCK_DB.sessionRows[tokenHash(token)] = row;
}
const goodToken = "a".repeat(64);
const expiredToken = "b".repeat(64);
const inactiveToken = "c".repeat(64);

function req(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(`${BASE_URL}?${path}`, init);
}
function withCookie(init: RequestInit, token: string): RequestInit {
  return { ...init, headers: { ...(init.headers || {}), cookie: `dvivid_session=${token}` } };
}
const postInit = (body: any): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const neverFetch = () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(JSON.stringify({ content: "rewritten text", aiScore: 12 }), { status: 200 });
  }) as any;
  return { fetcher, calls: () => calls };
};

// ---------- tests ----------

async function main() {
  // Baseline: key present but kill switch OFF unless a test opts in.
  process.env.RYNE_API_KEY = "ryne_sk_test";
  delete process.env.RYNE_PAID_CALLS_ENABLED;
  seedDb();
  addSession(goodToken);
  addSession(expiredToken, { expires_at: new Date(now - 1000) });
  addSession(inactiveToken, { is_active: 0 });

  await check("GET without session cookie → 401, no document content", async () => {
    const res = await GET(req(qs));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(!JSON.stringify(body).includes(DOC_TEXT));
    assert.equal(body.currentVersion, undefined);
  });

  await check("POST without session cookie → 401 before any provider logic", async () => {
    const res = await POST(req(qs, postInit({ action: "recheck", detectors: ["REILAA"], confirmPaid: true })));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.detection, undefined);
    assert.ok(!JSON.stringify(body).includes(DOC_TEXT));
  });

  await check("GET malformed session token → 401", async () => {
    const res = await GET(req(qs, withCookie({}, "not-a-real-token")));
    assert.equal(res.status, 401);
  });

  await check("GET well-formed but unknown session token → 401", async () => {
    const res = await GET(req(qs, withCookie({}, "f".repeat(64))));
    assert.equal(res.status, 401);
  });

  await check("GET expired session → 401", async () => {
    const res = await GET(req(qs, withCookie({}, expiredToken)));
    assert.equal(res.status, 401);
  });

  await check("GET session for inactive consultant → 401", async () => {
    const res = await GET(req(qs, withCookie({}, inactiveToken)));
    assert.equal(res.status, 401);
  });

  await check("GET valid session, missing params → 400", async () => {
    const res = await GET(req(`documentId=${DOC_ID}`, withCookie({}, goodToken)));
    assert.equal(res.status, 400);
  });

  await check("GET valid session, non-UUID studentId → 400", async () => {
    const res = await GET(req(`documentId=${DOC_ID}&applicationId=${APP_ID}&studentId=not-a-uuid`, withCookie({}, goodToken)));
    assert.equal(res.status, 400);
  });

  await check("GET valid session, document belongs to another student → 403, no content", async () => {
    const res = await GET(req(`documentId=${DOC_ID}&applicationId=${APP_ID}&studentId=${OTHER_STUDENT_ID}`, withCookie({}, goodToken)));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(!JSON.stringify(body).includes(DOC_TEXT));
  });

  await check("GET valid session + valid ownership → 200 returns authorized content", async () => {
    const res = await GET(req(qs, withCookie({}, goodToken)));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.currentVersion.content, DOC_TEXT);
    assert.equal(body.detection, null); // honest: no check has run
  });

  await check("POST valid session, ownership mismatch → 403 before provider logic", async () => {
    const res = await POST(req(`documentId=${DOC_ID}&applicationId=${APP_ID}&studentId=${OTHER_STUDENT_ID}`,
      withCookie(postInit({ action: "recheck", detectors: ["REILAA"], confirmPaid: true }), goodToken)));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.detection, undefined);
  });

  await check("POST valid session + key configured + switch OFF → detection stays disabled (no call)", async () => {
    const res = await POST(req(qs, withCookie(postInit({
      action: "recheck", detectors: ["REILAA"], confirmPaid: true,
    }), goodToken)));
    assert.equal(res.status, 200); // existing NOT_CONFIGURED response shape
    const body = await res.json();
    assert.ok(/disabled/i.test(body.notice ?? ""));
    assert.equal(body.detection.scores.every((s: any) => s.status !== "SCORED"), true);
  });

  await check("kill switch OFF: runRewrite makes zero provider calls and reserves no spend", async () => {
    const spy = neverFetch();
    process.env.RYNE_DAILY_BUDGET_USD = "0.0006";
    const text = "A short passage to rewrite.";
    const out = await runRewrite({ text, mode: "balanced", confirmPaid: true, fetcher: spy.fetcher });
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(spy.calls(), 0);
    // The ~$0.0004 estimate fits the $0.0006 cap only if the blocked
    // run reserved nothing — a wrong reservation makes this OVER_BUDGET.
    process.env.RYNE_PAID_CALLS_ENABLED = "1";
    const on = await runRewrite({ text, mode: "balanced", confirmPaid: true, fetcher: spy.fetcher });
    assert.equal(on.kind, "OK");
    assert.equal(spy.calls(), 1);
  });

  await check("kill switch OFF: runDetection makes zero provider calls and reserves no spend", async () => {
    const spy = neverFetch();
    delete process.env.RYNE_PAID_CALLS_ENABLED;
    // Ledger is shared with rewrite calls ($0.0004 already spent);
    // a wrong ~$0.02 reservation here overflows the $0.03 cap.
    process.env.RYNE_DAILY_BUDGET_USD = "0.03";
    const out = await runDetection("d-kill-off", {
      detectors: ["REILAA"], confirmPaid: true, baseVersionId: "v1",
      content: "Some document text.", fetcher: spy.fetcher,
    });
    assert.equal(out.kind, "NOT_CONFIGURED");
    assert.equal(spy.calls(), 0);
    process.env.RYNE_PAID_CALLS_ENABLED = "1";
    const on = await runDetection("d-kill-on", {
      detectors: ["REILAA"], confirmPaid: true, baseVersionId: "v1",
      content: "Some document text.", fetcher: spy.fetcher,
    });
    assert.equal(on.kind, "OK");
    assert.equal(spy.calls(), 1);
    delete process.env.RYNE_DAILY_BUDGET_USD;
  });

  await check("configured RYNE_API_KEY does not bypass the kill switch", async () => {
    delete process.env.RYNE_PAID_CALLS_ENABLED;
    assert.ok(process.env.RYNE_API_KEY);
    const spy = neverFetch();
    const det = await runDetection("d-key-noswitch", {
      detectors: ["REILAA"], confirmPaid: true, baseVersionId: "v1",
      content: "text", fetcher: spy.fetcher,
    });
    const rew = await runRewrite({ text: "t", mode: "balanced", confirmPaid: true, fetcher: spy.fetcher });
    assert.equal(det.kind, "NOT_CONFIGURED");
    assert.equal(rew.kind, "NOT_CONFIGURED");
    assert.equal(spy.calls(), 0);
    delete process.env.RYNE_PAID_CALLS_ENABLED;
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
