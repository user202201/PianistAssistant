const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + (process.env.SC || 'long.musicxml'))]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/score/long.musicxml')); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(1500);
  const n = () => page.evaluate(() => document.querySelectorAll('.fbadge').length);
  const both = await n();
  await page.click('.handstrip button.hand[title="右手"]'); await page.waitForTimeout(700); const r = await n();
  await page.click('.handstrip button.hand[title="左手"]'); await page.waitForTimeout(700); const l = await n();
  await page.click('.handstrip button.hand[title="双手"]'); await page.waitForTimeout(700); const b2 = await n();
  console.log({ both, r, l, b2 });
  ok(both > 0 && r > 0 && l > 0 && r < both && l < both, 'right / left hand show only their own fingering');
  ok(Math.abs(r + l - both) <= 2 && b2 === both, 'both hands shows all again');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
