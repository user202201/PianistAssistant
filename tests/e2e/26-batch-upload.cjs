const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const one = fs.readFileSync(D + 'Ode_Primo.musicxml'); const two = fs.readFileSync(D + 'long.musicxml');
  const store = new Map([['scores/A.musicxml', one], ['scores/B.musicxml', one]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.listbox .card'); await page.waitForTimeout(500);
  // count how many times a "same name" question appears
  let asked = 0; await page.exposeFunction('__q', () => { asked++; });
  await page.evaluate(() => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.tagName === 'DIALOG' && n.textContent.includes('文件名重复') && window.__q()))).observe(document.body, { childList: true }));
  const xml = (n, b) => ({ name: n, mimeType: 'text/xml', buffer: b });
  await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', [xml('A.musicxml', two), xml('B.musicxml', two), xml('C.musicxml', two)]);
  await page.waitForSelector('dialog:has-text("文件名重复")'); ok(await page.isChecked('dialog input[type=checkbox]'), 'the question offers "same for all files" (ticked)');
  await page.click('dialog button:has-text("替换")');
  await page.waitForFunction(() => [...document.querySelectorAll('.listbox .card')].length >= 3, null, { timeout: 15000 }); await page.waitForTimeout(1500);
  ok(asked === 1, `three files, two already existing: asked once (${asked})`);
  ok(store.get('scores/A.musicxml').equals(two) && store.get('scores/B.musicxml').equals(two) && store.has('scores/C.musicxml'), 'the answer (replace) was applied to both existing files and the new one was added');
  // two PDFs: one question about what to do
  let pdfAsked = 0; await page.exposeFunction('__p', () => { pdfAsked++; });
  await page.evaluate(() => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.tagName === 'DIALOG' && n.textContent.includes('这份 PDF 怎么处理') && window.__p()))).observe(document.body, { childList: true }));
  await page.evaluate(() => (window.__noAuto = true));
  const pdf = fs.readFileSync(D + 'Test-Piece-for-OCR.pdf');
  await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', [{ name: 'P1.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'P2.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await page.waitForSelector('dialog:has-text("这份 PDF 怎么处理")'); await page.click('dialog button:has-text("只保留 PDF")');
  await page.waitForTimeout(3000);
  ok(pdfAsked === 1 && store.has('pdfs/P1.pdf') && store.has('pdfs/P2.pdf'), `two PDFs: asked once (${pdfAsked}) and both were kept`);
  // a single file still behaves as before (no "same for all" row)
  await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', [xml('A.musicxml', one)]);
  await page.waitForSelector('dialog:has-text("文件名重复")'); ok(await page.locator('dialog input[type=checkbox]').count() === 0, 'one file: no "same for all" option');
  await page.click('dialog button:has-text("取消")');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
