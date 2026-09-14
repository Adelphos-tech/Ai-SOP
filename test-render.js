const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setContent(`
    <html>
    <head>
      <style>
        @page { size: A4; margin: 1in; }
        body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; }
      </style>
    </head>
    <body>
      <p>This is a test paragraph. It should render on exactly one page with these settings.</p>
      <p>${'Lorem ipsum dolor sit amet. '.repeat(200)}</p>
    </body>
    </html>
  `);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  console.log('PDF generated, size:', pdf.length, 'bytes');

  const pdfBuffer = Buffer.from(pdf);
  const pageCount = (pdfBuffer.toString('binary').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log('Approximate page count (from PDF objects):', pageCount);

  await browser.close();
  console.log('SUCCESS');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
