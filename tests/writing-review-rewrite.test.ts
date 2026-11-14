/* Brick 3 contract tests — runRewrite with a MOCKED transport.
 * No network, no paid calls, no credentials logged. */
import assert from "node:assert/strict";
import { runRewrite, rewriteCostUsd } from "../src/lib/writing-review/rewrite";

let pass = 0, fail = 0;
function ok(name: string) { pass++; console.log(`PASS  ${name}`); }

const SENT = "This sentence was clearly written by an AI model.";

function mockFetch(bodyOrSpec: any): typeof fetch {
  return (async (_u: any, _i: any) => {
    if (bodyOrSpec.throw) throw bodyOrSpec.throw;
    if (bodyOrSpec.hang) return new Promise(() => {}) as any;
    return new Response(JSON.stringify(bodyOrSpec.body ?? bodyOrSpec), { status: bodyOrSpec.status ?? 200 }) as any;
  }) as any;
}

const base = (over: any = {}) => ({
  text: SENT, mode: "balanced" as const, confirmPaid: true,
  fetcher: mockFetch({ content: "The sentence reads as written by a person.", aiScore: 3.8 }),
  ...over,
});

async function main() {
  process.env.RYNE_API_KEY = "ryne_sk_test";
  // Brick 4A: kill switch must be ON for mocked paid-path tests —
  // transport is still a stub, so no real call is ever made.
  process.env.RYNE_PAID_CALLS_ENABLED = "1";

  {
    const out = await runRewrite(base({ confirmPaid: false }));
    assert.equal(out.kind, "CONSENT_REQUIRED");
    ok("consent required before passage text leaves the server");
  }
  {
    let sent: any = null;
    const spy: typeof fetch = (async (_u: any, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: "rewritten" }), { status: 200 });
    }) as any;
    const out = await runRewrite(base({ mode: "titan", fetcher: spy }));
    assert.equal(out.kind, "OK");
    assert.equal(sent.humanizerMode, "titan");
    assert.equal(sent.text, SENT);
    assert.equal(sent.user_id, "ryne_sk_test");
    assert.equal(sent.shouldStream, false);
    ok("titan mode: only selected text + key in body, non-streaming");
  }
  {
    let sent: any = null;
    const spy: typeof fetch = (async (_u: any, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: "rewritten", aiScore: 7.1 }), { status: 200 });
    }) as any;
    const out = await runRewrite(base({ mode: "balanced", fetcher: spy }));
    assert.equal(out.kind, "OK");
    assert.equal(sent.humanizerMode, "balanced");
    if (out.kind === "OK") {
      assert.equal(out.suggestion.aiScore, 7.1);
      assert.equal(out.suggestion.mode, "balanced");
    }
    ok("balanced mode + beast-mode aiScore passthrough");
  }
  {
    const out = await runRewrite(base({ fetcher: mockFetch({ status: 500, body: { error_msg: "provider down" } }) }));
    assert.equal(out.kind, "ERROR");
    if (out.kind === "ERROR") assert.equal(out.retryable, true);
    ok("provider 500 maps to retryable ERROR");
  }
  {
    const out = await runRewrite(base({ fetcher: mockFetch({ throw: Object.assign(new Error("aborted"), { name: "AbortError" }) }) }));
    assert.equal(out.kind, "ERROR");
    ok("timeout maps to error, never a fabricated rewrite");
  }
  {
    const out = await runRewrite(base({ fetcher: mockFetch({}) }));
    assert.equal(out.kind, "ERROR"); // no content field
    ok("empty provider response is an error, not a rewrite");
  }
  {
    let calls = 0;
    const counting: typeof fetch = (async (_u: any, init: any) => {
      calls++;
      await new Promise(r => setTimeout(r, 30));
      return new Response(JSON.stringify({ content: "x" }), { status: 200 });
    }) as any;
    const [a, b] = await Promise.all([
      runRewrite(base({ fetcher: counting })),
      runRewrite(base({ fetcher: counting })),
    ]);
    assert.equal(a.kind, "OK");
    assert.ok(calls <= 1, `duplicate paid calls: ${calls}`);
    ok("concurrent identical rewrites deduplicate — no duplicate billing");
  }
  {
    const out = await runRewrite(base({ text: "x".repeat(20_001) }));
    assert.equal(out.kind, "TOO_LONG");
    ok("passage length cap enforced");
  }
  {
    process.env.RYNE_DAILY_BUDGET_USD = "0.0001";
    const out = await runRewrite(base({}));
    assert.equal(out.kind, "OVER_BUDGET");
    delete process.env.RYNE_DAILY_BUDGET_USD;
    ok("shared daily spend cap blocks paid rewrites");
  }
  {
    const out = await runRewrite(base({
      fetcher: mockFetch({ status: 403, body: { error_msg: "bad key ryne_sk_test supplied" } }),
    }));
    assert.equal(out.kind, "ERROR");
    assert.ok(!JSON.stringify(out).includes("ryne_sk_test"), "key leaked");
    ok("provider errors never echo the API key");
  }
  {
    delete process.env.RYNE_API_KEY;
    const out = await runRewrite(base({}));
    assert.equal(out.kind, "NOT_CONFIGURED");
    process.env.RYNE_API_KEY = "ryne_sk_test";
    ok("missing key yields setup state, no misleading call");
  }
  {
    // documented pricing sanity: 10K words
    const text = "w ".repeat(10_000);
    assert.ok(Math.abs(rewriteCostUsd(text, "balanced") - 0.80) < 1e-9);
    assert.ok(Math.abs(rewriteCostUsd(text, "titan") - 5.00) < 1e-9);
    ok("cost estimates match documented pricing ($0.08/$0.50 per 1K words)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
