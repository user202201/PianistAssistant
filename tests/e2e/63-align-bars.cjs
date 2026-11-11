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
  const state = () => page.evaluate(() => { const b = document.querySelector('footer.controls button[title="对齐小节"]'); return b && { icon: !!b.querySelector('svg'), on: b.classList.contains('on'), arrow: !!document.querySelector('footer.controls button[title="对齐选项"]') }; });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((x) => x.innerText));
  const btn = await state();
  ok(btn && btn.icon && !btn.on && btn.arrow, 'the bottom bar of a four-hand piece has an "align bars" icon button with a small arrow, like the fingering button (off by default)');
  ok(await page.evaluate(() => ![...document.querySelectorAll('dialog')].some((d) => d.innerText.includes('对齐小节'))), 'it is not in the general Settings');
  // one tap: on, with 4 bars per line, and the first time a hint about the arrow
  await page.click('footer.controls button[title="对齐小节"]'); await page.waitForTimeout(2500);
  let on = await lines(); console.log('aligned lines', JSON.stringify(on));
  ok(JSON.stringify(on[0]) === JSON.stringify(on[1]) && on[0].length > 1 && on[0].slice(0, -1).every((n, i) => on[0][i + 1] - n === 4), 'one tap switches it on: both parts start every line with the same bar number, 4 bars per line');
  ok((await state()).on && !(await page.isVisible('footer.controls .panel:not([hidden])')), 'the button is blue, and no panel opened by itself');
  ok((await toasts()).some((x) => x.includes('小箭头')), 'the first time a message says how to change the number (the small arrow)');
  const b1 = await bar();
  ok(b1.h === b0.h && b1.rowsTop === b0.rowsTop, `the bar did not grow (${b0.h} -> ${b1.h} px)`);
  await page.screenshot({ path: D + 'align-bars.png' });
  // a second tap: off again
  await page.click('footer.controls button[title="对齐小节"]'); await page.waitForTimeout(2500);
  ok(JSON.stringify(await lines()) === JSON.stringify(off) && !(await state()).on, 'a second tap switches it off: each part is laid out on its own again');
  ok((await toasts()).some((x) => x.includes('已取消对齐')), 'and says so');
  // third tap: on again, the hint is not shown a second time
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((x) => x.remove()));
  await page.click('footer.controls button[title="对齐小节"]'); await page.waitForTimeout(2500);
  ok(!(await toasts()).some((x) => x.includes('小箭头')) && (await toasts()).some((x) => x.includes('每行 4 小节')), 'switched on again: a short message with the number, the hint only came once');
  // the arrow: choose another number; it is remembered
  await page.click('footer.controls button[title="对齐选项"]'); await page.waitForTimeout(250);
  ok(await page.isVisible('footer.controls .panel:not([hidden]) .seg'), 'the small arrow opens the choice (2 / 3 / 4 / 6)');
  await page.click('footer.controls .panel:not([hidden]) .seg:text-is("2")'); await page.waitForTimeout(2500);
  const two = await lines();
  ok(JSON.stringify(two[0]) === JSON.stringify(two[1]) && two[0].slice(0, -1).every((n, i) => two[0][i + 1] - n === 2), '2 bars per line in both parts');
  await page.mouse.click(600, 120); await page.waitForTimeout(300);
  await page.click('footer.controls button[title="对齐小节"]'); await page.waitForTimeout(2200); // off
  await page.click('footer.controls button[title="对齐小节"]'); await page.waitForTimeout(2500); // on again: with the last choice
  const again = await lines();
  ok(again[0].slice(0, -1).every((n, i) => again[0][i + 1] - n === 2), 'off and on again: it uses the number chosen last (2)');
  await page.reload(); await page.waitForSelector('.pane', { timeout: 20000 }); await page.waitForTimeout(2500);
  ok(JSON.stringify(await lines()) === JSON.stringify(again) && (await state()).on, 'remembered after a reload, the icon shows it is on');
  await page.setViewportSize({ width: 820, height: 1100 }); await page.waitForTimeout(800);
  ok(await page.evaluate(() => { const c = document.querySelector('footer.controls').getBoundingClientRect(); return c.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; }), 'iPad portrait: the bar still fits, no sideways scrolling');
  await page.evaluate(() => (location.hash = '#/score/Ode_Primo.musicxml')); await page.waitForSelector('footer.controls', { timeout: 20000 }); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !document.querySelector('footer.controls button[title="对齐小节"]')), 'a single score has no such button');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
