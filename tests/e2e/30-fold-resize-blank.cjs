const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const long = fs.readFileSync(D + 'long.musicxml');
  const store = new Map([['scores/L1.musicxml', long], ['scores/L2.musicxml', long], ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'LL', a: 'L1.musicxml', b: 'L2.musicxml' }] }))]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/duet/L1.musicxml/L2.musicxml')); await page.waitForFunction(() => document.querySelectorAll('.pane').length === 2 && window.__pianist, null, { timeout: 15000 }); await page.waitForTimeout(1500);
  const widths = () => page.evaluate(() => window.__pianist.views.map(v => Math.round(v.holder.querySelector('svg')?.getBoundingClientRect().width || 0)));
  const w0 = await widths();
  await page.locator('.pane >> nth=1').locator('.pname').click(); await page.waitForTimeout(600); // I play B, A is folded
  // what an iPad does all the time: resize events (address bar, rotation, leaving full screen) while a part is folded away
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await page.waitForTimeout(1200);
  await page.evaluate(() => window.__setFocus(1)); await page.waitForTimeout(400); await page.evaluate(() => window.__setFocus(null)); await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await page.waitForTimeout(1200);
  await page.locator('.pane >> nth=0').locator('.collbtn').click(); await page.waitForTimeout(900); // show A again
  const w1 = await widths();
  ok(w1[0] > 500 && w1[1] > 500, `after folding, resizing, full screen on/off and showing A again, both scores are there (${w0} -> ${w1})`);
  await page.click('button[title^=播放]'); await page.waitForTimeout(2500);
  ok((await widths())[0] > 500, 'and still after pressing play');
  await page.click('button[title^=播放]');
  // a real window size change redraws the visible scores at the new width
  await page.setViewportSize({ width: 900, height: 834 }); await page.waitForTimeout(1500);
  const w2 = await widths(); ok(w2[0] > 500 && w2[0] < w1[0] - 100 && w2[1] < w1[1] - 100, `a narrower window: the scores are drawn again at the new width (${w1} -> ${w2})`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
