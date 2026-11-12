const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const pdf = fs.readFileSync(D + 'Test-Piece-for-OCR.pdf');
  const store = new Map();
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.home'); await page.evaluate(() => (window.__noAuto = true));
  const up = async (name, engine) => {
    await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', { name, mimeType: 'application/pdf', buffer: pdf });
    await page.waitForSelector('dialog:has-text("这份 PDF 怎么处理")');
    await page.selectOption('#pdf-mode', 'convert'); if (engine) await page.selectOption('#pdf-engine', engine);
    await page.click('#pdf-go'); await page.waitForTimeout(1800);
  };
  await up('Default.pdf');
  ok(store.has('inbox/Default.pdf') && !store.has('inbox/Default.pdf.engine.txt'), 'default engine (Audiveris): no engine note, as before');
  await up('Deep.pdf', 'homr');
  ok(store.has('inbox/Deep.pdf') && store.get('inbox/Deep.pdf.engine.txt')?.toString() === 'homr', 'homr chosen: the engine note says homr and the PDF is queued');
  // oemer produced no result on any of our scores: not offered any more; a remembered "oemer" / "all" becomes Audiveris
  ok(await page.evaluate(() => [...document.querySelectorAll('select')].length === 0), 'no question open yet');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.ocrEngine = 'oemer'; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.home'); await page.evaluate(() => (window.__noAuto = true));
  await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', { name: 'Old.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('dialog:has-text("这份 PDF 怎么处理")');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#pdf-engine option')].map((o) => o.value));
  ok(opts.join(',') === 'audiveris,homr,both', 'the engine list: Audiveris, homr, both (' + opts.join(',') + ')');
  ok(await page.inputValue('#pdf-engine') === 'audiveris', 'a remembered "oemer" becomes Audiveris');
  await page.click('#pdf-cancel'); await page.waitForTimeout(300);
  await up('Both.pdf', 'both');
  ok(store.get('inbox/Both.pdf.engine.txt')?.toString() === 'both', 'Audiveris + homr chosen: "both"');
  // the choice is remembered; the order of the two commits matters (the note first, then the file that starts the converter)
  await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', { name: 'Again.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('dialog:has-text("这份 PDF 怎么处理")');
  ok(await page.inputValue('#pdf-engine') === 'both', 'the engine choice is remembered for the next upload');
  await page.click('#pdf-cancel');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
