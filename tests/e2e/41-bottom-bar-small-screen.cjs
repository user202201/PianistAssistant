// Small screens: the bottom bar is compact (icons instead of names); it can shrink to the essentials (play / pause + speed) and hide completely
// (a small handle with play / pause and "show the bar" stays). A wide screen keeps the full bar.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    const bar = box('.controls'); const wrap = box('.scorewrap') || box('.scrollwrap');
    return { bar: !!bar, barH: bar ? Math.round(bar.height) : 0, play: !!box('.controls .play'), speed: !!box('.controls .speed'), practice: !!box('.controls button[title=练习]') || !!box('.controls button[title=Practice]'), more: !!box('.morebtn'), hide: !!box('.hidebtn'),
      handle: !!box('.barhandle'), miniplay: !!box('.miniplay'), lblShown: [...document.querySelectorAll('.controls .lbl')].some((l) => l.getBoundingClientRect().width > 0), mode: JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}').barMode ?? null, scoreH: wrap ? Math.round(wrap.height) : 0, overflow: document.documentElement.scrollWidth - 390 };
  });
  let s = await st();
  ok(s.bar && s.play && s.speed && s.practice && s.more && !s.lblShown, `phone: the full bar is compact, names are replaced by icons (${s.barH}px tall)`);
  ok(s.overflow <= 1, 'and nothing is pushed off the screen');
  await page.click('.morebtn'); await page.waitForTimeout(300); s = await st();
  ok(s.play && s.speed && !s.practice && s.hide && s.barH < 110, `"less": only play / pause + speed remain (${s.barH}px tall)`);
  const minH = s.scoreH;
  await page.click('.hidebtn'); await page.waitForTimeout(400); s = await st();
  ok(!s.bar && s.handle && s.miniplay, 'hide: the bar is gone, only a small handle is left');
  ok(s.scoreH > minH, `the score gets the room (${minH} -> ${s.scoreH}px)`);
  await page.click('.miniplay'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => window.__pianist.player.playing), 'the handle starts playing');
  await page.click('.miniplay'); await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => window.__pianist.player.playing)), 'and pauses');
  ok(s.mode === 'hidden', 'the choice is remembered');
  await page.click('.expandbtn'); await page.waitForTimeout(300); s = await st();
  ok(s.bar && s.play && s.speed && !s.handle, 'the handle brings the bar back');
  await page.click('.morebtn'); await page.waitForTimeout(300); s = await st(); ok(s.practice && s.hide === false, '"more" shows everything again');
  // a wide screen: full bar, nothing to fold
  await page.setViewportSize({ width: 1194, height: 834 }); await page.waitForTimeout(700); s = await st();
  ok(s.bar && s.play && s.speed && s.practice && !s.more && !s.hide && !s.handle && s.lblShown, 'a tablet keeps the full bar with names');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
