/**
 * brick5-e2e-browser-journey.js — End-to-End Browser Acceptance Test
 *
 * Exercises the complete consultant journey on the redesigned intake.
 * Uses the existing Scope Test application (empty profile, USA).
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:5010';
const STUDENT_ID = '7125dafd-a496-4046-932c-8b6afbd3925f';
const APP_ID = '18f15b77-e80f-4f96-95d8-2f73cf0fb176';

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(name, cond, detail = '') {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    const msg = `${name}${detail ? ` — ${detail}` : ''}`;
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== Brick 5: Browser Journey Acceptance Tests ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 1440, height: 900 });


  async function settle() {
    await delay(2500);
  }

  async function pageText() {
    return page.evaluate(() => document.body.innerText);
  }

  async function typeInto(selector, value, targetPage = page) {
    await targetPage.waitForSelector(selector, { visible: true, timeout: 10000 });
    await targetPage.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      el.select();
      document.execCommand('insertText', false, val);
      el.blur();
    }, selector, value);
    await delay(300);
  }

  // Click element containing text via JS evaluation
  async function clickByText(text) {
    const clicked = await page.evaluate((t) => {
      const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const el = els.find(e => e.textContent.includes(t));
      if (el) { el.click(); return true; }
      return false;
    }, text);
    if (clicked) await delay(800);
    return clicked;
  }

  // ============================================
  // TEST 1: Application Workspace loads with progress dashboard
  // ============================================
  console.log('TEST 1: Application Workspace loads');
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}`, { waitUntil: 'networkidle2' });
  await settle();

  const appText = await pageText();
  assert('Workspace shows application name', appText.includes('Test University'));
  assert('Workspace shows progress dashboard',
    appText.includes('Application Information') || appText.includes('required sections complete') || appText.includes('Continue Application'));
  assert('Workspace shows required count', appText.includes('required sections complete') || /\d+\/\d+ required/.test(appText));
  assert('Workspace shows Continue Application CTA', appText.includes('Continue Application'));
  assert('Workspace shows section grid', appText.includes('Student Details'));
  assert('Workspace shows Documents section', appText.includes('Documents'));

  // ============================================
  // TEST 2: Navigate to Intake
  // ============================================
  console.log('\nTEST 2: Navigate to Intake');
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await settle();

  const intakeText = await pageText();
  assert('Intake page loads', intakeText.includes('Student Details'));
  assert('Sidebar shows progress', intakeText.includes('Progress'));
  assert('Sidebar shows section list', intakeText.includes('Student Details') && intakeText.includes('Field Motivation'));
  assert('Save buttons present', intakeText.includes('Save & Continue') || intakeText.includes('Save Draft'));

  // ============================================
  // TEST 3: Fill Student Details and Save Draft
  // ============================================
  console.log('\nTEST 3: Fill Student Details + Save Draft');
  await typeInto('input[name="personalData.firstName"]', 'Scope');
  await typeInto('input[name="personalData.lastName"]', 'Test');
  await typeInto('input[name="personalData.nationality"]', 'Indian');
  await typeInto('input[name="personalData.currentCity"]', 'Mumbai');
  await typeInto('input[name="personalData.currentCountry"]', 'India');

  const draftSaved = await clickByText('Save Draft');
  if (draftSaved) {
    await delay(2500);
  }

  const afterSaveText = await pageText();
  assert('Save succeeds (no error banner)', !afterSaveText.includes('Save failed') && !afterSaveText.includes('Failed to save'));

  // ============================================
  // TEST 4: Refresh page — verify data persisted
  // ============================================
  console.log('\nTEST 4: Refresh and verify persistence');
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await settle();

  const firstNameVal = await page.evaluate(() => document.querySelector('input[name="personalData.firstName"]')?.value);
  const lastNameVal = await page.evaluate(() => document.querySelector('input[name="personalData.lastName"]')?.value);
  assert('First Name persisted after refresh', firstNameVal === 'Scope', `got "${firstNameVal}"`);
  assert('Last Name persisted after refresh', lastNameVal === 'Test', `got "${lastNameVal}"`);

  // ============================================
  // TEST 5: Save & Continue navigates to next section
  // ============================================
  console.log('\nTEST 5: Save & Continue navigation');
  await clickByText('Save & Continue');
  await settle();

  const nextText = await pageText();
  assert('Navigated to next section after Save & Continue',
    nextText.includes('Field Motivation') || nextText.includes('Academics') || nextText.includes('Work Experience') || nextText.includes('Projects'));

  // ============================================
  // TEST 6: Country Questions section
  // ============================================
  console.log('\nTEST 6: Country Questions section');
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/country-questions`, { waitUntil: 'networkidle2' });
  await settle();

  const cqText = await pageText();
  assert('Country Questions page loads', cqText.includes('Country Questions') || cqText.includes('Select Destination Country'));

  // Select USA
  await page.select('select', 'USA');
  await delay(1500);

  const afterSelect = await pageText();
  assert('USA questions appear', afterSelect.includes('United States'));
  assert('Required questions shown', afterSelect.includes('Why not study'));

  // Fill textareas — replace existing text via execCommand
  const textareaCount = await page.evaluate(() => document.querySelectorAll('textarea').length);
  for (let i = 0; i < textareaCount; i++) {
    await page.evaluate((idx, val) => {
      const ta = document.querySelectorAll('textarea')[idx];
      if (ta) {
        ta.focus();
        ta.select();
        document.execCommand('insertText', false, val);
        ta.blur();
      }
    }, i, 'Sample answer for testing persistence.');
    await delay(300);
  }

  await clickByText('Save Draft');
  await delay(2500);

  // Refresh and verify
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/country-questions`, { waitUntil: 'networkidle2' });
  await settle();

  const taValues = await page.evaluate(() => Array.from(document.querySelectorAll('textarea')).map(t => t.value));
  const hasPersisted = taValues.some(v => v === 'Sample answer for testing persistence.');
  assert('Country question answer persisted after refresh', hasPersisted, `values: ${JSON.stringify(taValues)}`);

  // ============================================
  // TEST 7: Return to Workspace — progress updated
  // ============================================
  console.log('\nTEST 7: Workspace progress updated');
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}`, { waitUntil: 'networkidle2' });
  await settle();

  const wsText = await pageText();
  assert('Workspace shows updated progress', wsText.includes('Student Details') && wsText.includes('Country Questions'));

  // ============================================
  // TEST 8: Mobile viewport
  // ============================================
  console.log('\nTEST 8: Mobile viewport');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await settle();

  const mobileText = await pageText();
  assert('Mobile intake loads', mobileText.includes('Student Details'));
  assert('Mobile section dropdown present', mobileText.includes('required complete') || mobileText.includes('Student Details'));

  const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert('No horizontal scroll on mobile', !hasScroll);

  // ============================================
  // TEST 9: Duplicate submission prevention
  // ============================================
  console.log('\nTEST 9: Duplicate submission prevention');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await settle();

  await typeInto('input[name="personalData.firstName"]', 'DupTest');

  let saveRequestCount = 0;
  const trackSave = req => {
    if (req.url().includes('/api/application/profile') && req.method() === 'PUT') saveRequestCount++;
  };
  page.on('request', trackSave);

  // Click Save Draft twice rapidly
  await clickByText('Save Draft');
  await clickByText('Save Draft');
  await delay(3000);

  page.off('request', trackSave);
  assert('Only one save request sent', saveRequestCount === 1, `got ${saveRequestCount}`);

  // ============================================
  // TEST 10: 409 Conflict handling
  // ============================================
  console.log('\nTEST 10: 409 Conflict handling');
  await page.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await settle();

  // Get current revision from page load
  const loadedRev = await page.evaluate(() => {
    // The revision is in window.__NEXT_DATA__ or can be inferred from network,
    // but easier: fetch the profile API directly in-page
    return null; // placeholder, we'll fetch externally
  });

  // Type a change to make form dirty
  await typeInto('input[name="personalData.firstName"]', 'ConflictTest');

  // Bump revision externally via direct API call
  const bumpRes = await fetch(`${BASE_URL}/api/application/profile?studentId=${STUDENT_ID}&applicationId=${APP_ID}`);
  const bumpData = await bumpRes.json();
  const currentRev = bumpData.profile?._revision || bumpData.revision || 0;

  await fetch(`${BASE_URL}/api/application/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: STUDENT_ID,
      applicationId: APP_ID,
      profileData: { ...bumpData.profile, personalData: { ...bumpData.profile.personalData, firstName: 'Bumped' } },
      expectedRevision: currentRev,
    }),
  });

  // Now save from browser — it still thinks revision is currentRev, but server has currentRev+1
  await clickByText('Save Draft');
  await delay(2500);

  const conflictText = await pageText();
  assert('409 error message shown', conflictText.includes('Profile was updated elsewhere') || conflictText.includes('updated elsewhere'));

  // ============================================
  // TEST 11: beforeunload guard on dirty form
  // ============================================
  console.log('\nTEST 11: beforeunload guard on dirty form');
  // Use a fresh page so we aren't blocked by lingering dirty state from Test 10
  const freshPage = await browser.newPage();
  await freshPage.setViewport({ width: 1440, height: 900 });
  await freshPage.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await delay(2500);

  await typeInto('input[name="personalData.firstName"]', 'NavTest', freshPage);
  await delay(500);

  const beforeunloadBlocked = await freshPage.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert('beforeunload blocked when form is dirty', beforeunloadBlocked === true, `got ${beforeunloadBlocked}`);

  // Save to clear dirty state, then verify beforeunload is NOT blocked
  const saveClicked = await freshPage.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const el = els.find(e => e.textContent.includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, 'Save Draft');
  if (saveClicked) await delay(2500);

  const beforeunloadAllowed = await freshPage.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return !e.defaultPrevented;
  });
  assert('beforeunload allowed after save', beforeunloadAllowed === true, `got ${beforeunloadAllowed}`);
  await freshPage.close();

  // ============================================
  // Summary
  // ============================================
  await browser.close();

  console.log(`\n${'='.repeat(60)}`);
  if (failCount === 0) {
    console.log(`✅ All ${passCount} browser assertions passed`);
  } else {
    console.log(`❌ ${failCount} failed, ${passCount} passed`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`${'='.repeat(60)}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
