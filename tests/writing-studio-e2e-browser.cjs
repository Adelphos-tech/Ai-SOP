/**
 * AI Writing Studio — browser E2E for the document-level Humanizer redesign.
 *
 * Real app server (next start :5010) + real DB session + seeded rows in the
 * disposable sop_ai_app DB. Ryne is stubbed at http://127.0.0.1:5099 — zero
 * real provider calls. Provider-call assertions count ryne_spend_events rows.
 *
 * Prereqs:
 *   PORT=5099 node scripts/ryne-stub-server.cjs &
 *   RYNE_API_BASE_URL=http://127.0.0.1:5099 RYNE_API_KEY=e2e RYNE_PAID_CALLS_ENABLED=1 npm run start &
 *
 * Run: node tests/writing-studio-e2e-browser.cjs
 */
const puppeteer = require("puppeteer");
const { execSync } = require("child_process");
const fs = require("fs");

const BASE = "http://127.0.0.1:5010";
const STUDENT_ID = "4e3879d6-ee28-47c3-9dd7-90239dd389eb";
const APP_ID = "1926f8a3-db08-4dad-aff8-8b0ca2693fdf";
const DOC_ID = "1390ce6a-13df-4317-990b-36a65e164565";
const REVIEW_URL = `${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/documents/${DOC_ID}/writing-review`;
const SHOTS = "/tmp/studio-shots";
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; const m = `${name}${detail ? " — " + detail : ""}`; fails.push(m); console.log(`  FAIL  ${m}`); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

