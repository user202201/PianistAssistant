// Small screens: the home screen scrolls as a whole; when the "recent" row has scrolled away the tab bar (all / scores / PDF / sort) stays at the top.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const f = fs.readFileSync(D + 'single.musicxml');
  const store = new Map(); for (let i = 1; i <= 30; i++) store.set(`scores/s${String(i).padStart(2, '0')}.musicxml`, f);
  for (const [w, hh, small] of [[390, 700, true], [1194, 834, false]]) {
    const { browser, page } = await h.start(store, { context: { viewport: { width: w, height: hh } } });
    await page.waitForSelector('.listbox .card');
    await page.evaluate(() => (location.hash = '#/score/s01.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1000);
    await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.listbox .card'); await page.waitForTimeout(600);
    const geo = () => page.evaluate(() => { const hm = document.querySelector('.home').getBoundingClientRect(); const t = document.querySelector('.tabsbar').getBoundingClientRect(); const r = document.querySelector('.recentsec'); return { homeTop: Math.round(hm.top), tabsTop: Math.round(t.top), tabsBottom: Math.round(t.bottom), recent: !!r && r.getBoundingClientRect().height > 0, recentBottom: r ? Math.round(r.getBoundingClientRect().bottom) : 0, scroll: document.querySelector('.home').scrollTop, scrollable: document.querySelector('.home').scrollHeight > document.querySelector('.home').clientHeight + 50 }; });
    const g0 = await geo();
    ok(g0.recent && g0.tabsTop > g0.homeTop + 20, `${w}px: at the top of the screen the recent row is above the tabs (tabs at ${g0.tabsTop}, screen top ${g0.homeTop})`);
    if (small) {
      ok(g0.scrollable, 'the home screen scrolls as a whole');
      await page.evaluate(() => { document.querySelector('.home').scrollTop = 900; }); await page.waitForTimeout(300);
      const g1 = await geo();
      ok(g1.scroll > 500 && g1.recentBottom < g1.homeTop && Math.abs(g1.tabsTop - g1.homeTop) <= 1, `scrolled down: the recent row is gone and the tabs stay at the top (${g1.tabsTop} = ${g1.homeTop})`);
      await page.evaluate(() => { document.querySelector('.home').scrollTop = 600; }); await page.waitForTimeout(300);
      const g2 = await geo();
      ok(g2.recentBottom < g2.homeTop && Math.abs(g2.tabsTop - g2.homeTop) <= 1, `scrolling back up a little: the tabs do not move, the recent row stays away (${g2.tabsTop} = ${g2.homeTop})`);
      await page.evaluate(() => { document.querySelector('.home').scrollTop = 0; }); await page.waitForTimeout(300);
      const g3 = await geo();
      ok(g3.recentBottom > g3.homeTop && g3.tabsTop > g3.homeTop + 20, `only at the very top the recent row is there again (${g3.tabsTop} > ${g3.homeTop})`);
      await page.evaluate(() => { document.querySelector('.home').scrollTop = 900; }); await page.waitForTimeout(300);
      const click = await page.evaluate(() => { const tgt = [...document.querySelectorAll('.tabsbar .seg-select, .tabsbar .seg')].find((x) => x.getBoundingClientRect().width > 0); const t = tgt.getBoundingClientRect(); document.querySelectorAll('#toasts, .toast').forEach((x) => { x.style.pointerEvents = 'none'; x.style.visibility = 'hidden'; }); const e = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return !!e && !!e.closest('.tabsbar') ? 'ok' : (e ? e.tagName + '.' + e.className + ' <' + (e.parentElement && e.parentElement.className) + '>' : 'null') + ' @' + Math.round(t.left + t.width / 2) + ',' + Math.round(t.top + t.height / 2) + ' ' + tgt.className; });
      ok(click === 'ok', 'and they can be tapped there (nothing covers them) ' + click);
      await page.click('.tabsbar .sortbtn'); await page.waitForTimeout(300);
      const m = await page.evaluate(() => { const mn = document.querySelector('.sortmenu'); const r = mn.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return { shown: r.height > 0, onTop: !!e && !!e.closest('.sortmenu') }; });
      ok(m.shown && m.onTop, 'the sort menu opens from the stuck tab bar, above the list');
      await page.screenshot({ path: D + 'tabs-sticky-' + w + '.png' });
    } else {
      ok(await page.evaluate(() => getComputedStyle(document.querySelector('.tabsbar')).position !== 'sticky'), 'a big screen keeps its layout (the list scrolls under fixed tabs)');
    }
    await browser.close();
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
