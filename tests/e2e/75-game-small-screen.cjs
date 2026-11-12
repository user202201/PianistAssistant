// Game view on small screens (four hands): refresh / settings stay in the top right corner and a long title goes under them; the floating part buttons fade when idle;
// the keyboard panel is low; a phone held sideways hides the title bar while the music plays (a tap brings it back) and never lets the A / B buttons lie on each other;
// a "keys only" button takes the score away completely.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 390, height: 780 } } });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = true; s.gameH = 0; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.reload(); await page.waitForSelector('.modetoggle', { timeout: 20000 }); await page.waitForTimeout(2500);
  await page.evaluate(() => { document.querySelector('.top h1').textContent = 'Merry Christmas Darling (4 hands) with a very long title'; });
  // 1. portrait
  const g = await page.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const top = r(document.querySelector('.top .back')), ref = r(document.querySelector('.top button[title="重新载入这份乐谱并检查更新"]')), set = r(document.querySelector('.top button[title="设置"]')), t = r(document.querySelector('.top h1')), panel = r(document.querySelector('.gamepanel')), pn = [...document.querySelectorAll('.pane')].map((p) => Math.round(r(p).height));
    return { backTop: top.top, refTop: ref.top, setTop: set.top, setRight: Math.round(innerWidth - set.right), titleTop: t.top, refBottom: ref.bottom, panel: Math.round(panel.height), pn }; });
  ok(Math.abs(g.refTop - g.backTop) < 4 && Math.abs(g.setTop - g.backTop) < 4 && g.setRight < 24, `refresh and settings are in the first row, at the right (${Math.round(g.refTop)} = ${Math.round(g.backTop)}, ${g.setRight}px from the edge)`);
  ok(g.titleTop >= g.refBottom - 2, 'the long title is on its own line under them');
  ok(g.panel <= 200, `the keyboard panel is low on a phone (${g.panel}px)`);
  // 2. idle: the buttons fade, a touch brings them back
  await page.waitForTimeout(4500);
  const op = () => page.evaluate(() => Math.min(...[...document.querySelectorAll('.panefs, .panehead .seg')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => +getComputedStyle(e).opacity)));
  ok((await op()) < 0.6, `not touched for a while: the floating buttons fade (${(await op()).toFixed(2)})`);
  await page.mouse.click(200, 400); await page.waitForTimeout(900);
  ok((await op()) > 0.9, 'a touch brings them back');
  // 3. keys only
  const before = await page.evaluate(() => document.querySelector('.gamepanel').getBoundingClientRect().height);
  await page.click('.gfull'); await page.waitForTimeout(800);
  const full = await page.evaluate(() => ({ score: [...document.querySelectorAll('.splitwrap, .handstrip')].every((e) => getComputedStyle(e).display === 'none'), panel: document.querySelector('.gamepanel').getBoundingClientRect().height, title: document.querySelector('.gfull').title }));
  ok(full.score && full.panel > before * 2.5 && full.panel > 450, `the keys-only button hides the score and the panel fills the screen (${Math.round(before)} -> ${Math.round(full.panel)}px)`);
  await page.screenshot({ path: D + 'game-keys-only.png' });
  await page.click('.gfull'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.splitwrap')).display !== 'none'), 'and the same button brings the score back');
  // 4. landscape
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(900);
  const ls = await page.evaluate(() => ({ panel: Math.round(document.querySelector('.gamepanel').getBoundingClientRect().height), vh: innerHeight }));
  ok(ls.panel <= ls.vh * 0.45, `sideways: the panel takes at most 45% of the height (${ls.panel} of ${ls.vh}px)`);
  await page.evaluate(() => window.__pianist.player.play()); await page.waitForTimeout(1500);
  const hid = await page.evaluate(() => document.querySelector('.top').getBoundingClientRect().bottom);
  ok(hid <= 1, `sideways and playing: the title bar has slid away (bottom at ${Math.round(hid)})`);
  await page.mouse.click(420, 200); await page.waitForTimeout(500);
  const back = await page.evaluate(() => document.querySelector('.top').getBoundingClientRect().bottom);
  ok(back > 20, 'a tap on the screen brings it back');
  await page.waitForTimeout(4800);
  ok((await page.evaluate(() => document.querySelector('.top').getBoundingClientRect().bottom)) <= 1, 'and it leaves again by itself');
  await page.evaluate(() => window.__pianist.player.pause());
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.panehead .seg, .panefs')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  let overlap = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2) overlap++; }
  ok(boxes.length > 4 && overlap === 0, `sideways: the part buttons of A and B do not lie on each other (${boxes.length} buttons, ${overlap} overlaps)`);
  await page.screenshot({ path: D + 'game-landscape.png' });
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
