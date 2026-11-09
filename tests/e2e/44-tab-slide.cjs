// The highlight of the chosen home tab slides to the new tab: stretched across both, see-through while it is stretched over the tabs in between
// (so it never looks as if several tabs were chosen), solid again when it arrives, with a small jelly wobble. "Reduce motion": it just jumps.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const mk = () => new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')], ['pdfs/p.pdf', Buffer.from('%PDF')]]);
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, w: r.width, r: r.right }; }, sel);
const near = (a, b) => Math.abs(a - b) <= 1.5;
const flow = (page, to) => page.evaluate((to) => new Promise((res) => { const b = document.querySelector('.tabsbar .tabblob'), g = document.querySelector('.tabsbar .group'); const out = []; const t0 = performance.now();
  const tick = () => { const r = b.getBoundingClientRect(); out.push({ t: performance.now() - t0, l: r.left, w: r.width, op: parseFloat(getComputedStyle(b).opacity), cls: g.className }); if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(out); };
  requestAnimationFrame(tick); document.querySelector(`.tabsbar .seg[data-k=${to}]`).click(); }), to);
(async () => {
  let { browser, page } = await h.start(mk(), { context: { viewport: { width: 1194, height: 800 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.tabsbar .tabblob'); await page.waitForTimeout(500);
  let blob = await rect(page, '.tabsbar .tabblob'), tab = await rect(page, '.tabsbar .seg.on');
  ok(near(blob.l, tab.l) && near(blob.w, tab.w), `at rest the highlight sits exactly on the chosen tab (${Math.round(blob.l)}/${Math.round(blob.w)} vs ${Math.round(tab.l)}/${Math.round(tab.w)})`);
  const tabW = tab.w;
  // first tab -> last tab (the case in which it looked as if all four were chosen)
  let fr = await flow(page, 'fav');
  const widest = fr.reduce((m, f) => (f.w > m.w ? f : m), fr[0]);
  ok(widest.w > tabW * 2.5, `it stretches across the tabs on its way (${Math.round(widest.w)}px, one tab is ${Math.round(tabW)}px)`);
  ok(widest.op <= 0.6, `and is see-through there (opacity ${widest.op.toFixed(2)}), so it does not look like several chosen tabs`);
  ok(fr[0].op >= 0.9 && fr[fr.length - 1].op === 1, 'it starts and ends solid');
  const ops = fr.map(f => f.op); const iw = fr.indexOf(widest);
  ok(ops.slice(iw).every((o, i, a) => i === 0 || o >= a[i - 1] - 0.02), 'after the widest point it gets solid again gradually (no jumps)');
  ok(fr.some(f => f.l > fr[0].l + 20 && f.l + f.w < fr[fr.length - 1].l + 400 && f.l < fr[fr.length - 1].l - 20), 'it slides through the places in between (no jump)');
  const target = await rect(page, '.tabsbar .seg[data-k=fav]'); const right = fr.map(f => f.l + f.w), tr = target.l + target.w; const peak = Math.max(...right);
  ok(peak > tr + 2 && peak < tr + 20, `a small jelly wobble: the front edge goes ${Math.round(peak - tr)}px past the new tab (at most 20) and comes back`);
  blob = await rect(page, '.tabsbar .tabblob'); ok(near(blob.l, target.l) && near(blob.w, target.w), `it ends exactly on the new tab (${Math.round(blob.l)}/${Math.round(blob.w)} vs ${Math.round(target.l)}/${Math.round(target.w)})`);
  ok(!fr.some(f => /icons|dense|tight|as-select/.test(f.cls)), 'the names stay names while it moves');
  ok(await page.evaluate(() => document.querySelector('.tabsbar .seg.on').getAttribute('data-k')) === 'fav', 'the chosen tab and its list changed too');
  fr = await flow(page, 'all'); const first = await rect(page, '.tabsbar .seg[data-k=all]'); blob = await rect(page, '.tabsbar .tabblob');
  ok(Math.min(...fr.map(f => f.op)) <= 0.6 && near(blob.l, first.l), 'the same in the other direction');
  await page.click('.tabsbar .seg[data-k=duet]'); await page.waitForTimeout(150); await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForTimeout(1100);
  const last = await rect(page, '.tabsbar .seg[data-k=pdf]'); blob = await rect(page, '.tabsbar .tabblob');
  ok(near(blob.l, last.l) && near(blob.w, last.w) && await page.evaluate(() => getComputedStyle(document.querySelector('.tabsbar .tabblob')).opacity) === '1', 'two quick clicks in a row: it ends exactly on the last tab, solid');
  await page.setViewportSize({ width: 820, height: 800 }); await page.waitForTimeout(500);
  blob = await rect(page, '.tabsbar .tabblob'); tab = await rect(page, '.tabsbar .seg.on'); ok(near(blob.l, tab.l) && near(blob.w, tab.w), 'after the window changed its size it is still on the tab');
  await browser.close();
  ({ browser, page } = await h.start(mk(), { context: { viewport: { width: 1194, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' } }));
  await page.waitForSelector('.tabsbar .tabblob'); await page.waitForTimeout(400);
  await page.click('.tabsbar .seg[data-k=duet]'); await page.waitForTimeout(60);
  blob = await rect(page, '.tabsbar .tabblob'); tab = await rect(page, '.tabsbar .seg.on');
  ok(near(blob.l, tab.l) && near(blob.w, tab.w), 'with "reduce motion" the highlight is on the new tab at once');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
