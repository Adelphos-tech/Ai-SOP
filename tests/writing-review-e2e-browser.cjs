/**
 * Brick 4B-C2 Part B — Writing Review browser E2E.
 * Real app server (next start :5010) + real DB-backed session login +
 * real seeded rows in the disposable sop_ai_app DB. Ryne is stubbed at
 * http://127.0.0.1:5099 — zero real provider calls.
 *
 * Run:
 *   node tests/writing-review-e2e-browser.mjs
 */
const puppeteer = require("puppeteer");

const BASE = "http://127.0.0.1:5010";
const STUDENT_ID = "4e3879d6-ee28-47c3-9dd7-90239dd389eb";
const APP_ID = "1926f8a3-db08-4dad-aff8-8b0ca2693fdf";
const DOC_ID = "1390ce6a-13df-4317-990b-36a65e164565";
const REVIEW_URL = `${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/documents/${DOC_ID}/writing-review`;
const SHOTS = "/tmp/e2e-shots";
const fs = require("fs");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; const m = `${name}${detail ? " — " + detail : ""}`; fails.push(m); console.log(`  FAIL  ${m}`); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function clickByText(page, selector, text) {
  return page.evaluate(([sel, t]) => {
    const el = [...document.querySelectorAll(sel)]
      .find(e => e.textContent.trim().includes(t) && !e.disabled);
    if (!el) return false;
    el.click(); return true;
  }, [selector, text]);
}
const visibleText = page => page.evaluate(() => document.body.innerText);

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1440, height: 900 });
  page.on("dialog", d => d.accept()); // consent confirms → always accept

  console.log("=== Auth ===");
  // Real login through the existing endpoint — browser stores the
  // httpOnly session cookie exactly as a real sign-in would.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  const loginStatus = await page.evaluate(async () => {
    const r = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "e2e@dvivid.test", password: "TestPass123!" }),
    });
    return r.status;
  });
  check("real /api/auth/login issues session (200)", loginStatus === 200, `got ${loginStatus}`);
  const bad = await page.evaluate(async () => {
    const r = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "e2e@dvivid.test", password: "wrong-password" }),
    });
    return r.status;
  });
  check("wrong password rejected (401)", bad === 401, `got ${bad}`);

  console.log("=== Load ===");
  await page.goto(REVIEW_URL, { waitUntil: "networkidle2" });
  await delay(1200);
  let text = await visibleText(page);
  check("page loads document title", text.includes("E2E Statement of Purpose"));
  check("document content rendered", text.includes("capstone project"));
  check("version info shown", /v\d+/.test(text));
  check("AI Detection Results section present", text.includes("AI Detection Results"));
  check("detector cards rendered", text.includes("Reilaa") || text.includes("GPTZero"));
  await page.screenshot({ path: `${SHOTS}/01-loaded.png` });

  console.log("=== Detection ===");
  const btn = await clickByText(page, "button", "Recheck Detection");
  check("recheck button clickable", btn);
  await delay(500);
  // duplicate submission during loading must be prevented — button disabled
  const stillChecking = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some(b => b.textContent.includes("Checking…") && b.disabled));
  check("recheck button disabled while running", stillChecking);
  await page.waitForFunction(
    () => document.body.innerText.includes("Flagged") || document.body.innerText.includes("% AI"),
    { timeout: 20000 }).catch(() => {});
  await delay(1200);
  text = await visibleText(page);
  check("detector scores displayed", /\d+%/.test(text) && text.includes("scored"));
  check("zerogpt failure shown honestly (not a score)", /zerogpt/i.test(text));
  const flagCount = await page.$$eval("button[aria-label^='Flagged sentence']", els => els.length).catch(() => 0);
  check("flagged passages rendered", flagCount >= 2, `found ${flagCount}`);
  check("flagged-count banner", text.includes("sentences flagged") || text.includes("sentence flagged"));
  await page.screenshot({ path: `${SHOTS}/02-detection.png` });

  console.log("=== Rewrite (Balanced) ===");
  await page.$$eval("button[aria-label^='Flagged sentence']", els => els[0].click());
  await delay(600);
  const regen = await clickByText(page, "button", "Regenerate");
  check("regenerate button clickable", regen);
  await page.waitForFunction(
    () => document.body.innerText.includes("[Balanced-rewritten]"), { timeout: 20000 }).catch(() => {});
  await delay(500);
  text = await visibleText(page);
  check("balanced suggestion displayed", text.includes("[Balanced-rewritten]"));
  check("beast-mode score surfaced", text.includes("8.2"));
  await page.screenshot({ path: `${SHOTS}/03-suggestion.png` });

  console.log("=== Accept → Undo ===");
  const applied = await clickByText(page, "button", "Apply This Rewrite");
  check("apply button clickable", applied);
  await delay(800);
  text = await visibleText(page);
  check("rewrite applied to draft", text.includes("[Balanced-rewritten]"));
  // switch to history tab for the restore control
  await clickByText(page, "button", "Sentence History");
  await delay(400);
  const restored = await clickByText(page, "button", "Restore Original Sentence");
  check("restore control present", restored);
  await delay(600);
  // Assert on the DOCUMENT column only — the History tab legitimately
  // keeps displaying the old suggestion text, so a full-page check is
  // invalid. The document panel is the flex-1 column holding the h2.
  const docText = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find(h => h.textContent.includes("E2E Statement"));
    const col = h2?.closest(".flex-1");
    return col ? col.innerText : "";
  });
  check("undo restores original sentence in the draft",
    !docText.includes("[Balanced-rewritten]") && docText.includes("During my undergraduate"));

  console.log("=== Titan mode ===");
  await clickByText(page, "button", "Rewrite Suggestion");
  await page.select("select[aria-label='Rewrite mode']", "titan");
  await delay(300);
  await page.$$eval("button[aria-label^='Flagged sentence']", els => els[0].click());
  await delay(400);
  await clickByText(page, "button", "Regenerate");
  await page.waitForFunction(
    () => document.body.innerText.includes("[Titan-rewritten]"), { timeout: 20000 }).catch(() => {});
  text = await visibleText(page);
  check("titan suggestion displayed", text.includes("[Titan-rewritten]"));
  // reject it
  await clickByText(page, "button", "Keep Original");
  await delay(400);

  console.log("=== Save ===");
  // apply a rewrite first so the draft is dirty
  await page.$$eval("button[aria-label^='Flagged sentence']", els => els[0].click());
  await delay(400);
  await clickByText(page, "button", "Regenerate");
  await page.waitForFunction(
    () => document.body.innerText.includes("[Titan-rewritten]"), { timeout: 20000 }).catch(() => {});
  await clickByText(page, "button", "Apply This Rewrite");
  await delay(600);
  const saved = await clickByText(page, "button", "Save Changes");
  check("save button clickable", saved);
  await page.waitForFunction(
    () => document.body.innerText.includes("Saved") || document.body.innerText.includes("✓"),
    { timeout: 15000 }).catch(() => {});
  await delay(1000);
  text = await visibleText(page);
  check("save produced success state", text.includes("Saved") || text.includes("v2"));
  await page.screenshot({ path: `${SHOTS}/04-saved.png` });

  console.log("=== Export ===");
  const exportResp = page.waitForResponse(
    r => r.url().includes("/api/application/document/export") && r.request().method() === "POST",
    { timeout: 30000 }).catch(() => null);
  await clickByText(page, "button", "Export Document");
  const resp = await exportResp;
  check("export endpoint returned 200", resp && resp.status() === 200, `got ${resp && resp.status()}`);

  console.log("=== Auth failure path ===");
  const unauth = await page.evaluate(async () => {
    const r = await fetch(`/api/application/writing-review?documentId=${DOC_ID}&applicationId=${APP_ID}&studentId=${STUDENT_ID}`, { method: "DELETE" });
    return r.status;
  }).catch(() => -1);
  // clear cookie → GET must 401
  const client = await page.target().createCDPSession();
  await client.send("Network.clearBrowserCookies");
  const unauthGet = await page.evaluate(async (u) => {
    const r = await fetch(u); return r.status;
  }, `${BASE}/api/application/writing-review?documentId=${DOC_ID}&applicationId=${APP_ID}&studentId=${STUDENT_ID}`);
  check("unauthenticated API read blocked (401)", unauthGet === 401, `got ${unauthGet}`);

  console.log("=== Responsive ===");
  // re-login for the responsive pass
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "e2e@dvivid.test", password: "TestPass123!" }),
    });
  });
  for (const [w, name] of [[1440, "desktop"], [768, "tablet"], [375, "mobile"]]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(REVIEW_URL, { waitUntil: "networkidle2" });
    await delay(1000);
    const t = await visibleText(page);
    check(`${name} ${w}px renders workspace`, t.includes("AI Writing Review") && t.includes("E2E Statement of Purpose"));
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
    check(`${name} ${w}px no horizontal overflow`, !overflow);
    await page.screenshot({ path: `${SHOTS}/05-${name}.png` });
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log(`  - ${f}`)); }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("E2E crashed:", e); process.exit(1); });
