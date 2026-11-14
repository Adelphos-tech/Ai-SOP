/* Brick 2 contract tests — runDetection with a MOCKED transport.
 * No network, no paid calls, no credentials logged. */
import assert from "node:assert/strict";
import { runDetection, runnableTools, estimatedCostUsd, RYNE_MAX_CHARS } from "../src/lib/writing-review/detection";

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`PASS  ${name}`); })
    .catch(e => { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); })
    .finally(() => { if (name === LAST) console.log(`\n${pass} passed, ${fail} failed`); });
}
let LAST = "";

const DOC = "One clear sentence. Another clear sentence. A third sentence here.";

function mockFetch(map: Record<string, any>): typeof fetch {
  return (async (url: any, init: any) => {
    const tool = init?.headers?.tool ?? "reilaa";
    const spec = map[tool] ?? { status: 200, body: { source: tool, aiScore: 33, classification: "MIXED", details: { sentences: [] } } };
    if (spec.hang) return new Promise(() => {}) as any; // never resolves
    if (spec.throw) throw spec.throw;
    return new Response(JSON.stringify(spec.body), { status: spec.status ?? 200 }) as any;
  }) as any;
}

const baseOpts = (over: any = {}) => ({
  detectors: ["REILAA"], confirmPaid: true, baseVersionId: "v1",
  content: DOC, fetcher: mockFetch({}), now: () => Date.now(),
  ...over,
});

