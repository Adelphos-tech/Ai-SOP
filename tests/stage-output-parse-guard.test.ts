/**
 * stage-output-parse-guard.test.ts — controlled-failure guarantees for
 * stage output parsing. Deterministic, no provider calls.
 *
 * Historical failure classes:
 *  - CONTENT_JSON_INVALID (prose/fence-wrapped or truncated model JSON)
 *  - qualityReviewer invalid_enum_value (model emits out-of-vocabulary enum)
 *  - valid content must still pass
 */
import assert from "node:assert/strict";
import { parseStage } from "../src/lib/ai/pipeline/stage-execution";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function throwsCode(code: string, fn: () => void) {
  try { fn(); }
  catch (e: any) { assert.equal(e.code, code); return; }
  assert.fail(`expected StageExecutionError ${code}`);
}

const VALID_QR = JSON.stringify({
  componentScores: [{
    componentId: "A", score: 8,
    topicCoverage: [], factualRiskClaims: [],
    wordCompliance: "PASS", characterCompliance: "PASS",
  }],
  overall_score: 8,
  requirementCompliance: { requiredTopics: "PASS" },
});

/* ---- valid structured content succeeds ---- */
check("qualityReviewer valid JSON passes", () => {
  const out = parseStage("qualityReviewer", VALID_QR);
  assert.equal(out.componentScores[0].wordCompliance, "PASS");
});

/* ---- enum vocabulary: PASS/FAIL/N/A accepted ---- */
check("all COMPLIANCE_STATUSES values accepted", () => {
  for (const v of ["PASS", "FAIL", "N/A"]) {
    const body = JSON.parse(VALID_QR);
    body.componentScores[0].wordCompliance = v;
    const out = parseStage("qualityReviewer", JSON.stringify(body));
    assert.equal(out.componentScores[0].wordCompliance, v);
  }
});

/* ---- invalid enum → controlled typed failure (historical gemini bug) ---- */
check("invalid wordCompliance enum → AI_STAGE_SCHEMA_INVALID", () => {
  const body = JSON.parse(VALID_QR);
  body.componentScores[0].wordCompliance = "PARTIAL"; // gemini deviation class
  throwsCode("AI_STAGE_SCHEMA_INVALID", () => parseStage("qualityReviewer", JSON.stringify(body)));
});

/* ---- CONTENT_JSON_INVALID classes ---- */
check("empty content → EMPTY_CONTENT", () => {
  throwsCode("EMPTY_CONTENT", () => parseStage("writer", "   "));
});

check("truncated mid-JSON → CONTENT_JSON_INVALID", () => {
  // historical Visa SOP writer failure shape: valid start, no close
  const truncated = '{\n  "responses": [\n    {\n      "componentId": "RC-DOC",\n      "title": "Visa SOP';
  throwsCode("CONTENT_JSON_INVALID", () => parseStage("writer", truncated));
});

check("pure prose → CONTENT_JSON_INVALID", () => {
  throwsCode("CONTENT_JSON_INVALID", () => parseStage("writer", "I cannot help with that request."));
});

check("non-object JSON (array) → CONTENT_SCHEMA_INVALID", () => {
  throwsCode("CONTENT_SCHEMA_INVALID", () => parseStage("writer", '["a","b"]'));
});

/* ---- prose/fence-wrapped JSON is recovered by brace extraction ---- */
check("prose-wrapped JSON → extracted and parsed", () => {
  const wrapped = `Here is the quality review you asked for:\n\n${VALID_QR}\n\nLet me know if you need changes.`;
  const out = parseStage("qualityReviewer", wrapped);
  assert.equal(out.componentScores[0].componentId, "A");
});

check("fence-wrapped JSON → extracted and parsed", () => {
  const fenced = "```json\n" + VALID_QR + "\n```";
  const out = parseStage("qualityReviewer", fenced);
  assert.equal(out.overall_score, 8);
});

/* ---- wrong schema on valid JSON → typed failure, not crash ---- */
check("valid JSON, wrong schema → AI_STAGE_SCHEMA_INVALID", () => {
  throwsCode("AI_STAGE_SCHEMA_INVALID", () => parseStage("writer", VALID_QR));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
