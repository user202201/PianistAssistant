const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const one = fs.readFileSync(D + 'Ode_Primo.musicxml');
  const store = new Map([['scores/Alpha.musicxml', one], ['scores/Beta.musicxml', one], ['pdfs/Alpha.pdf', fs.readFileSync(D + 'Test-Piece-for-OCR.pdf')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.listbox .card'); await page.waitForTimeout(800);
  await page.click('.listbox .card:has-text("Alpha") .del'); ok((await page.textContent('dialog')).includes('查看原 PDF'), 'a converted score whose PDF was kept offers "view the original PDF"');
  await page.click('dialog button:has-text("查看原 PDF")'); await page.waitForSelector('.pdfpage', { timeout: 20000 }); ok(true, 'it opens the PDF');
  await page.click('button[title=返回]'); await page.waitForSelector('.listbox .card');
  await page.click('.listbox .card:has-text("Beta") .del'); ok(!(await page.textContent('dialog')).includes('查看原 PDF'), 'a score without a kept PDF does not');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
