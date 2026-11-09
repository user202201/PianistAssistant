// Bug: in full screen with annotating on (and "finger draws too") there was no way to get the toolbar back, so full screen could not be left.
// A swipe down from the top edge shows the toolbar (it never draws), and a small button is always there.
const h = require('./harness.cjs'); const fs = require('fs'); const path = require('path');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['pdfs/Long3.pdf', fs.readFileSync(path.join(__dirname, '../../samples/ocr-lab/Long3.pdf'))]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/pdf/Long3.pdf')); await page.waitForFunction(() => document.querySelectorAll('.pdfsheet').length === 3, null, { timeout: 30000 }); await page.waitForTimeout(800);
  const chrome = () => page.locator('.pdfchrome').isVisible();
  const cdp = await page.context().newCDPSession(page);
  const touch = async (pts) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] }); for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(250); };
  // annotating, a finger draws, full screen: the situation in which one was stuck
  await page.click('.zone.left button'); await page.click('#finger-draw');
  await page.click('button[title^=全屏]'); await page.waitForTimeout(400);
  ok(!(await chrome()), 'full screen: the toolbar is hidden');
  ok(await page.locator('.fshandle').isVisible(), 'a small button is always there in full screen');
  // a tap in the middle now draws a dot (a finger draws): it must NOT be the way back
  const strokeCount = () => page.evaluate(() => { const c = document.querySelector('.pdfsheet:not([hidden]) .notes'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  const ink0 = await strokeCount();
  // swipe down from the very top edge
  await touch([{ x: 600, y: 6, id: 1 }, { x: 600, y: 40, id: 1 }, { x: 600, y: 90, id: 1 }, { x: 600, y: 160, id: 1 }]);
  ok(await chrome(), 'a swipe down from the top edge shows the toolbar (even while annotating with the finger)');
  ok((await strokeCount()) === ink0, 'and that swipe did not draw anything');
  ok(await page.evaluate(() => document.getElementById('app').classList.contains('show')), 'the toolbar is shown on top of the page');
  // leave full screen from the toolbar
  await page.click('.pdfchrome button[title^=全屏]'); await page.waitForTimeout(400);
  ok(!(await page.evaluate(() => document.getElementById('app').classList.contains('pdffull'))) && await chrome(), 'the full screen button there leaves full screen');
  // the small button works as well
  await page.click('button[title^=全屏]'); await page.waitForTimeout(400); ok(!(await chrome()), 'full screen again');
  await page.click('.fshandle'); await page.waitForTimeout(300); ok(await chrome(), 'the small button shows the toolbar');
  await page.click('.pdfchrome button[title^=全屏]'); await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => document.getElementById('app').classList.contains('pdffull'))), 'and the way out');
  // drawing with a finger still works in the middle of the page (the edge zone is only the top 30px)
  await page.click('button[title^=全屏]'); await page.waitForTimeout(300);
  await touch([{ x: 500, y: 300, id: 1 }, { x: 560, y: 320, id: 1 }, { x: 620, y: 330, id: 1 }]);
  ok((await strokeCount()) > ink0 + 20, 'a finger still draws in the middle of the page');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
