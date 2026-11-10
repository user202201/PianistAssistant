// Four hands in the game view: the game panel never takes the room of the score (every part keeps at least a line), and the part bars (hands, full screen)
// hide behind the small floating buttons, like on a phone held sideways.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1180, height: 760 } } });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = false; s.gameH = 900; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.reload(); await page.waitForSelector('.modetoggle', { timeout: 20000 }); await page.waitForTimeout(2000);
  const st = () => page.evaluate(() => { const vis = (e) => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none';
    const panes = [...document.querySelectorAll('.pane')].map((p) => Math.round(p.getBoundingClientRect().height)); const g = document.querySelector('.gamepanel');
    return { compact: document.documentElement.classList.contains('gamecompact'), headVisible: [...document.querySelectorAll('.panehead')].some((e) => vis(e)), menu: [...document.querySelectorAll('.panemenu')].some((e) => vis(e)), panes, panel: g && !g.hidden ? Math.round(g.getBoundingClientRect().height) : 0 }; });
  let a = await st();
  ok(!a.compact && a.headVisible && a.panes.every((x) => x >= 190), `practice view: the part bars are shown (${a.panes.join(' / ')} px)`);
  await page.click('.modetoggle .seg[data-mode=game]'); await page.waitForTimeout(900);
  a = await st();
  ok(a.compact && !a.headVisible && a.menu, 'game view: the part bars are hidden, the small floating buttons are there');
  ok(a.panel > 0 && a.panes.every((x) => x >= 190), `the panel (${a.panel} px, although 900 was asked for) leaves every part at least a line (${a.panes.join(' / ')} px)`);
  await page.click('.panemenu >> nth=0'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => [...document.querySelectorAll('.panehead.open')].length) === 1 && await page.evaluate(() => { const o = document.querySelector('.panehead.open'); return !!o && o.getBoundingClientRect().width > 0; }), 'the button opens the hands / full-screen controls of that part as a floating menu');
  await page.screenshot({ path: D + 'game-fourhand-space.png' });
  // back to practice: the bars return
  await page.mouse.click(5, 300); await page.click('.modetoggle .seg[data-mode=practice]'); await page.waitForTimeout(500);
  a = await st(); ok(!a.compact && a.headVisible, 'practice view again: the part bars are back');
  // a single score is not affected
  await page.evaluate(() => (location.hash = '#/score/single.musicxml')); await page.waitForTimeout(2000);
  ok(await page.evaluate(() => !document.documentElement.classList.contains('gamecompact')), 'a single score does not use the floating buttons');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
