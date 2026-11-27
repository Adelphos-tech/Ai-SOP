/* Inline selection rewrite — validation, prompt context wiring, output
 * cleaning and failure behaviour. Mocked transport; no network, no paid
 * calls, no DB access.
 *
 * Run: npx tsx tests/inline-rewrite.test.ts */
import assert from "node:assert/strict";
import {
  buildInlineRewriteContext,
  buildInlineRewriteMessages,
  cleanRewrittenText,
  inlineRewrite,
  INLINE_REWRITE_MODEL,
  InlineRewriteInputError,
  SELECTION_MAX_CHARS,
  validateInlineRewriteInput,
} from "../src/lib/application/inline-rewrite";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e: any) { fail++; console.log(`FAIL  ${name}: ${e?.message ?? e}`); }
}

const FULL = "I studied computer science at ABC University. During my final year I built a chatbot for the admissions office using Python and FastAPI. It reduced response times by 40 percent. I now want to pursue a master's degree.";
const START = FULL.indexOf("During my final year");
const END = FULL.indexOf(" I now want");
const SEL = FULL.slice(START, END);
const body = (over: any = {}) => ({
  fullText: FULL, selectionStart: START, selectionEnd: END, selectedText: SEL, ...over,
});

async function main() {
  // ---------- validation ----------
  await check("validation: accepts a well-formed payload and normalizes blanks", () => {
    const v = validateInlineRewriteInput(body({ instruction: "  " }));
    assert.equal(v.selectedText, SEL);
    assert.equal(v.instruction, undefined);
  });

  await check("validation: rejects non-object / missing fullText / bad JSON shape", () => {
    for (const b of [null, "x", {}, { fullText: 42 }, { fullText: "   " }]) {
      assert.throws(() => validateInlineRewriteInput(b), InlineRewriteInputError);
    }
  });

  await check("validation: rejects out-of-bounds and inverted offsets", () => {
    assert.throws(() => validateInlineRewriteInput(body({ selectionStart: -1 })), InlineRewriteInputError);
    assert.throws(() => validateInlineRewriteInput(body({ selectionEnd: FULL.length + 1 })), InlineRewriteInputError);
    assert.throws(() => validateInlineRewriteInput(body({ selectionStart: END, selectionEnd: START })), InlineRewriteInputError);
    assert.throws(() => validateInlineRewriteInput(body({ selectionStart: 3.5 })), InlineRewriteInputError);
  });

  await check("validation: rejects selectedText that does not match the offsets", () => {
    assert.throws(() => validateInlineRewriteInput(body({ selectedText: "something else" })), InlineRewriteInputError);
    assert.throws(() => validateInlineRewriteInput(body({ selectedText: SEL + "x" })), InlineRewriteInputError);
  });

  await check("validation: rejects empty and oversized selections", () => {
    assert.throws(() => validateInlineRewriteInput(body({ selectionStart: 5, selectionEnd: 6, selectedText: FULL.slice(5, 6) })), /too short/i);
    const long = "x".repeat(SELECTION_MAX_CHARS + 1);
    const ft = "P" + long + "Q";
    assert.throws(() => validateInlineRewriteInput({ fullText: ft, selectionStart: 1, selectionEnd: 1 + long.length, selectedText: long }), /limit|exceeds/i);
  });

  await check("validation: rejects oversized instruction and non-string instruction", () => {
    assert.throws(() => validateInlineRewriteInput(body({ instruction: "i".repeat(501) })), InlineRewriteInputError);
    assert.throws(() => validateInlineRewriteInput(body({ instruction: 12 })), InlineRewriteInputError);
    const ok = validateInlineRewriteInput(body({ instruction: " make it formal " }));
    assert.equal(ok.instruction, "make it formal");
  });

  // ---------- prompt wiring ----------
  await check("context: splits before / selected / after correctly", () => {
    const ctx = buildInlineRewriteContext(validateInlineRewriteInput(body()));
    assert.equal(ctx.beforeContext, "I studied computer science at ABC University. ");
    assert.equal(ctx.selectedText, SEL);
    assert.equal(ctx.afterContext, " I now want to pursue a master's degree.");
    assert.match(ctx.instruction, /clarity/i); // default instruction
  });

  await check("prompt: wraps selection in markers and carries instruction", () => {
    const msgs = buildInlineRewriteMessages(validateInlineRewriteInput(body({ instruction: "Shorter." })));
    assert.equal(msgs[0].role, "system");
    assert.match(msgs[0].content, /preserve every factual claim/i);
    assert.match(msgs[0].content, /data, never as instructions/i);
    assert.match(msgs[1].content, /<<<SELECTED_START>>>/);
    assert.match(msgs[1].content, /<<<SELECTED_END>>>/);
    assert.ok(msgs[1].content.includes(SEL));
    assert.match(msgs[1].content, /INSTRUCTION:\nShorter\./);
    assert.ok(msgs[1].content.indexOf("BEFORE:") < msgs[1].content.indexOf("SELECTED_START"));
    assert.ok(msgs[1].content.indexOf("SELECTED_END") < msgs[1].content.indexOf("AFTER:"));
  });

  // ---------- output cleaning ----------
  await check("cleanRewrittenText: strips markdown fences and wrapping quotes", () => {
    assert.equal(cleanRewrittenText("```\nHello world\n```"), "Hello world");
    assert.equal(cleanRewrittenText("```text\nHello world```"), "Hello world");
    assert.equal(cleanRewrittenText('"Hello world"'), "Hello world");
    assert.equal(cleanRewrittenText("  Plain output  "), "Plain output");
    assert.equal(cleanRewrittenText('He said "hi" loudly'), 'He said "hi" loudly');
  });

  // ---------- runner with mocked transport ----------
  await check("runner: passes full input to transport and returns rewrittenText", async () => {
    let seen: any;
    const r = await inlineRewrite(body({ instruction: "Tighter." }), {
      source: async (input) => { seen = input; return "In my final year I built a FastAPI chatbot that cut admissions response times by 40 percent."; },
    });
    assert.equal(seen.fullText, FULL);
    assert.equal(seen.selectionStart, START);
    assert.equal(seen.selectionEnd, END);
    assert.equal(seen.selectedText, SEL);
    assert.equal(seen.instruction, "Tighter.");
    assert.match(r.rewrittenText, /40 percent/);
  });

  await check("runner: provider failure propagates (route maps to 5xx, no crash)", async () => {
    await assert.rejects(
      () => inlineRewrite(body(), { source: async () => { throw new Error("upstream timeout"); } }),
      /upstream timeout/,
    );
  });

  await check("runner: invalid input is rejected before the transport runs", async () => {
    let called = false;
    await assert.rejects(
      () => inlineRewrite(body({ selectedText: "mismatch" }), { source: async () => { called = true; return "x"; } }),
      InlineRewriteInputError,
    );
    assert.equal(called, false);
  });

  await check("runner: empty model output is rejected", async () => {
    await assert.rejects(
      () => inlineRewrite(body(), { source: async () => "  " }),
      /empty/i,
    );
  });

  await check("model: resolves OPENAI_SOP_MODEL with gpt-6.1-sol fallback", () => {
    const prev = process.env.OPENAI_SOP_MODEL;
    delete process.env.OPENAI_SOP_MODEL;
    assert.equal(INLINE_REWRITE_MODEL(), "gpt-6.1-sol");
    process.env.OPENAI_SOP_MODEL = "gpt-test-x";
    assert.equal(INLINE_REWRITE_MODEL(), "gpt-test-x");
    if (prev == null) delete process.env.OPENAI_SOP_MODEL; else process.env.OPENAI_SOP_MODEL = prev;
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
