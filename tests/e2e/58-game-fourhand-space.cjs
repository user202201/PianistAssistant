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
  const vis0 = await page.evaluate(() => { const vis = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; const pane = document.querySelector('.pane'); const hd = pane.querySelector('.panehead');
    const q = (sel) => [...hd.querySelectorAll(sel)].filter(vis).map((e) => ({ t: e.innerText.trim(), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), round: getComputedStyle(e).borderRadius, shadow: getComputedStyle(e).boxShadow }));
    return { compact: document.documentElement.classList.contains('gamecompact'), name: q('.pname'), hands: q('.hand'), fs: [...pane.querySelectorAll('.panefs')].filter(vis).length, menu: [...document.querySelectorAll('.panemenu')].some(vis), focusInside: q('.focusbtn').length, headLeft: Math.round(hd.getBoundingClientRect().left - pane.getBoundingClientRect().left) }; });
  a = await st();
  ok(vis0.compact && vis0.name.length === 1 && vis0.hands.length === 3 && vis0.fs === 1 && !vis0.menu && vis0.focusInside === 0, 'game view: the part bar is small round icon buttons: the part, three hands, full screen; no sub-menu');
  ok([...vis0.name, ...vis0.hands].every((b) => b.w === b.h && /50%|19px/.test(b.round) && b.shadow === 'none'), `all round, glass, no glow (${[...vis0.name, ...vis0.hands].map((b) => b.t).join(' ')})`);
  ok(vis0.name[0].t.length <= 2 && vis0.hands.every((b) => b.t.length <= 4), 'icons only: just the part letter and the short hand names');
  ok(a.panel > 0 && a.panes.every((x) => x >= 190), `the panel (${a.panel} px, although 900 was asked for) leaves every part at least a line (${a.panes.join(' / ')} px)`);
  const fsBtn = await page.evaluate(() => { const r = document.querySelector('.panefs').getBoundingClientRect(); return { right: Math.round(window.innerWidth - r.right) }; });
  ok(fsBtn.right < 40, `full screen is on the right (${fsBtn.right}px from the edge)`);
  await page.click('.pane >> nth=0 >> .hand >> nth=1'); await page.waitForTimeout(300); // right hand only, directly
  ok(await page.evaluate(() => { const h = window.__pianist.player.partHands[0]; return h.right === true && h.left === false; }), 'the hand buttons work directly (right hand only)');
  await page.click('.pane >> nth=0 >> .hand >> nth=0'); await page.waitForTimeout(200);
  await page.click('.panefs >> nth=0'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.getElementById('app').classList.contains('focusing') || !!document.querySelector('.pane.focused, .focused')), 'the right button puts that part on full screen');
  await page.click('.panefs >> nth=0'); await page.waitForTimeout(500);
  await page.screenshot({ path: D + 'game-fourhand-space.png' });
  // the part button walks through the views: both -> this part alone -> the other part alone -> both
  const view = () => page.evaluate(() => ({ on: window.__pianist.player.partOn.join(), panes: [...document.querySelectorAll('.pane')].filter((p) => p.getBoundingClientRect().height > 20 && getComputedStyle(p).display !== 'none').length, heads: [...document.querySelectorAll('.panehead')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none').length, h: Math.round(document.querySelector('.pane:not(.collapsed)').getBoundingClientRect().height) }));
  await page.evaluate(() => { window.__pianist.player.partOn = [true, true]; document.querySelectorAll('.pname')[0].click(); document.querySelectorAll('.pname')[0].click(); document.querySelectorAll('.pname')[1].click(); }); await page.waitForTimeout(500); // (reset to "both")
  let v0 = await view();
  ok(v0.on === 'true,true' && v0.panes === 2 && v0.heads === 2, `both parts: two panes, two sets of buttons (${v0.panes} / ${v0.heads})`);
  await page.click('.pane >> nth=0 >> .pname'); await page.waitForTimeout(500); let v1 = await view();
  ok(v1.on === 'false,true' && v1.panes === 1 && v1.heads === 1 && v1.h > 250, `tap A: A alone (you play A), B is hidden, one set of buttons, A gets the room (${v1.h}px)`);
  await page.click('.pname >> nth=0'); await page.waitForTimeout(500); let v2 = await view();
  ok(v2.on === 'true,false' && v2.panes === 1 && v2.heads === 1, 'tap again: B alone (A is the accompaniment, you play B)');
  await page.click('.pname >> nth=1'); await page.waitForTimeout(500); let v3 = await view();
  ok(v3.on === 'true,true' && v3.panes === 2 && v3.heads === 2, 'tap again: both parts again');
  // back to practice: the bars return
  await page.mouse.click(5, 300); await page.click('.modetoggle .seg[data-mode=practice]'); await page.waitForTimeout(500);
  a = await st(); ok(!a.compact && a.headVisible, 'practice view again: the part bars are back');
  // a single score is not affected
  await page.evaluate(() => (location.hash = '#/score/single.musicxml')); await page.waitForTimeout(2000);
  ok(await page.evaluate(() => !document.documentElement.classList.contains('gamecompact')), 'a single score does not use the floating buttons');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
