const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  await page.goto('https://sop.adelphostech.com/students/b2086ce9-a26a-4b4d-baa6-a8362d70a9ba/applications/ca7286c9-30e0-45b2-aef9-97183cf05fc2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Find all buttons and their text
  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 50),
    visible: e.offsetParent !== null,
    className: e.className?.substring(0, 50),
  })));
  console.log('All buttons:');
  buttons.forEach((b, i) => console.log(`  ${i}: "${b.text}" visible=${b.visible} class=${b.className}`));
  
  // Also check for links that might act as buttons
  const links = await page.$$eval('a', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 50),
    href: e.getAttribute('href')?.substring(0, 80),
    visible: e.offsetParent !== null,
  })).filter(e => e.visible && (e.text?.includes('Add') || e.text?.includes('Document') || e.text?.includes('Generate'))));
  console.log('\nRelevant links:');
  links.forEach((l, i) => console.log(`  ${i}: "${l.text}" href=${l.href}`));
  
  // Check page title
  const title = await page.title();
  console.log('\nPage title:', title);
  
  // Check if intakeComplete shows
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nBody text (first 2000 chars):\n', bodyText);
  
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
