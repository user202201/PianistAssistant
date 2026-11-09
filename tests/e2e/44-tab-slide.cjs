// The highlight of the chosen home tab is a drop of liquid flowing to the new tab: the old end shrinks and disappears, the new end grows, a thin
// neck joins them (so it never looks as if several tabs were chosen at once); it keeps its size while flowing; it ends exactly on the new tab.
// With the "reduce motion" setting of the system it just jumps.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const mk = () => new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')], ['pdfs/p.pdf', Buffer.from('%PDF')]]);
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, w: r.width, r: r.right }; }, sel);
const near = (a, b) => Math.abs(a - b) <= 1.5;
// records the outline in every frame while switching from the first to another tab
const flow = (page, to) => page.evaluate((to) => new Promise((res) => {
  const g = document.querySelector('.tabsbar .group'), path = g.querySelector('.tabgoo path'), svg = g.querySelector('.tabgoo'), H = g.clientHeight, out = [];
  const thick = (x) => { let n = 0; for (let y = 0; y < H; y += 2) if (path.isPointInFill(new DOMPoint(x, y))) n += 2; return n; };
  const t0 = performance.now();
  const tick = () => {
    const sliding = g.classList.contains('sliding');
    if (sliding && path.getAttribute('d')) { const bb = path.getBBox(); let area = 0, wide = 0; for (let x = bb.x; x < bb.x + bb.width; x += 8) { const k = thick(x + 4); area += k * 8; if (k > (H - 12) * 0.5) wide += 8; } out.push({ t: performance.now() - t0, x: bb.x, w: bb.width, neck: thick(bb.x + bb.width / 2), area, wide, cls: g.className, H }); }
    if (performance.now() - t0 < 1100) requestAnimationFrame(tick); else res({ out, endSliding: g.classList.contains('sliding'), svgShown: getComputedStyle(svg).display !== 'none' });
  };
  requestAnimationFrame(tick); document.querySelector(`.tabsbar .seg[data-k=${to}]`).click();
}), to);
(async () => {
  let { browser, page } = await h.start(mk(), { context: { viewport: { width: 1194, height: 800 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.tabsbar .tabblob'); await page.waitForTimeout(500);
  let blob = await rect(page, '.tabsbar .tabblob'), tab = await rect(page, '.tabsbar .seg.on');
  ok(near(blob.l, tab.l) && near(blob.w, tab.w), `at rest the highlight sits exactly on the chosen tab (${Math.round(blob.l)}/${Math.round(blob.w)} vs ${Math.round(tab.l)}/${Math.round(tab.w)})`);
  const tabW = tab.w; const H = await page.evaluate(() => document.querySelector('.tabsbar .group').clientHeight);

  // from the first to the last tab (the case in which it used to look as if all four were chosen)
  const r = await flow(page, 'fav'); const fr = r.out;
  ok(fr.length >= 15, `the flow is animated (${fr.length} frames)`);
  const slimmest = Math.min(...fr.map(f => f.neck));
  ok(slimmest <= (H - 12) * 0.45, `in the middle it is thin: the neck is ${slimmest}px of ${H - 12}px`);
  ok(Math.max(...fr.map(f => f.w)) > tabW * 2.5, `it flows across the tabs between (outline up to ${Math.round(Math.max(...fr.map(f => f.w)))}px wide, one tab is ${Math.round(tabW)}px)`);
  ok(Math.max(...fr.map(f => f.wide)) <= tabW * 1.6, `the thick parts add up to about one tab, never several (${Math.round(Math.max(...fr.map(f => f.wide)))}px of thick liquid, one tab is ${Math.round(tabW)}px)`);
  ok(!fr.some(f => /icons|dense|tight|as-select/.test(f.cls)), 'the names stay names while it flows');
  const target = await rect(page, '.tabsbar .seg[data-k=fav]'); blob = await rect(page, '.tabsbar .tabblob');
  ok(!r.endSliding && !r.svgShown && near(blob.l, target.l) && near(blob.w, target.w), `it ends exactly on the new tab, the liquid is gone (${Math.round(blob.l)}/${Math.round(blob.w)} vs ${Math.round(target.l)}/${Math.round(target.w)})`);
  ok(await page.evaluate(() => document.querySelector('.tabsbar .seg.on').getAttribute('data-k')) === 'fav', 'the chosen tab and its list changed too');
  // back to the first one (the other direction)
  const r2 = await flow(page, 'all'); const first = await rect(page, '.tabsbar .seg[data-k=all]'); blob = await rect(page, '.tabsbar .tabblob');
  ok(r2.out.length >= 15 && Math.min(...r2.out.map(f => f.neck)) <= (H - 12) * 0.45 && near(blob.l, first.l), 'the same flowing to the left');
  // quick clicks one after the other: it ends on the last tab, nothing stays stuck
  await page.click('.tabsbar .seg[data-k=duet]'); await page.waitForTimeout(150); await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForTimeout(1100);
  const last = await rect(page, '.tabsbar .seg[data-k=pdf]'); blob = await rect(page, '.tabsbar .tabblob');
  ok(near(blob.l, last.l) && near(blob.w, last.w) && !(await page.evaluate(() => /sliding/.test(document.querySelector('.tabsbar .group').className))), 'two quick clicks in a row: it ends exactly on the last tab and nothing is left half way');
  // the highlight follows a window size change without animating
  await page.setViewportSize({ width: 820, height: 800 }); await page.waitForTimeout(500);
  blob = await rect(page, '.tabsbar .tabblob'); tab = await rect(page, '.tabsbar .seg.on'); ok(near(blob.l, tab.l) && near(blob.w, tab.w), 'after the window changed its size it is still on the tab');
  await browser.close();

  // reduce motion: no flowing
  ({ browser, page } = await h.start(mk(), { context: { viewport: { width: 1194, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' } }));
  await page.waitForSelector('.tabsbar .tabblob'); await page.waitForTimeout(400);
  await page.click('.tabsbar .seg[data-k=duet]'); await page.waitForTimeout(60);
  blob = await rect(page, '.tabsbar .tabblob'); tab = await rect(page, '.tabsbar .seg.on');
  ok(near(blob.l, tab.l) && near(blob.w, tab.w) && !(await page.evaluate(() => document.querySelector('.tabsbar .group').classList.contains('sliding'))), 'with "reduce motion" the highlight is on the new tab at once');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
