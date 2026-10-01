const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'manual-screenshots');
const BASE = 'http://localhost:3123';

// Demo applicant: Kunj Modh
const STUDENT_ID = '8cdc0715-b043-4065-81d5-0a71ae5694bb';
const APP_ID = 'be17b02f-688d-4089-b710-c895a9531798';
const SOP_DOC_ID = 'f0b35e3d-763b-4bb0-b21f-593d3c0855b2';
const VISA_DOC_ID = 'a1abd0d3-dee4-4fb5-af74-cb636ce0be06';

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage !== false, ...opts });
  console.log(`  ✓ ${name}.png (${Math.round(fs.statSync(file).size / 1024)}KB)`);
}

async function main() {
  // Clear old screenshots
  if (fs.existsSync(OUT)) {
    fs.readdirSync(OUT).forEach(f => fs.unlinkSync(path.join(OUT, f)));
  } else {
    fs.mkdirSync(OUT, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // 1. Students list
  console.log('1. Students list...');
  await page.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '01-students-list');

  // 2. New Applicant page
  console.log('2. New Applicant page...');
  await page.goto(`${BASE}/students/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '02-new-applicant');

  // 3. Student workspace (Kunj)
  console.log('3. Student workspace...');
  await page.goto(`${BASE}/students/${STUDENT_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '03-student-workspace');

  // 4. Application workspace
  console.log('4. Application workspace...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await shot(page, '04-application-workspace');

  // 4b. Add Document form — scroll to find and click
  console.log('4b. Add Document form...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  const addBtn = await page.$('button:has-text("+ Add Document")')
    || await page.$('button:has-text("Add Document")');
  if (addBtn) {
    await addBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await addBtn.click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await shot(page, '04b-add-document-form');

    // 4c. Advanced options expanded
    console.log('4c. Advanced options...');
    const advBtn = await page.$('summary:has-text("Advanced")');
    if (advBtn) {
      await advBtn.click();
      await page.waitForTimeout(500);
      await shot(page, '04c-advanced-options');
    } else {
      console.log('   ! Advanced options not found');
      await shot(page, '04c-advanced-options');
    }
  } else {
    console.log('   ! Add Document button not found');
    await shot(page, '04b-add-document-form');
    await shot(page, '04c-advanced-options');
  }

  // 4d. Intake - Student Details
  console.log('4d. Intake - Student Details...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04d-intake-student-details');

  // 4e. Intake - missing wizard
  console.log('4e. Intake - missing wizard...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/missing`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04e-intake-missing');

  // 4f. Intake - Career Goals
  console.log('4f. Intake - Career Goals...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/career-goals`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04f-intake-career-goals');

  // 4g. Intake - Country Questions
  console.log('4g. Intake - Country Questions...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/country-questions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04g-intake-country-questions');

  // 4h. Intake - Program/University Info
  console.log('4h. Intake - Program Info...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/university-requirements`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04h-intake-program-info');

  // 4i. Intake - Master's Motivation
  console.log('4i. Intake - Master Motivation...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/masters-motivation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04i-intake-masters-motivation');

  // 4j. Intake - Work Experience
  console.log('4j. Intake - Work Experience...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/work-experience`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04j-intake-work-experience');

  // 4k. Intake - Academics & Projects
  console.log('4k. Intake - Academics & Projects...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/intake/academics-projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '04k-intake-academics-projects');

  // 5. Document workspace (SOP)
  console.log('5. Document workspace...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/documents/${SOP_DOC_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await shot(page, '05-document-workspace');

  // 5b. Document with editor
  console.log('5b. Document with editor...');
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(500);
  await shot(page, '05b-document-editor');

  // 5c. Version history
  console.log('5c. Version history...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await shot(page, '05c-version-history');

  // 5d. Export panel (scroll back up)
  console.log('5d. Export panel...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shot(page, '05d-export-panel');

  // 5e. Visa SOP document
  console.log('5e. Visa SOP document...');
  await page.goto(`${BASE}/students/${STUDENT_ID}/applications/${APP_ID}/documents/${VISA_DOC_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await shot(page, '05e-visa-sop-document');

  // 6. Applications list
  console.log('6. Applications list...');
  await page.goto(`${BASE}/applications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '06-applications-list');

  // 7. Requirements library
  console.log('7. Requirements library...');
  await page.goto(`${BASE}/requirements-library`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '07-requirements-library');

  await browser.close();
  console.log('\nDone! Screenshots saved to:', OUT);
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  console.log(`Total: ${files.length} screenshots`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
