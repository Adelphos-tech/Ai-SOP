const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5010';
const STUDENT_ID = '7125dafd-a496-4046-932c-8b6afbd3925f';
const APP_ID = '18f15b77-e80f-4f96-95d8-2f73cf0fb176';
const OUT = path.join(__dirname, '..', 'brick5-screenshots');

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage !== false });
  const size = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ✓ ${name}.png (${size}KB)`);
}

async function main() {
  if (fs.existsSync(OUT)) {
    fs.readdirSync(OUT).forEach(f => fs.unlinkSync(path.join(OUT, f)));
  } else {
    fs.mkdirSync(OUT, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // ========== DESKTOP ==========
  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1440, height: 900 });

  console.log('1. Desktop Application Workspace...');
  await desktop.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  await shot(desktop, '01-desktop-workspace');

  console.log('2. Desktop Intake Student Details...');
  await desktop.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  await shot(desktop, '02-desktop-intake-student-details');

  console.log('3. Desktop Intake Country Questions...');
  await desktop.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/country-questions`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  // Select USA to show questions
  await desktop.select('select', 'USA');
  await new Promise(r => setTimeout(r, 1500));
  await shot(desktop, '03-desktop-intake-country-questions');

  await desktop.close();

  // ========== MOBILE ==========
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  console.log('4. Mobile Application Workspace...');
  await mobile.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  await shot(mobile, '04-mobile-workspace');

  console.log('5. Mobile Intake Student Details...');
  await mobile.goto(`${BASE_URL}/students/${STUDENT_ID}/applications/${APP_ID}/intake/student-details`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  await shot(mobile, '05-mobile-intake-student-details');

  await mobile.close();
  await browser.close();

  console.log(`\nDone! Screenshots saved to: ${OUT}`);
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  console.log(`Total: ${files.length} screenshots`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