async function main() {
  process.env.RYNE_API_KEY = "ryne_sk_test";
  // Brick 4A: kill switch must be ON for mocked paid-path tests —
  // transport is still a stub, so no real call is ever made.
  process.env.RYNE_PAID_CALLS_ENABLED = "1";

  assert.ok(runnableTools().includes("reilaa"));
  assert.equal(runnableTools().length, 6);

  {
    const out = await runDetection("d-consent", baseOpts({ confirmPaid: false }));
    assert.equal(out.kind, "CONSENT_REQUIRED");
    assert.equal(out.kind === "CONSENT_REQUIRED" ? out.detection.scores.every(s => s.status !== "SCORED") : false, true);
    console.log("PASS  consent required before sending text");
    pass++;
  }

  {
    const out = await runDetection("d-budget", baseOpts({
      detectors: ["REILAA", "GPTZERO", "ZEROGPT", "QUILLBOT"],
    }));
    assert.equal(out.kind, "OVER_BUDGET"); // default budget 3
    console.log("PASS  detector budget enforced");
    pass++;
  }

  {
    const out = await runDetection("d-ok", baseOpts({
      detectors: ["REILAA", "GPTZERO"],
      fetcher: mockFetch({
        reilaa: { body: { source: "reilaa", aiScore: 15.3, classification: "HUMAN_ONLY", details: { scoreType: "uncalibrated_model_signal", granularity: "document", sentences: [] } } },
        gptzero: { body: { source: "zerogpt", aiScore: 44, classification: "MIXED", fallback: { from: "gptzero", to: "zerogpt" } } },
      }),
    }));
    assert.equal(out.kind, "OK");
    if (out.kind === "OK") {
      const reilaa = out.detection.scores.find(s => s.detector === "REILAA")!;
      assert.equal(reilaa.status, "SCORED");
      assert.equal(reilaa.scoreMeaning, "RAW_MODEL_SIGNAL_PERCENT");
      assert.equal(reilaa.granularity, "DOCUMENT");
      const gz = out.detection.scores.find(s => s.detector === "GPTZERO")!;
      assert.equal(gz.source, "zerogpt");
      assert.equal(gz.scoreMeaning, "AI_PROBABILITY_PERCENT"); // producer semantics
      assert.equal(gz.fallback?.to, "zerogpt");
      assert.equal(out.detection.baseVersionId, "v1");
      assert.ok(out.detection.contentHash.length > 0);
    }
    console.log("PASS  genuine responses mapped with correct semantics + fallback attribution");
    pass++;
  }

  {
    const out = await runDetection("d-partial", baseOpts({
      detectors: ["REILAA", "ZEROGPT"],
      fetcher: mockFetch({
        reilaa: { status: 500, body: { error: true, error_msg: "provider down" } },
        zerogpt: { body: { source: "zerogpt", aiScore: 61, classification: "AI_ONLY", details: { sentences: [{ text: "One clear sentence.", score: 88 }] } } },
      }),
    }));
    assert.equal(out.kind, "OK");
    if (out.kind === "OK") {
      const r = out.detection.scores.find(s => s.detector === "REILAA")!;
      const z = out.detection.scores.find(s => s.detector === "ZEROGPT")!;
      assert.equal(r.status, "ERROR");
      assert.equal(z.status, "SCORED");
      assert.equal(z.scorePercent, 61);
      assert.equal(out.detection.passages.length, 1);
      assert.equal(out.detection.passages[0].text, "One clear sentence.");
    }
    console.log("PASS  partial failure isolates per-detector results + real sentence findings");
    pass++;
  }

  {
    const out = await runDetection("d-timeout", baseOpts({
      detectors: ["REILAA"],
      fetcher: mockFetch({ reilaa: { throw: Object.assign(new Error("aborted"), { name: "AbortError" }) } }),
    }));
    assert.equal(out.kind, "OK");
    if (out.kind === "OK") {
      const r = out.detection.scores.find(s => s.detector === "REILAA")!;
      assert.equal(r.status, "ERROR");
      assert.equal(r.error?.code, "TIMEOUT");
    }
    console.log("PASS  timeout maps to retryable error, not a score");
    pass++;
  }

  {
    const first = await runDetection("d-rate", baseOpts());
    assert.equal(first.kind, "OK");
    const second = await runDetection("d-rate", baseOpts());
    assert.equal(second.kind, "RATE_LIMITED");
    console.log("PASS  per-document cooldown rate limit");
    pass++;
  }

  {
    const out = await runDetection("d-long", baseOpts({ content: "x".repeat(RYNE_MAX_CHARS + 1) }));
    assert.equal(out.kind, "TOO_LONG");
    console.log("PASS  40k char limit enforced");
    pass++;
  }

  {
    const out = await runDetection("d-cache", baseOpts({ detectors: ["REILAA"] }));
    assert.equal(out.kind, "OK");
    const again = await runDetection("d-cache2", baseOpts({ detectors: ["REILAA"], now: () => Date.now() - 99_999 }));
    // different doc key → no cooldown → OK
    assert.equal(again.kind, "OK");
    console.log("PASS  repeated identical check allowed per document key (fresh doc)");
    pass++;
  }

  {
    // no key → honest setup state
    delete process.env.RYNE_API_KEY;
    const out = await runDetection("d-nokey", baseOpts());
    assert.equal(out.kind, "NOT_CONFIGURED");
    console.log("PASS  missing key yields setup state, no misleading scan");
    pass++;
    process.env.RYNE_API_KEY = "ryne_sk_test";
  }

  {
    const ac = new AbortController(); ac.abort();
    const out = await runDetection("d-cancel", baseOpts({ signal: ac.signal }));
    assert.equal(out.kind, "CANCELLED");
    console.log("PASS  caller cancellation honored");
    pass++;
  }

  {
    // key must never appear in any response payload
    let captured = "";
    const spyFetch: typeof fetch = (async (url: any, init: any) => {
      captured += JSON.stringify(init?.body);
      return new Response(JSON.stringify({ source: "reilaa", aiScore: 10, classification: "HUMAN_ONLY" }), { status: 200 });
    }) as any;
    const out = await runDetection("d-leak", baseOpts({ fetcher: spyFetch }));
    assert.equal(out.kind, "OK");
    const serialized = JSON.stringify(out);
    assert.ok(!serialized.includes("ryne_sk_test"), "key leaked into response");
    assert.ok(captured.includes("ryne_sk_test"), "key not sent in request body");
    console.log("PASS  credential sent server-side only, never in response");
    pass++;
  }

  {
    const out = await runDetection("d-unknown", baseOpts({ detectors: ["TURNITIN", "NOT_A_DETECTOR"] }));
    assert.equal(out.kind, "CONSENT_REQUIRED"); // no runnable detector selected
    console.log("PASS  unsupported detectors cannot be billed");
    pass++;
  }

  {
    // concurrent identical submissions share one paid run
    let calls = 0;
    const counting: typeof fetch = (async (u: any, init: any) => {
      calls++;
      await new Promise(r => setTimeout(r, 30));
      return new Response(JSON.stringify({ source: init?.headers?.tool ?? "reilaa", aiScore: 20, classification: "MIXED" }), { status: 200 });
    }) as any;
    const [a, b] = await Promise.all([
      runDetection("d-concur", baseOpts({ detectors: ["REILAA"], fetcher: counting })),
      runDetection("d-concur", baseOpts({ detectors: ["REILAA"], fetcher: counting })),
    ]);
    assert.equal(a.kind, "OK");
    assert.ok(calls <= 1, `duplicate paid calls: ${calls}`);
    console.log("PASS  concurrent identical requests deduplicate — no duplicate billing");
    pass++;
  }

  {
    // daily spend cap blocks further paid calls
    process.env.RYNE_DAILY_BUDGET_USD = "0.03";
    const out = await runDetection("d-daily", baseOpts({ detectors: ["REILAA"], now: () => Date.now() }));
    assert.equal(out.kind, "OVER_BUDGET");
    delete process.env.RYNE_DAILY_BUDGET_USD;
    console.log("PASS  daily spend cap blocks paid calls");
    pass++;
  }

  {
    // changed content → different contentHash → cache cannot return stale findings
    const out1 = await runDetection("d-ver", baseOpts({ content: "Version one text." }));
    const out2 = await runDetection("d-ver", baseOpts({ content: "Version two is different.", now: () => Date.now() + 60_000 }));
    assert.equal(out1.kind, "OK");
    assert.equal(out2.kind, "OK");
    if (out1.kind === "OK" && out2.kind === "OK")
      assert.notEqual(out1.detection.contentHash, out2.detection.contentHash);
    console.log("PASS  version/content change produces distinct analysis identity");
    pass++;
  }

  {
    // provider error echoing the key gets redacted
    const out = await runDetection("d-redact", baseOpts({
      fetcher: mockFetch({ reilaa: { status: 500, body: { error: true, error_msg: "bad key ryne_sk_test supplied" } } }),
      now: () => Date.now(),
    }));
    assert.equal(out.kind, "OK");
    assert.ok(!JSON.stringify(out).includes("ryne_sk_test"), "key leaked via provider error message");
    console.log("PASS  provider error messages never echo the API key");
    pass++;
  }

  {
    // unknown detector ids can't sneak paid calls
    const out = await runDetection("d-mixed", baseOpts({
      detectors: ["REILAA", "TURNITIN"],
      now: () => Date.now(),
    }));
    assert.equal(out.kind, "OK");
    if (out.kind === "OK") {
      const t = out.detection.scores.find(s => s.detector === "TURNITIN")!;
      assert.equal(t.status, "UNAVAILABLE");
    }
    console.log("PASS  unsupported detectors never called, keep registry state");
    pass++;
  }

  assert.ok(estimatedCostUsd(3) > 0);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
