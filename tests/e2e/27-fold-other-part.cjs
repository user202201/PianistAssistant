const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')],
    ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'Ode', a: 'Ode_Primo.musicxml', b: 'Ode_Secondo.musicxml' }] }))]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.waitForFunction(() => document.querySelectorAll('.pane').length === 2 && window.__pianist, null, { timeout: 15000 }); await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => [...document.querySelectorAll('.pane')].map(p => ({ folded: p.classList.contains('collapsed'), wrapH: Math.round((p.querySelector('.panewrap')?.getBoundingClientRect().height) || 0), btn: (() => { const b = p.querySelector('.collbtn'); return b && b.getBoundingClientRect().width > 0 ? b.textContent : null; })() })));
  let s = await st(); ok(!s[0].folded && !s[1].folded && !s[0].btn && !s[1].btn, 'nothing muted: both parts are shown, no fold button');
  await page.locator('.pane >> nth=0').locator('.pname').click(); await page.waitForTimeout(500); // mute A: I play A myself
  s = await st(); ok(!s[0].folded && s[1].folded && s[1].btn === '展开' && s[1].wrapH === 0 && s[0].wrapH > 300, `A muted (I play it): B is folded to its button row, A gets the room ${JSON.stringify(s)}`);
  await page.locator('.pane >> nth=1').locator('.collbtn').click(); await page.waitForTimeout(400);
  s = await st(); ok(!s[1].folded && s[1].btn === '收起' && s[1].wrapH > 100, `"展开" opens it again by hand ${JSON.stringify(s)}`);
  await page.locator('.pane >> nth=1').locator('.collbtn').click(); await page.waitForTimeout(300);
  s = await st(); ok(s[1].folded, 'and it can be folded again');
  await page.locator('.pane >> nth=0').locator('.pname').click(); await page.waitForTimeout(500); // unmute A
  s = await st(); ok(!s[0].folded && !s[1].folded && !s[1].btn, 'A sounds again: both shown, no fold button');
  await page.locator('.pane >> nth=1').locator('.pname').click(); await page.waitForTimeout(500); // mute B: I play B
  s = await st(); ok(s[0].folded && !s[1].folded && s[0].btn === '展开', 'B muted (I play it): A is folded');
  await page.screenshot({ path: D + 'fold.png' });
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
