const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const htmlPath = path.join(__dirname, '..', 'MANUAL.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const pdfPath = path.join(__dirname, '..', 'D-Vivid-User-Manual.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  console.log(`PDF saved: ${pdfPath}`);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
