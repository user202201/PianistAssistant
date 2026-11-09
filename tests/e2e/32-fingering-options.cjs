const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  // the fingering options only offer what can be used: no dead "this score has no fingering" switch
  const store = new Map([['scores/plain.musicxml', fs.readFileSync(D + 'single.musicxml')], ['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  const panel = async (name) => {
    await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), name); await page.waitForSelector('.controls .mainrow', { timeout: 15000 }); await page.waitForTimeout(1200);
    await page.click('button[title=指法选项]'); await page.waitForTimeout(300);
    return page.evaluate(() => { const p = document.querySelector('.panel:not([hidden])'); return { text: p.textContent, disabled: p.querySelectorAll('input:disabled').length, switches: p.querySelectorAll('input[type=checkbox]').length }; });
  };
  const a = await panel('plain');
  ok(!a.text.includes('没有指法信息') && a.disabled === 0, `a score without fingering: no dead switch in the options (${a.switches} usable switch(es))`);
  ok(a.text.includes('自动建议指法'), 'the automatic suggestion switch is still there');
  await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.home'); await page.waitForTimeout(500);
  const b = await panel('fingered');
  ok(!b.text.includes('显示乐谱里的指法') && b.disabled === 0, 'also with fingering in the score: no extra "show the fingering of the score" switch (the main fingering button already does that)');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