function events(kind) {
  const where = kind ? `WHERE request_kind='${kind}'` : "";
  return parseInt(execSync(
    `mysql -h 127.0.0.1 -u root sop_ai_app -N -e "SELECT COUNT(*) FROM ryne_spend_events ${where}"`
  ).toString().trim(), 10);
}
function currentVersion() {
  const out = execSync(
    `mysql -h 127.0.0.1 -u root sop_ai_app -N -e "SELECT CONCAT(v.version_number,'|',v.created_by_type,'|',LEFT(v.content,40)) FROM document_versions v JOIN application_documents d ON d.current_version_id=v.id WHERE d.id='${DOC_ID}'"`
  ).toString().trim();
  const [n, t, c] = out.split("|");
  return { versionNumber: parseInt(n, 10), createdByType: t, contentStart: c };
}
const mysqlSafe = s => s.replace(/'/g, "''");

async function clickByText(page, selector, text) {
  return page.evaluate(([sel, t]) => {
    const el = [...document.querySelectorAll(sel)]
      .find(e => e.textContent.trim().includes(t) && !e.disabled && e.offsetParent !== null);
    if (!el) return false;
    el.click(); return true;
  }, [selector, text]);
}
const visibleText = page => page.evaluate(() => document.body.innerText);
async function waitText(page, snippet, timeout = 30000) {
  return page.waitForFunction(
    s => document.body.innerText.includes(s), { timeout }, snippet
  ).then(() => true).catch(() => false);
}

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
  await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);

  console.log("=== Auth ===");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  const loginStatus = await page.evaluate(async () => {
    const r = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "e2e@dvivid.test", password: "TestPass123!" }),
    });
    return r.status;
  });
  check("real /api/auth/login issues session (200)", loginStatus === 200, `got ${loginStatus}`);

  const v0 = currentVersion();
  const E0 = events(), H0 = events("HUMANIZER"), D0 = events("DETECTION");

  console.log("=== Load (desktop 1440) ===");
  await page.goto(REVIEW_URL, { waitUntil: "networkidle2" });
  await delay(1000);
  let text = await visibleText(page);
  check("Humanizer tab present", text.includes("Humanizer"));
  check("AI Detection Report tab present", text.includes("AI Detection Report"));
  check("original SOP rendered", text.includes("Pune Institute of Technology"));
  check(`version label v${v0.versionNumber}`, text.includes(`v${v0.versionNumber}`));
  check("Humanize Document action present", text.includes("Humanize Document"));
  check("model selector has Balanced/Titan", text.includes("Balanced (Recommended)") && text.includes("Titan"));
  check("word and sentence counts shown", /Words:\s*\d+/.test(text) && /Sentences:\s*\d+/.test(text));
  check("NO provider calls on load", events() === E0, `${events() - E0} unexpected events`);
  await page.screenshot({ path: `${SHOTS}/01-load-desktop-1440.png` });

  console.log("=== Report tab — detection stays manual ===");
  await clickByText(page, "button", "AI Detection Report");
  await delay(500);
  text = await visibleText(page);
  check("Run Report button present", text.includes("Run Report"));
  check("manual-only copy present", text.includes("Runs only when you click Run Report"));
  check("detector checkboxes rendered", text.includes("GPTZero"));
  check("switching tabs made no provider calls", events() === E0);

  console.log("=== Run Report (explicit) ===");
  check("Run Report clickable", await clickByText(page, "button", "Run Report"));
  const reportOk = await waitText(page, "unique sentences flagged", 30000);
  check("report rendered", reportOk);
  await delay(500);
  text = await visibleText(page);
  check("detector score shown (42% stub)", text.includes("42%") || text.includes("42"));
  check("GPTZero card present", text.includes("GPTZero"));
  check("provider error shown honestly (ZeroGPT)", /error|failed/i.test(text));
  check("document-level detector noted (Reilaa)", text.includes("document-level score only"));
  const aggM = text.match(/(\d+) of (\d+) unique sentences flagged/);
  check("unique-sentence summary rendered", !!aggM);
  if (aggM) check("flagged ≤ unique sentence count", +aggM[1] <= +aggM[2] && +aggM[2] > 0, `${aggM[1]}/${aggM[2]}`);
  check("3 detector events recorded (one per attempted detector)", events("DETECTION") - D0 === 3, `delta ${events("DETECTION") - D0}`);
  check("no humanizer calls yet", events("HUMANIZER") === H0);
  // expandable finding detail
  const openedFinding = await page.evaluate(() => {
    const b = document.querySelector("ol li button[aria-expanded]");
    if (!b) return false; b.click(); return true;
  });
  if (openedFinding) {
    await delay(300);
    check("finding expands to per-detector detail", (await visibleText(page)).includes("AI probability"));
  } else check("finding expand control present", false, "no finding buttons");
  // report history (prior run listed) — rerun creates a second entry later; for now one run exists
  await page.screenshot({ path: `${SHOTS}/02-report-desktop.png`, fullPage: true });

  console.log("=== Humanize Document (Balanced) ===");
  await clickByText(page, "button", "Humanizer");
  await delay(400);
  check("Humanize Document clickable", await clickByText(page, "button", "Humanize Document"));
  check("progress state shown", await waitText(page, "Humanizing", 5000));
  const done = await waitText(page, "[Balanced-rewritten]", 30000);
  check("full-document rewrite rendered", done);
  text = await visibleText(page);
  check("humanized column labelled", text.includes("Humanized SOP"));
  check("Ryne Balanced attribution", text.includes("Ryne Balanced"));
  check("Beast Mode score preserved as metadata", text.includes("Beast Mode") && text.includes("8.2"));
  check("rewritten word count shown", /words · \d+ sentences/.test(text));
  const diffMarks = await page.$$eval("mark, .bg-green-50, .bg-red-50", els => els.length).catch(() => 0);
  check("word-diff highlights rendered", diffMarks > 0, `${diffMarks} marks`);
  check("1 HUMANIZER ledger event", events("HUMANIZER") - H0 === 1, `delta ${events("HUMANIZER") - H0}`);
  check("humanizing triggered NO detection calls", events("DETECTION") - D0 === 3);
  await page.screenshot({ path: `${SHOTS}/03-humanized-desktop-1440.png`, fullPage: true });

  console.log("=== Edit + Regenerate (Titan) ===");
  check("Edit button clickable", await clickByText(page, "button", "Edit"));
  await delay(300);
  const edited = await page.evaluate(() => {
    const ta = document.querySelector("textarea[aria-label='Edit humanized text']");
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ta.value + " Edited by consultant.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  check("manual edit textarea present", edited);
  await clickByText(page, "button", "Done");
  await delay(300);
  check("edited indicator shown", (await visibleText(page)).includes("edited"));
  await page.select("select", "titan");
  await delay(200);
  check("Titan mode selected", (await visibleText(page)).includes("English only"));
  check("Regenerate clickable", await clickByText(page, "button", "Regenerate"));
  check("Titan rewrite rendered", await waitText(page, "[Titan-rewritten]", 30000));
  check("2 HUMANIZER ledger events total", events("HUMANIZER") - H0 === 2, `delta ${events("HUMANIZER") - H0}`);

  console.log("=== Copy / Apply / Save ===");
  check("Copy clickable", await clickByText(page, "button", "Copy"));
  await delay(400);
  check("copy outcome shown", /copied to clipboard|Copy failed/.test(await visibleText(page)));
  check("Apply This Rewrite clickable", await clickByText(page, "button", "Apply This Rewrite"));
  check("applied-draft notice (not saved yet)", (await visibleText(page)).includes("not saved yet"));
  check("Save as New Version clickable", await clickByText(page, "button", "Save as New Version"));
  check("save confirmation + history note", await waitText(page, "kept in history", 15000));
  const v1 = currentVersion();
  check(`new version saved (v${v1.versionNumber}) as CONSULTANT_EDITED`,
    v1.versionNumber === v0.versionNumber + 1 && v1.createdByType === "CONSULTANT_EDITED",
    JSON.stringify(v1));
  check("saved content is the humanized draft", v1.contentStart.includes("[Titan-rewritten]"), v1.contentStart);
  check("save triggered no provider calls", events("HUMANIZER") - H0 === 2 && events("DETECTION") - D0 === 3);
  await page.screenshot({ path: `${SHOTS}/04-saved.png` });

  console.log("=== Report marked outdated after change ===");
  await clickByText(page, "button", "AI Detection Report");
  await delay(500);
  check("outdated warning after document change", (await visibleText(page)).includes("outdated"));
  check("no auto rerun after save", events("DETECTION") - D0 === 3);

  console.log("=== Restore previous version ===");
  await clickByText(page, "button", "Humanizer");
  await delay(400);
  check("Restore previous version clickable", await clickByText(page, "button", "Restore previous version"));
  check("restore confirmation shown", await waitText(page, "Restored the text of", 15000));
  const v2 = currentVersion();
  check("restore created a new version with original text",
    v2.versionNumber === v1.versionNumber + 1 && v2.contentStart.includes("During my undergraduate"),
    JSON.stringify(v2));

  console.log("=== Provider error + retry safety ===");
  await page.goto(REVIEW_URL, { waitUntil: "networkidle2" });
  await delay(800);
  try { execSync("pkill -f ryne-stub-server.cjs"); } catch {}
  await delay(400);
  await clickByText(page, "button", "Humanize Document");
  await delay(3500);
  text = await visibleText(page);
  check("provider error surfaced honestly", /fail|error|unable|unavailable/i.test(text));
  check("no fabricated output on failure", !text.includes("[Balanced-rewritten]"));
  execSync(`cd "${process.cwd()}" && (PORT=5099 node scripts/ryne-stub-server.cjs > /tmp/ryne-stub.log 2>&1 &)`);
  await delay(1200);
  check("retry after outage works", await clickByText(page, "button", "Humanize Document")
    && await waitText(page, "[Balanced-rewritten]", 30000));

  console.log("=== Mobile 375 (tabs) ===");
  await page.setViewport({ width: 375, height: 812 });
  await page.reload({ waitUntil: "networkidle2" });
  await delay(800);
  text = await visibleText(page);
  check("mobile Original tab", /Original \(\d+\)/.test(text));
  check("mobile Humanized tab", text.includes("Humanized"));
  const paneVis = () => page.evaluate(() => {
    const orig = [...document.querySelectorAll("div")].find(d => d.getAttribute("aria-label") === "Original text");
    const hum = [...document.querySelectorAll("div")].find(d => d.getAttribute("aria-label") === "Humanized text");
    const vis = el => !!el && el.offsetParent !== null;
    return { origVisible: vis(orig), humVisible: vis(hum) };
  });
  const before = await paneVis();
  check("mobile default pane is Original", before.origVisible && !before.humVisible, JSON.stringify(before));
  await clickByText(page, "button", "Humanize Document");
  await waitText(page, "[Balanced-rewritten]", 30000);
  await delay(400);
  const mobilePanes = await paneVis();
  check("mobile auto-shows Humanized pane after rewrite", !mobilePanes.origVisible && mobilePanes.humVisible, JSON.stringify(mobilePanes));
  await clickByText(page, "button", "Original");
  await delay(300);
  const backToOrig = await paneVis();
  check("mobile tab switch back to Original", backToOrig.origVisible && !backToOrig.humVisible, JSON.stringify(backToOrig));
  await clickByText(page, "button", "Humanized");
  await delay(300);
  const mobilePanes2 = await page.evaluate(() => {
    const orig = [...document.querySelectorAll("div")].find(d => d.getAttribute("aria-label") === "Original text");
    const hum = [...document.querySelectorAll("div")].find(d => d.getAttribute("aria-label") === "Humanized text");
    const vis = el => !!el && el.offsetParent !== null;
    return { origVisible: vis(orig), humVisible: vis(hum) };
  });
  check("mobile tab switch shows Humanized pane", !mobilePanes2.origVisible && mobilePanes2.humVisible, JSON.stringify(mobilePanes2));
  await page.screenshot({ path: `${SHOTS}/05-mobile-375-humanized.png` });

  console.log("=== Viewport sweep ===");
  for (const w of [320, 375, 390, 428, 768, 1024, 1440, 1920]) {
    await page.setViewport({ width: w, height: 900 });
    await delay(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no horizontal overflow @ ${w}px`, overflow <= 2, `+${overflow}px`);
    await page.screenshot({ path: `${SHOTS}/viewport-${w}.png` });
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("E2E crashed:", e); process.exit(1); });
