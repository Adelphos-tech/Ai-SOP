/**
 * Brick 9D — pricing-registry regression.
 *
 * Verified official Standard-tier rates (OpenAI pricing page, 2026-10-23):
 *   gpt-5.6-sol   4.00 / 0.40 / 20.00
 *   gpt-5.6-terra 2.00 / 0.20 / 12.00
 *   gpt-5.6-luna  0.20 / 0.02 /  1.20
 *   gpt-6.1-sol   2.00 / 0.10 / 10.00
 *   gpt-6-sol     2.00 / 0.20 / 10.00
 *   gpt-6-luna    0.10 / 0.01 /  0.50
 */
import assert from "node:assert/strict";
import {
  MODEL_PRICING,
  calculateStageCost,
  findUnpricedModels,
  getPricingForModel,
  hasPricingForModel,
} from "../src/lib/ai/pricing";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name} — ${(e as Error).message}`); }
}
const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

check("1: gpt-5.6-sol rates are the verified $4/$0.40/$20", () => {
  const p = getPricingForModel("gpt-5.6-sol");
  approx(p.inputPerMillion, 4.00); approx(p.cachedInputPerMillion, 0.40); approx(p.outputPerMillion, 20.00);
});

check("2: gpt-6.1-sol rates are the verified $2/$0.10/$10", () => {
  const p = getPricingForModel("gpt-6.1-sol");
  approx(p.inputPerMillion, 2.00); approx(p.cachedInputPerMillion, 0.10); approx(p.outputPerMillion, 10.00);
});

check("3: gpt-5.6-terra rates are the verified $2/$0.20/$12", () => {
  const p = getPricingForModel("gpt-5.6-terra");
  approx(p.inputPerMillion, 2.00); approx(p.cachedInputPerMillion, 0.20); approx(p.outputPerMillion, 12.00);
});

check("4: gpt-5.6-luna uses real Luna rates, not the Sol placeholder", () => {
  const p = getPricingForModel("gpt-5.6-luna");
  approx(p.inputPerMillion, 0.20); approx(p.cachedInputPerMillion, 0.02); approx(p.outputPerMillion, 1.20);
  assert.notEqual(p.outputPerMillion, getPricingForModel("gpt-5.6-sol").outputPerMillion);
});

check("5: gpt-6-sol and gpt-6-luna are priced at verified rates", () => {
  const s = getPricingForModel("gpt-6-sol");
  approx(s.inputPerMillion, 2.00); approx(s.cachedInputPerMillion, 0.20); approx(s.outputPerMillion, 10.00);
  const l = getPricingForModel("gpt-6-luna");
  approx(l.inputPerMillion, 0.10); approx(l.cachedInputPerMillion, 0.01); approx(l.outputPerMillion, 0.50);
});

check("6: cached input is billed at the discounted cached rate", () => {
  const c = calculateStageCost("gpt-5.6-sol", 10000, 4000, 1000);
  approx(c.inputCostUsd, 6000 * 4 / 1e6);
  approx(c.cachedInputCostUsd, 4000 * 0.40 / 1e6);
  approx(c.outputCostUsd, 1000 * 20 / 1e6);
  approx(c.totalCostUsd, 0.024 + 0.0016 + 0.02);
});

check("7: reasoning tokens are billed inside output tokens", () => {
  // outputTokens already includes reasoning — cost is outputTokens * rate.
  const c = calculateStageCost("gpt-5.6-sol", 5000, 0, 3000);
  approx(c.outputCostUsd, 3000 * 20 / 1e6);
});

check("8: Brick 9C 6.1-sol benchmark reprices to ~$0.145, not ~$0.29", () => {
  // Recorded stage usage for sol61x6: in=21166, cached=0, out=10226.
  const c = calculateStageCost("gpt-6.1-sol", 21166, 0, 10226);
  approx(c.totalCostUsd, 21166 * 2 / 1e6 + 10226 * 10 / 1e6);
  assert.ok(c.totalCostUsd > 0.14 && c.totalCostUsd < 0.15);
});

check("9: unknown models keep the Sol fallback but are flagged", () => {
  const p = getPricingForModel("gpt-unpriced-future");
  approx(p.inputPerMillion, 4.00); // historical Sol fallback preserved
  assert.equal(hasPricingForModel("gpt-unpriced-future"), false);
  assert.deepEqual(findUnpricedModels(["gpt-6.1-sol", "gpt-unpriced-future"]), ["gpt-unpriced-future"]);
});

check("10: historical Sol estimates unchanged for prior model names", () => {
  // A call recorded under Sol rates must still reprice identically.
  const c = calculateStageCost("gpt-5.6-sol", 42610, 0, 27073); // prod $0.7119 gen
  approx(c.totalCostUsd, 0.71190, 1e-4);
});

check("11: every registry entry is a complete finite ModelPricing", () => {
  for (const [m, p] of Object.entries(MODEL_PRICING)) {
    for (const k of ["inputPerMillion", "cachedInputPerMillion", "outputPerMillion"] as const)
      assert.ok(Number.isFinite(p[k]) && p[k] >= 0, `${m}.${k}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
