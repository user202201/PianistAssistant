const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')], ['scores/never opened.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['pdfs/a.pdf', fs.readFileSync(D + 'Test-Piece-for-OCR.pdf')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.card'); await page.waitForTimeout(2500); // the library is copied to the device in the background
  const cached = await page.evaluate(async () => (await (await caches.open('pianist-data-v1')).keys()).map(r => decodeURIComponent(r.url.split('/').slice(-2).join('/'))));
  ok(cached.includes('scores/long.musicxml') && cached.includes('scores/never opened.musicxml') && cached.includes('pdfs/a.pdf'), `every score and PDF was copied to the device: ${cached.join(', ')}`);
  // now GitHub cannot be reached
  await page.route('**/api.github.com/**', r => r.abort('internetdisconnected'));
  await page.reload(); await page.waitForSelector('.card', { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.waitForFunction(() => [...document.querySelectorAll('.listbox .card')].length >= 2, null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => { const t = [...document.querySelectorAll('.listbox .card')].map(c => c.textContent).join('|'); return t.includes('long') && t.includes('never opened'); }), 'offline: the library list is still there');
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('离线'))), 'offline: a notice explains it');
  await page.evaluate(() => (location.hash = '#/score/never%20opened.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => window.__pianist?.score?.measureCount > 0), 'offline: a score opens from the copy on the device');
  await page.evaluate(() => (location.hash = '#/pdf/a.pdf')); await page.waitForSelector('.pdfpage', { timeout: 20000 });
  ok(true, 'offline: a PDF opens from the copy on the device');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
