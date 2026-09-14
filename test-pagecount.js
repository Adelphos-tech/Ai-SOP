const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');

async function renderAndCount(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setContent(html);
  const pdfBytes = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();

  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}

(async () => {
  // Test 1: Short text (1 page)
  const short = await renderAndCount(`<html><head><style>@page{size:A4;margin:1in}body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.6}</style></head><body><p>Short text.</p></body></html>`);
  console.log('Short text pages:', short, '(expect 1)');

  // Test 2: Long text (should be 2+ pages)
  const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(300);
  const long = await renderAndCount(`<html><head><style>@page{size:A4;margin:1in}body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.6}</style></head><body><p>${longText}</p></body></html>`);
  console.log('Long text pages:', long);

  // Test 3: MIT Component A (317 words)
  const compA = 'A'.repeat(317 * 6); // ~317 words * 6 chars avg
  const a = await renderAndCount(`<html><head><style>@page{size:A4;margin:1in}body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.6}</style></head><body><p>${compA}</p></body></html>`);
  console.log('~317-word component pages:', a);

  // Test 4: MIT Component B (435 words)
  const compB = 'B'.repeat(435 * 6);
  const b = await renderAndCount(`<html><head><style>@page{size:A4;margin:1in}body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.6}</style></head><body><p>${compB}</p></body></html>`);
  console.log('~435-word component pages:', b);

  console.log('DONE');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
