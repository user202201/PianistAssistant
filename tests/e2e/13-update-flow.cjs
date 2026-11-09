const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')], ['scores/duet.musicxml', fs.readFileSync(D + 'Four-Hands-Duet.musicxml')]]);
  const { browser, page } = await h.start(store, { context: IPAD });
  // no automatic scrolling while we measure positions (the app's own page turn is tested in e2e11)
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.scrollMode = 'off'; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); localStorage.removeItem('pianist.tap.hint'); });
  await page.reload(); await page.waitForSelector('.home');
  const open = async (n) => { await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), n); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(900); };
  // screen position of a step, scrolled into view; the cursor is put back at the start afterwards
  const posOf = (view, measure, onset, dx = 0, dyFrac = 0.5) => page.evaluate(({ view, measure, onset, dx, dyFrac }) => {
    const { player, score, views } = window.__pianist; const v = views[view]; const list = v.steps ?? score.steps;
    const li = list.findIndex(s => s.measure === measure && Math.abs(s.onset - onset) < 1e-6); const gi = v.steps ? score.steps.findIndex(s => s.sec >= list[li].sec - 1e-4) : li;
    player.seekStep(gi); const c = v.osmd.cursor.cursorElement; let r = c.getBoundingClientRect(); const wr = v.wrap.getBoundingClientRect();
    v.wrap.scrollTop += (r.top + r.height / 2) - (wr.top + wr.height / 2); r = c.getBoundingClientRect();
    const p = { x: r.left + r.width / 2 + dx, y: r.top + r.height * dyFrac, gi }; player.seekStep(0); return p;
  }, { view, measure, onset, dx, dyFrac });

  await open('long');
  ok(await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('从那里开始播放')), null, { timeout: 5000 }).then(() => true, () => false), 'first time: a hint tells you to tap the score');

  let p = await posOf(0, 9, 0.5);                      // measure 10, beat 3
  await page.touchscreen.tap(p.x, p.y);
  let st = await page.evaluate(() => ({ step: window.__pianist.player.currentStep, m: window.__pianist.player.measureIndex }));
  ok(st.step === p.gi && st.m === 9, `tapping measure 10 beat 3 jumps there (step ${st.step}, measure ${st.m + 1})`);

  p = await posOf(0, 20, 0, -6, 0.85);                 // lower staff, a little left of the note
  await page.touchscreen.tap(p.x, p.y);
  ok(await page.evaluate(() => window.__pianist.player.measureIndex) === 20, 'tapping on the lower staff / beside a note still picks that spot (measure 21)');

  // ---- while playing: tap = continue from there
  await page.evaluate(() => window.__pianist.player.seekStep(0));
  await page.click('button[title^=播放]'); await page.waitForTimeout(500);
  p = await posOf(0, 14, 0);
  const sec = await page.evaluate(() => { const { score } = window.__pianist; return score.steps.find(s => s.measure === 14 && s.onset === 0).sec; });
  await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ playing: window.__pianist.player.playing, pos: window.__pianist.player.position(), m: window.__pianist.player.measureIndex }));
  ok(after.playing && after.pos >= sec - 0.1 && after.pos < sec + 1.5 && after.m >= 14, `tap while playing: keeps playing from the tapped place (measure ${after.m + 1}, ${after.pos.toFixed(1)}s, wanted ${sec}s)`);
  await page.click('button[title^=播放]');

  // ---- editing fingering: taps select notes instead
  await page.evaluate(() => { window.__pianist.tools.editing = true; window.__pianist.player.seekStep(0); });
  p = await posOf(0, 14, 0); await page.touchscreen.tap(p.x, p.y);
  ok(await page.evaluate(() => window.__pianist.player.currentStep) === 0, 'while editing fingering, tapping does not move the start point');
  await page.evaluate(() => { window.__pianist.tools.editing = false; });

  // ---- split view: a tap on either screen starts BOTH
  await page.click('button[title=返回]'); await page.waitForSelector('.home'); await open('duet');
  p = await posOf(1, 5, 0, 3);                         // B screen, measure 6
  await page.touchscreen.tap(p.x, p.y);
  let both = await page.evaluate(() => { const { views, score, player } = window.__pianist; const sec = score.steps[player.currentStep].sec; return { m: player.measureIndex, cur: views.map(v => v.cur), want: views.map(v => { let w = 0; v.steps.forEach((s, j) => { if (s.sec <= sec + 1e-4) w = j; }); return w; }) }; });
  ok(both.m === 5 && both.cur.join() === both.want.join(), `split view: tap on the B screen -> both screens at measure 6 (${both.cur.join('/')})`);
  p = await posOf(0, 2, 0, 3);                         // A screen, measure 3
  await page.touchscreen.tap(p.x, p.y);
  both = await page.evaluate(() => { const { views, score, player } = window.__pianist; const sec = score.steps[player.currentStep].sec; return { m: player.measureIndex, cur: views.map(v => v.cur), want: views.map(v => { let w = 0; v.steps.forEach((s, j) => { if (s.sec <= sec + 1e-4) w = j; }); return w; }) }; });
  ok(both.m === 2 && both.cur.join() === both.want.join(), `split view: tap on the A screen -> both screens at measure 3 (${both.cur.join('/')})`);
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
