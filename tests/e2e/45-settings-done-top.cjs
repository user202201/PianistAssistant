// The settings are long. The title bar with "Done" stays where it is, only the part below it scrolls (a pull down on a tablet used to drag the
// whole dialog, title bar included, like a "pull to refresh"); there is no second Done at the bottom; a soft fade says "there is more below".
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 440, height: 560 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.card');
  const openSettings = async () => { await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog.dlg #done-top'); await page.waitForTimeout(300); };
  const st = () => page.evaluate(() => { const d = document.querySelector('dialog.dlg'), b = d.querySelector('.dlgbody'), hd = d.querySelector('#settings-head'); const f = d.querySelector('.dlgfade'); const fr = f.getBoundingClientRect(), dr = d.getBoundingClientRect();
    return { bodyScrolls: b.scrollHeight > b.clientHeight + 20, dlgScrolls: d.scrollHeight > d.clientHeight + 1, headTop: Math.round(hd.getBoundingClientRect().top * 10) / 10, y: Math.round(b.scrollTop), doneTop: Math.round(d.querySelector('#done-top').getBoundingClientRect().top * 10) / 10,
      dones: [...d.querySelectorAll('button')].filter((x) => x.textContent.trim() === '完成').length, fade: getComputedStyle(f).display !== 'none' && fr.height > 20 && fr.bottom <= dr.bottom + 2 && fr.bottom >= dr.bottom - 4, line: hd.classList.contains('scrolled'), overscroll: getComputedStyle(b).overscrollBehaviorY }; });
  await openSettings(); let v = await st(); const top0 = v.headTop, done0 = v.doneTop;
  ok(v.bodyScrolls && !v.dlgScrolls, 'the part below the title bar scrolls, the dialog itself does not');
  ok(v.dones === 1, 'there is ONE "Done" (in the title bar), none at the bottom any more');
  ok(v.overscroll === 'contain', 'the bounce of a pull stays inside the scrolling part (overscroll-behavior: contain)');
  ok(v.fade, 'a soft fade at the bottom edge says "there is more below" (touch screens hide the scroll bar)');
  await page.evaluate(() => { const b = document.querySelector('.dlgbody'); b.scrollTop = (b.scrollHeight - b.clientHeight) / 2; }); await page.waitForTimeout(250); v = await st();
  ok(v.y > 50 && v.headTop === top0 && v.doneTop === done0, `scrolled ${v.y}px: the title bar and "Done" did not move (${v.headTop} / ${v.doneTop})`);
  ok(v.line, 'the title bar gets a thin line once content slides under it');
  await page.evaluate(() => { const b = document.querySelector('.dlgbody'); b.scrollTop = b.scrollHeight; }); await page.waitForTimeout(250); v = await st();
  ok(v.headTop === top0 && !v.fade, 'at the bottom: still in place, the fade is gone');
  // a real pull down at the top (touch drag): the title bar must not follow
  await page.evaluate(() => { document.querySelector('.dlgbody').scrollTop = 0; }); await page.waitForTimeout(200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: 250, id: 1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 250 + i * 22, id: 1 }] });
  v = await st(); ok(v.headTop === top0 && v.doneTop === done0, `while pulling down at the top the title bar stays (${v.headTop})`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('.dlgbody'); b.scrollTop = b.scrollHeight; }); await page.waitForTimeout(200);
  await page.click('#done-top'); await page.waitForTimeout(300);
  ok(await page.locator('dialog.dlg').count() === 0, 'Done closes the settings (also when scrolled to the bottom)');
  await page.setViewportSize({ width: 440, height: 1400 }); await openSettings(); await page.waitForTimeout(300); v = await st();
  ok(!v.bodyScrolls && !v.fade, 'when everything fits there is nothing to scroll and no fade');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
