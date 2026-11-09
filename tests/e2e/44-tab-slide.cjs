// The highlight of the chosen home tab slides to the new tab like a drop of water: stretched across both tabs, a little bounce, then still.
// With the "reduce motion" setting of the system it just jumps.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const mk = () => new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')], ['pdfs/p.pdf', Buffer.from('%PDF')]]);
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, w: r.width, r: r.right }; }, sel);
(async () => {
  let { browser, page } = await h.start(mk(), { context: { viewport: { width: 1194, height: 800 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.tabsbar .tabblob'); await page.waitForTimeout(500);
  const near = (a, b) => Math.abs(a - b) <= 1.5;
  let blob = await rect(page, '.tabsbar .tabblob'), tab = await rect(page, '.tabsbar .seg.on');
  ok(near(blob.l, tab.l) && near(blob.w, tab.w), `at rest the highlight sits exactly on the chosen tab (${Math.round(blob.l)}/${Math.round(blob.w)} vs ${Math.round(tab.l)}/${Math.round(tab.w)})`);
  // record the blob in every frame while switching to the third tab
  const trail = await page.evaluate(() => new Promise((res) => { const b = document.querySelector('.tabsbar .tabblob'); const out = []; const t0 = performance.now();
    const tick = () => { const r = b.getBoundingClientRect(); out.push({ t: performance.now() - t0, l: r.left, w: r.width }); if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(out); };
    requestAnimationFrame(tick); document.querySelector('.tabsbar .seg[data-k=pdf]').click(); }));
  const target = await rect(page, '.tabsbar .seg[data-k=pdf]'); const start = trail[0];
  ok(Math.max(...trail.map(s => s.w)) > start.w * 1.5, `it stretches across the tabs on its way (widest ${Math.round(Math.max(...trail.map(s => s.w)))}px, normal ${Math.round(start.w)}px)`);
  ok(trail.some(s => s.l > start.l + 20 && s.l < target.l - 20), 'it passes through the places in between (it slides, it does not jump)');
  // jelly: the front (right) edge goes a little past the new tab, comes back a little, and rests; small, not a show
  const right = trail.map(s => s.l + s.w); const tr = target.l + target.w; const peak = Math.max(...right); const peakAt = right.indexOf(peak);
  const back = Math.min(...right.slice(peakAt)); const afterBack = right.slice(right.indexOf(back));
  ok(peak > tr + 3 && peak < tr + 20, `it overshoots a little (${Math.round(peak - tr)}px past the new tab, at most 20)`);
  ok(back < tr - 0.5 && Math.max(...afterBack) > back + 0.5, `and wobbles back (${Math.round(tr - back)}px short of it) and forth before it rests`);
  const last = trail[trail.length - 1]; ok(near(last.l, target.l) && near(last.w, target.w), `and ends exactly on the new tab (${Math.round(last.l)}/${Math.round(last.w)} vs ${Math.round(target.l)}/${Math.round(target.w)})`);
  ok(await page.evaluate(() => document.querySelector('.tabsbar .seg.on').getAttribute('data-k')) === 'pdf', 'the chosen tab and its list changed too');
  // the highlight follows a window size change without animating
  await page.setViewportSize({ width: 820, height: 800 }); await page.waitForTimeout(500);
  blob = await rect(page, '.tabsbar .tabblob'); tab = await rect(page, '.tabsbar .seg.on'); ok(near(blob.l, tab.l) && near(blob.w, tab.w), 'after the window changed its size it is still on the tab');
  await browser.close();

  // reduce motion: no sliding
  ({ browser, page } = await h.start(mk(), { context: { viewport: { width: 1194, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' } }));
  await page.waitForSelector('.tabsbar .tabblob'); await page.waitForTimeout(400);
  await page.click('.tabsbar .seg[data-k=duet]'); await page.waitForTimeout(60);
  blob = await rect(page, '.tabsbar .tabblob'); tab = await rect(page, '.tabsbar .seg.on');
  ok(near(blob.l, tab.l) && near(blob.w, tab.w), 'with "reduce motion" the highlight is on the new tab at once');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
