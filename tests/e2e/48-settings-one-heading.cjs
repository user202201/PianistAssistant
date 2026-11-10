// Settings: the score-scrolling drop-down sits directly under the "Score display" heading, without a second label saying the same thing.
const h = require('./harness.cjs');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const { browser, page } = await h.start(new Map(), { context: { viewport: { width: 1194, height: 834 } } });
  await page.click('button[title=设置], button[title=Settings]').catch(async () => { await page.click('text=/设置|Settings/'); });
  await page.waitForSelector('.dlg.settings'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const d = document.querySelector('.dlg.settings'); const sel = [...d.querySelectorAll('select')].find((s) => [...s.options].some((o) => /page|整屏|Full page|Page/i.test(o.text) || o.value === 'page'));
    return { has: !!sel, inLabel: !!(sel && sel.closest('label')), labels: [...d.querySelectorAll('label')].map((l) => l.innerText).filter((t) => /滚动|scroll/i.test(t)).length }; });
  ok(r.has && !r.inLabel && r.labels === 0, 'the scrolling drop-down has no extra label under the heading');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
