const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const one = fs.readFileSync(D + 'single.musicxml');
(async () => {
  const store = new Map([
    ['scores/plain.musicxml', one],
    ['inbox/old.pdf', Buffer.from('x')],            // queued 30 min ago, nothing happened
    ['inbox/f.pdf', Buffer.from('x')], ['inbox/f.pdf.failed.txt', Buffer.from('Conversion failed')],
  ]);
  const { browser, page, puts } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true }, commitDates: { 'old.pdf': Date.now() - 30 * 60000, 'f.pdf': Date.now() - 2 * 60000 } });
  await page.waitForSelector('.card.stalled');
  ok(await page.isVisible('.banner.warn') && !(await page.isVisible('.banner:not(.warn):not([hidden])')), 'stalled item: amber warning replaces the "please wait" banner');
  const t = await page.textContent('.card.stalled');
  ok(t.includes('已等待 30 分钟') && t.includes('可能卡住'), `stalled card says how long it waited: "${t.trim().slice(0, 30)}…"`);
  await page.screenshot({ path: D + 'stalled.png' });
  ok(await page.locator('.card.stalled button[title=重试]').count() === 1 && await page.locator('.card.failed button[title=重试]').count() === 1, 'stalled and failed cards both offer Retry');

  // retry a stalled one
  await page.click('.card.stalled button[title=重试]');
  await page.waitForFunction(() => document.querySelectorAll('.card.stalled').length === 0);
  ok(store.has('inbox/old.pdf.retry.txt'), 'retry writes a marker file (this is what triggers the workflow)');
  ok((await page.textContent('.card.busy')).includes('转换中') && await page.isVisible('.banner:not(.warn)'), 'after retry it is "converting" again with a fresh timer');

  // retry a failed one
  await page.click('.card.failed button[title=重试]');
  await page.waitForFunction(() => document.querySelectorAll('.card.failed').length === 0);
  ok(!store.has('inbox/f.pdf.failed.txt') && store.has('inbox/f.pdf.retry.txt'), 'retry on a failed item clears the failure note and writes the marker');

  // server finishes both -> "new" badge, then cleared when opened
  for (const n of ['old', 'f']) { store.delete(`inbox/${n}.pdf`); store.delete(`inbox/${n}.pdf.retry.txt`); store.set(`scores/${n}.musicxml`, one); }
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('转换完成')), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.open.isnew').length === 2);
  ok(true, 'finished conversions get a "新" badge in the list');
  await page.screenshot({ path: D + 'done.png' });
  await page.click('.card .open.isnew >> nth=0'); await page.waitForSelector('.controls .big');
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.waitForFunction(() => document.querySelectorAll('.open.isnew').length === 1, null, { timeout: 8000 }).catch(() => {});
  ok(await page.locator('.open.isnew').count() === 1, 'opening a converted score clears its badge');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
