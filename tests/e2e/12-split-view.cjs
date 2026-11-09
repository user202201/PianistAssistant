const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
(async () => {
  const store = new Map([['scores/duet.musicxml', fs.readFileSync(D + 'Four-Hands-Duet.musicxml')], ['scores/solo.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: IPAD });
  const open = async (n) => { await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), n); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(900); };
  await open('duet');

  // ---- two screens, one part each
  ok(await page.locator('.pane').count() === 2, 'split view: two screens');
  const txt = await page.evaluate(() => [...document.querySelectorAll('.panewrap')].map(w => w.querySelector('svg').textContent));
  ok(txt[0].includes('Primo') && !txt[0].includes('Secondo') && txt[1].includes('Secondo') && !txt[1].includes('Primo'), 'top screen shows only Primo, bottom screen only Secondo');
  const heads = await page.evaluate(() => [...document.querySelectorAll('.panehead')].map(h => h.textContent.replace(/\s+/g, ' ').trim()));
  console.log('heads:', JSON.stringify(heads));
  ok(heads[0].startsWith('A · Primo') && heads[0].includes('双手') && heads[0].includes('右手') && heads[0].includes('左手') && heads[1].startsWith('B · Secondo') && heads[1].includes('右手'), 'each screen has its own controls: A · Primo / B · Secondo with both / right / left');
  await page.screenshot({ path: D + 'split.png' });

  // ---- cursors follow the shared clock
  const sync = await page.evaluate(() => {
    const { player, score, views } = window.__pianist; const bad = [];
    for (let i = 0; i < score.steps.length; i++) {
      player.seekStep(i); const sec = score.steps[i].sec;
      views.forEach((v, k) => { let want = 0; v.steps.forEach((s, j) => { if (s.sec <= sec + 1e-4) want = j; }); const r = v.osmd.cursor.cursorElement.getBoundingClientRect(); if (v.cur !== want || r.height === 0) bad.push([i, k, v.cur, want]); });
    }
    return { n: score.steps.length, bad: bad.length, first: bad[0] };
  });
  ok(sync.bad === 0, `both cursors are on the right step for all ${sync.n} positions of the shared clock`);
  const own = await page.evaluate(() => window.__pianist.views.map(v => v.steps.length));
  ok(own[0] !== own[1], `each screen has its own step list (${own.join(' vs ')}), matched by time`);

  // ---- bottom bar: only play/pause by default
  const vis = async () => page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().height > 0; }; return { play: v('button[title^=播放]'), stop: v('button[title=回到开头]'), speed: v('.speed'), practice: v('button:not([hidden])') && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '练习' && b.getBoundingClientRect().height > 0), more: v('.morebtn'), h: Math.round(document.querySelector('.controls').getBoundingClientRect().height) }; });
  // wide screen: everything in one row, no "more" button
  { const w = await vis(); ok(w.play && w.speed && w.practice && !w.more, `wide screen: the whole bar is visible in one row (${w.h}px tall), no "更多"`); }
  await page.setViewportSize({ width: 700, height: 800 }); await page.waitForTimeout(500);
  let v0 = await vis();
  ok(v0.play && v0.more && !v0.speed && !v0.practice, `bottom bar is minimal: play/pause + "更多" only (${v0.h}px tall)`);
  await page.click('.morebtn');
  let v1 = await vis(); ok(v1.speed && v1.practice && v1.h > v0.h, `"更多" brings back speed, practice, ... (${v1.h}px)`);
  await page.click('.morebtn'); v0 = await vis(); ok(!v0.speed, 'and it collapses again');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).splitControlsMin) === true, 'the choice is remembered');

  // ---- per-player hands and sound
  await page.click('.panehead:nth-of-type(1) >> nth=0'); // noop focus ring
  const btn = (part, text) => page.locator(`.pane[data-part="${part}"] .panehead button:text-is("${text}")`);
  await btn(0, '右手').click();
  ok(await page.evaluate(() => JSON.stringify(window.__pianist.player.partHands)) === '[{"right":true,"left":false},{"right":true,"left":true}]', 'A: "右手" = right hand only, B untouched');
  await btn(0, '左手').click();
  ok(await page.evaluate(() => JSON.stringify(window.__pianist.player.partHands[0])) === '{"right":false,"left":true}', 'choosing 左手 replaces 右手 (one choice, like for a single score)');
  await btn(0, '双手').click();
  ok(await page.evaluate(() => JSON.stringify(window.__pianist.player.partHands[0])) === '{"right":true,"left":true}', '双手 brings both hands back');
  await btn(0, '右手').click();
  await btn(1, '左手').click();
  const aud = await page.evaluate(() => { const p = window.__pianist.player; const evs = window.__pianist.score.events; p.partOn = [true, true]; const n = (part, staff) => evs.filter(e => p.audible(e) && e.part === part && e.staff === staff).length; return [n(0, 0), n(0, 1), n(1, 0), n(1, 1)]; });
  ok(aud.join() === '30,0,0,32', `A plays right hand only (30 notes), B left hand only (32 notes): ${aud.join()}`);
  await page.evaluate(() => { const p = window.__pianist.player; p.partHands.forEach(x => { x.right = true; x.left = true; }); p.onChange(); });
  await page.locator('.pane[data-part="0"] .pname').click();
  ok(await page.evaluate(() => window.__pianist.player.partOn.join()) === 'false,true', 'tapping the name mutes that part (you play it yourself)');
  await page.locator('.pane[data-part="1"] .pname').click();
  ok(await page.evaluate(() => window.__pianist.player.partOn.join()) === 'false,true', 'the last audible part cannot be muted');

  // ---- play: both screens move, only B is heard
  await page.evaluate(() => window.__pianist.player.seekStep(0));
  await page.evaluate(() => { const p = window.__pianist.player; window.__rec = []; const i = p.inst; const o = i.start.bind(i); i.start = e => { window.__rec.push(e.note); return o(e); }; });
  await page.click('button[title^=播放]'); await page.waitForTimeout(2600);
  const mid = await page.evaluate(() => ({ cur: window.__pianist.views.map(v => v.cur), n: window.__rec.length }));
  ok(mid.cur.every(c => c > 3) && mid.n >= 8, `playing: both cursors advanced (${mid.cur.join(' / ')}), B is audible (${mid.n} notes)`);

  // ---- full screen for one part while it keeps playing
  await page.evaluate(() => window.__setFocus(0)); await page.waitForTimeout(400);
  const f = await page.evaluate(() => ({ panes: [...document.querySelectorAll('.pane')].map(p => p.getBoundingClientRect().height > 0), top: document.querySelector('.top').getBoundingClientRect().height, wrapH: Math.round(document.querySelector('.pane.focused .panewrap').getBoundingClientRect().height), playing: window.__pianist.player.playing }));
  console.log('focus:', JSON.stringify(f));
  ok(f.panes.join() === 'true,false' && f.top === 0 && f.playing, 'full screen: only A is shown, header hidden, playback continues');
  const before = await page.evaluate(() => window.__rec.length); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => window.__rec.length) > before, 'the hidden part keeps sounding while you look at your own part');
  await page.screenshot({ path: D + 'split-focus.png' });
  await page.evaluate(() => window.__setFocus(null)); await page.waitForTimeout(300);
  ok(await page.evaluate(() => [...document.querySelectorAll('.pane')].every(p => p.getBoundingClientRect().height > 0)), 'restore brings both screens back');
  await page.click('button[title^=播放]');

  // ---- settings: choices + switch back to one screen
  await page.click('button[title=设置]'); await page.waitForSelector('dialog');
  const dlg = await page.textContent('dialog');
  ok(dlg.includes('整屏翻页') && dlg.includes('平滑滚动') && dlg.includes('不滚动') && dlg.includes('四手联弹分屏'), 'settings: scroll modes (page / smooth / off) and split-screen switch');
  await page.selectOption('dialog select:has(option[value=smooth])', 'smooth');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).scrollMode) === 'smooth', 'scroll mode chosen in settings is saved');
  await page.selectOption('dialog select:has(option[value=smooth])', 'page');
  await page.click('dialog label:has-text("四手联弹分屏") input'); await page.waitForSelector('.scorewrap', { timeout: 15000 }); await page.waitForTimeout(900);
  ok(await page.locator('.pane').count() === 0 && await page.locator('.pgroup').count() === 2, 'split off: one screen with A / B controls in the bottom bar');
  const labels = await page.evaluate(() => [...document.querySelectorAll('.controls .pgroup')].map(g => g.textContent.replace(/\s+/g, ' ').trim()));
  ok(labels[0].startsWith('A · Primo') && labels[1].startsWith('B · Secondo') && labels.every(l => l.includes('右手') && l.includes('左手')), `stacked mode also has A/B and per-player hands: ${labels.join(' | ')}`);
  await page.screenshot({ path: D + 'stacked.png' });

  // ---- one-part score: no split, no A/B
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.splitView = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.click('button[title=返回]'); await page.waitForSelector('.home'); await open('solo');
  ok(await page.locator('.pane').count() === 0 && await page.locator('.pgroup').count() === 0 && await page.locator('.controls .seg:text-is("双手")').count() === 1, 'single-part score: normal screen and the 双手/右手/左手 buttons');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
