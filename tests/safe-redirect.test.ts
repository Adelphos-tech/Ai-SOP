/* Post-login redirect must stay on this origin.
 * Run: npx tsx tests/safe-redirect.test.ts */
import assert from "node:assert/strict";
import { safeRedirectPath } from "../src/lib/auth/safe-redirect";

const ORIGIN = "https://portal.example";
let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}
const go = (raw: string | null) => safeRedirectPath(raw, ORIGIN);

check("missing or empty target → default", () => {
  assert.equal(go(null), "/students");
  assert.equal(go(""), "/students");
});
check("same-origin path keeps its query and hash", () => {
  assert.equal(go("/students/abc/applications/def?tab=docs#top"), "/students/abc/applications/def?tab=docs#top");
  assert.equal(go(`${ORIGIN}/students/abc`), "/students/abc");
});
check("other origins are refused", () => {
  for (const raw of [
    "//attacker.example",
    "//attacker.example/students",
    "/\\attacker.example",
    "\\\\attacker.example",
    "https://attacker.example/students",
    "/\t/attacker.example",
    "/.//attacker.example",
    "javascript:alert(1)",
  ]) assert.equal(go(raw), "/students", JSON.stringify(raw));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
