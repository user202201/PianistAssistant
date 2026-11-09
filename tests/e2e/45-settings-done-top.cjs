// The settings are long: closing them needed a scroll down to the "Done" at the bottom. Now the title bar sticks to the top with a second "Done".
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 440, height: 560 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.card');
  const openSettings = async () => { await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog.dlg #done-top'); await page.waitForTimeout(300); };
  const vis = () => page.evaluate(() => { const d = document.querySelector('dialog.dlg'); const dr = d.getBoundingClientRect(); const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= dr.top - 1 && r.bottom <= dr.bottom + 1; };
    const bottom = [...d.querySelectorAll('button.primary')].find((b) => b.id !== 'done-top'); return { scrolls: d.scrollHeight > d.clientHeight + 20, top: inView(d.querySelector('#done-top')), bottom: !!bottom && inView(bottom), y: Math.round(d.scrollTop), max: d.scrollHeight - d.clientHeight, title: inView(d.querySelector('#settings-head h2')) }; });
  await openSettings(); let v = await vis();
  ok(v.scrolls, 'the settings are longer than the window (they scroll)');
  ok(v.top && v.title && !v.bottom, 'at the top: "Done" is in the title bar, the bottom one is out of sight');
  const fadeShown = () => page.evaluate(() => { const f = document.querySelector('.dlgfade'); const r = f.getBoundingClientRect(); const d = document.querySelector('dialog.dlg').getBoundingClientRect(); return getComputedStyle(f).display !== 'none' && r.height > 20 && r.bottom <= d.bottom + 26 && r.bottom >= d.bottom - 4; });
  ok(await fadeShown(), 'at the top a soft fade at the bottom edge says "there is more below" (touch screens hide the scroll bar)');
  await page.evaluate(() => { const d = document.querySelector('dialog.dlg'); d.scrollTop = (d.scrollHeight - d.clientHeight) / 2; }); await page.waitForTimeout(250); v = await vis();
  ok(v.top && v.y > 50, `scrolled to the middle: the "Done" in the title bar is still there (scrolled ${v.y}px)`);
  ok(await page.evaluate(() => document.querySelector('#settings-head').classList.contains('scrolled')), 'the title bar gets a thin line once content slides under it');
  await page.evaluate(() => { const d = document.querySelector('dialog.dlg'); d.scrollTop = d.scrollHeight; }); await page.waitForTimeout(250); v = await vis();
  ok(v.top && v.bottom && !(await fadeShown()), 'at the bottom: both "Done" buttons are there and the fade is gone');
  await page.click('#done-top'); await page.waitForTimeout(300);
  ok(await page.locator('dialog.dlg').count() === 0, 'the top "Done" closes the settings (while scrolled to the bottom)');
  await openSettings(); await page.evaluate(() => { const d = document.querySelector('dialog.dlg'); d.scrollTop = d.scrollHeight; }); await page.waitForTimeout(250);
  await page.evaluate(() => [...document.querySelectorAll('dialog.dlg button.primary')].find((b) => b.id !== 'done-top').click()); await page.waitForTimeout(300);
  ok(await page.locator('dialog.dlg').count() === 0, 'and the bottom "Done" still works');
  // a tall window: nothing to scroll, no fade
  await page.setViewportSize({ width: 440, height: 1400 }); await openSettings(); await page.waitForTimeout(300);
  ok(!(await vis()).scrolls && !(await page.evaluate(() => document.querySelector('dialog.dlg').classList.contains('more'))), 'when everything fits there is no fade');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
