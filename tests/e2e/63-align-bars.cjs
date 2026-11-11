// Four hands: setting "align bars" = the same number of bars per line in both parts, so the bar lines of A and B stand above each other.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1180, height: 900 } } });
  const open = async () => { await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.reload(); await page.waitForSelector('.pane', { timeout: 20000 }); await page.waitForTimeout(2500); };
  // the bar number each line of each part starts with, and how many bars per line
  const lines = () => page.evaluate(() => window.__pianist.views.map((v) => { const sys = v.osmd.GraphicSheet.MusicPages.flatMap((p) => p.MusicSystems); return sys.map((s) => s.GraphicalMeasures[0].map((m) => m.MeasureNumber)).map((a) => a.length ? a[0] : 0); }));
  const perLine = (page2) => page2;
  await open();
  const off = await lines();
  console.log('default lines', JSON.stringify(off));
  await open();
  const bar = () => page.evaluate(() => { const c = document.querySelector('footer.controls'); const r = c.getBoundingClientRect(); const rows = [...c.querySelectorAll('.row')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().top >= r.top - 1); return { h: Math.round(r.height), rowsTop: new Set(rows.map((e) => Math.round(e.getBoundingClientRect().top))).size }; });
  const b0 = await bar();
  const btn = await page.evaluate(() => { const b = document.querySelector('footer.controls button[title="对齐小节"]'); return b && { icon: !!b.querySelector('svg'), on: b.classList.contains('on') }; });
  ok(btn && btn.icon && !btn.on, 'the bottom bar of a four-hand piece has an "align bars" icon button (off by default)');
  ok(await page.evaluate(() => ![...document.querySelectorAll('dialog')].some((d) => d.innerText.includes('对齐小节'))), 'it is not in the general Settings');
  await page.click('footer.controls button[title="对齐小节"]'); await page.waitForTimeout(300);
  ok(await page.isVisible('footer.controls .panel:not([hidden]) .seg'), 'it opens a small panel with the bars per line');
  await page.click('footer.controls .panel:not([hidden]) .seg:text-is("4")'); await page.waitForTimeout(2500);
  const on = await lines();
  console.log('aligned lines', JSON.stringify(on));
  ok(on.length === 2 && on[0].length > 1 && JSON.stringify(on[0]) === JSON.stringify(on[1]), 'with "4 bars per line" both parts start every line with the same bar number (no reload needed)');
  ok(on[0].slice(0, -1).every((n, i) => on[0][i + 1] - n === 4), 'and every line (but the last) has exactly 4 bars');
  const b1 = await bar();
  ok(b1.h === b0.h && b1.rowsTop === b0.rowsTop, `the bar did not grow (${b0.h} -> ${b1.h} px, panel closed or not)`);
  await page.screenshot({ path: D + 'align-bars.png' });
  await page.reload(); await page.waitForSelector('.pane', { timeout: 20000 }); await page.waitForTimeout(2500);
  ok(JSON.stringify(await lines()) === JSON.stringify(on) && await page.evaluate(() => document.querySelector('footer.controls button[title="对齐小节"]').classList.contains('on')), 'remembered after a reload, the icon shows it is on');
  await page.click('footer.controls button[title="对齐小节"]'); await page.click('footer.controls .panel:not([hidden]) .seg:text-is("关闭")'); await page.waitForTimeout(2500);
  ok(JSON.stringify(await lines()) === JSON.stringify(off), 'off: each part is laid out on its own again');
  await page.setViewportSize({ width: 820, height: 1100 }); await page.waitForTimeout(800);
  ok(await page.evaluate(() => { const c = document.querySelector('footer.controls').getBoundingClientRect(); return c.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; }), 'iPad portrait: the bar still fits, no sideways scrolling');
  await page.evaluate(() => (location.hash = '#/score/Ode_Primo.musicxml')); await page.waitForSelector('footer.controls', { timeout: 20000 }); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !document.querySelector('footer.controls button[title="对齐小节"]')), 'a single score has no such button');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
