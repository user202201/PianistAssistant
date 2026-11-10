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
  const btn = await page.evaluate(() => { const g = (q, i) => { const e = document.querySelectorAll(q)[i]; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), round: c.borderRadius, shadow: c.boxShadow, left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), bg: c.backgroundColor }; };
    return { menu: g('.panemenu', 0), fs: g('.panefs', 0), pane: Math.round(document.querySelector('.pane').getBoundingClientRect().width) }; });
  ok(btn.menu.w === btn.menu.h && btn.fs.w === btn.fs.h && /50%|19px|9999/.test(btn.menu.round), `the floating buttons are round (${btn.menu.w}x${btn.menu.h} / ${btn.fs.w}x${btn.fs.h})`);
  ok(btn.menu.shadow === 'none' && btn.fs.shadow === 'none' && /rgba\(25, 120, 240/.test(btn.menu.bg), 'see-through blue glass, no glow behind them');
  ok(btn.menu.left < 30 && btn.fs.right < 40, `the hands button is on the left, full screen on the right (${btn.menu.left}px from the left, ${btn.fs.right}px from the right)`);
  await page.click('.panefs >> nth=0'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.getElementById('app').classList.contains('focusing') || !!document.querySelector('.pane.focused, .focused')), 'the right button puts that part on full screen');
  await page.click('.panefs >> nth=0'); await page.waitForTimeout(500);
  await page.click('.panemenu >> nth=0'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const o = document.querySelector('.panehead.open'); return !!o && !o.querySelector('.focusbtn') || (o && getComputedStyle(o.querySelector('.focusbtn')).display === 'none'); }), 'the left button opens the hands of that part (without a second full-screen button)');
  ok(await page.evaluate(() => { const o = document.querySelector('.panehead.open'); return !!o && o.getBoundingClientRect().width > 0; }), 'it is a floating menu');
  await page.screenshot({ path: D + 'game-fourhand-space.png' });
  // back to practice: the bars return
  await page.mouse.click(5, 300); await page.click('.modetoggle .seg[data-mode=practice]'); await page.waitForTimeout(500);
  a = await st(); ok(!a.compact && a.headVisible, 'practice view again: the part bars are back');
  // a single score is not affected
  await page.evaluate(() => (location.hash = '#/score/single.musicxml')); await page.waitForTimeout(2000);
  ok(await page.evaluate(() => !document.documentElement.classList.contains('gamecompact')), 'a single score does not use the floating buttons');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
