const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/A.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')]]);
  const { browser, page } = await h.start(store, { rawDelay: 400, context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.listbox .card'); await page.waitForTimeout(800);
  const count = () => page.evaluate(() => document.querySelectorAll('#toasts .toast.working').length);
  await page.route(/\/contents\/scores/, async r => { await new Promise(x => setTimeout(x, 1500)); await r.fallback(); }); // a slow list
  let peak = 0; for (let i = 0; i < 5; i++) { await page.click('.top button[title]:has(svg) >> nth=0'); await page.waitForTimeout(80); peak = Math.max(peak, await count()); }
  ok(peak === 1, `five quick refreshes with a slow list show exactly ONE "refreshing" message (peak ${peak})`);
  await page.waitForFunction(() => document.querySelectorAll('#toasts .toast.working').length === 0, null, { timeout: 8000 }).catch(() => {});
  ok(await count() === 0, 'it disappears when the refresh is done (not after two minutes)');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
